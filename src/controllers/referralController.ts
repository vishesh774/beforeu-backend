import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import mongoose from 'mongoose';
import UserPlan from '../models/UserPlan';
import ReferralConfig from '../models/ReferralConfig';
import ReferralRecord from '../models/ReferralRecord';
import User from '../models/User';
import Coupon from '../models/Coupon';

// @desc    Get Referral Configuration
// @route   GET /api/admin/referral/config
// @access  Private/Admin
export const getReferralConfig = asyncHandler(async (_: Request, res: Response) => {
    const config = await ReferralConfig.findOne();
    if (!config) {
        return res.status(200).json({
            success: true,
            data: null
        });
    }

    return res.status(200).json({
        success: true,
        data: config
    });
});

// @desc    Update Referral Configuration
// @route   POST /api/admin/referral/config
// @access  Private/Admin
export const updateReferralConfig = asyncHandler(async (req: Request, res: Response, next: any) => {
    const { referrerCouponId, refereeCouponId, isActive } = req.body;

    if (!referrerCouponId || !refereeCouponId) {
        return next(new AppError('Both coupons are required for the referral program', 400));
    }

    let config = await ReferralConfig.findOne();
    if (config) {
        config.referrerCouponId = referrerCouponId;
        config.refereeCouponId = refereeCouponId;
        config.isActive = isActive !== undefined ? isActive : config.isActive;
        await config.save();
    } else {
        config = await ReferralConfig.create({
            referrerCouponId,
            refereeCouponId,
            isActive: isActive !== undefined ? isActive : true
        });
    }

    return res.status(200).json({
        success: true,
        data: config
    });
});

// @desc    Get current user's referral code and stats
// @route   GET /api/referral/my-code
// @access  Private/Customer
export const getMyReferralInfo = asyncHandler(async (req: any, res: Response) => {
    const userId = req.user.id;

    // Get config
    const config = await ReferralConfig.findOne();
    const isActive = config ? config.isActive : true;

    // 1. Get current user record
    let user = await User.findById(userId);
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    // 2. Legacy Migration: If user has no code in User document, check the old UserPlan record
    if (!user.referralCode || user.referralCode.trim() === '') {
        const legacyPlan = await UserPlan.findOne({ userId: user._id });
        if (legacyPlan?.referralCode) {
            // Save it to User model permanently via atomic update
            const migrated: any = await User.findOneAndUpdate(
                { _id: userId, referralCode: { $in: [null, ''] } },
                { $set: { referralCode: legacyPlan.referralCode.toUpperCase() } },
                { new: true }
            );
            if (migrated) {
                user = migrated;
            }
        }
    }

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // 3. Generation: If still no referral code, generate one (Permanent Lock)
    if (!user!.referralCode || user!.referralCode.trim() === '') {
        const prefix = (user!.name.substring(0, 3).replace(/[^a-zA-Z]/g, '').toUpperCase() || 'BU');
        let attempts = 0;
        let savedCorrectly = false;

        while (!savedCorrectly && attempts < 5) {
            attempts++;
            const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
            const candidateCode = prefix + randomSuffix;

            try {
                // Atomic persist - only sets if still missing
                const updated: any = await User.findOneAndUpdate(
                    { _id: userId, referralCode: { $in: [null, ''] } },
                    { $set: { referralCode: candidateCode } },
                    { new: true }
                );

                if (updated && updated.referralCode) {
                    console.log(`[REFERRAL] Generated and locked new code ${candidateCode} for User ${userId}`);
                    user = updated;
                    savedCorrectly = true;
                } else {
                    // Refetch to see if it was set by concurrent request
                    const refetched = await User.findById(userId);
                    if (refetched) {
                        user = refetched;
                        if (user.referralCode) savedCorrectly = true;
                    }
                }
            } catch (err) {
                console.error(`Referral collision for ${candidateCode}, attempt ${attempts}:`, err);
            }
        }
    }

    // Get stats from ReferralRecord
    const [signups, purchases] = await Promise.all([
        ReferralRecord.countDocuments({ referrerId: userId }),
        ReferralRecord.countDocuments({
            referrerId: userId,
            status: { $in: ['purchased', 'rewarded'] }
        })
    ]);

    // Get reward info if active
    let referrerReward = null;
    if (config?.referrerCouponId) {
        const coupon = await Coupon.findById(config.referrerCouponId);
        if (coupon) {
            referrerReward = {
                type: coupon.discountType,
                value: coupon.discountValue
            };
        }
    }

    return res.status(200).json({
        success: true,
        data: {
            referralCode: user?.referralCode || '',
            isActive: isActive,
            stats: {
                totalSignups: signups,
                totalPurchases: purchases
            },
            referrerReward
        }
    });
});

// @desc    Get referral code and get benefits
// @route   GET /api/referral/verify/:code
// @access  Public
export const verifyReferralCode = asyncHandler(async (req: Request, res: Response, next: any) => {
    const { code } = req.params;

    const user = await User.findOne({ referralCode: code.trim().toUpperCase() });
    if (!user) {
        return next(new AppError('Invalid referral code', 404));
    }

    const config = await ReferralConfig.findOne({ isActive: true });
    if (!config) {
        return res.status(200).json({
            success: true,
            data: { valid: true, benefits: null }
        });
    }

    // Fetch referee coupon info
    const coupon = await Coupon.findById(config.refereeCouponId);

    return res.status(200).json({
        success: true,
        data: {
            valid: true,
            referrerName: user.name,
            benefits: coupon ? {
                description: coupon.description,
                discountValue: coupon.discountValue,
                code: coupon.code
            } : null
        }
    });
});

// @desc    Get referral status for a customer (Admin)
// @route   GET /api/admin/referral/stats/:userId
// @access  Private/Admin
export const getAdminUserReferralStats = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

    let user = await User.findById(userId);

    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user!.referralCode) {
        const prefix = (user!.name.substring(0, 3).replace(/[^a-zA-Z]/g, '').toUpperCase() || 'BU');
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        const candidateCode = prefix + random;

        const updated: any = await User.findOneAndUpdate(
            { _id: userId, referralCode: { $in: [null, ''] } },
            { $set: { referralCode: candidateCode } },
            { new: true }
        );

        if (updated && updated.referralCode) {
            user = updated;
        } else {
            const refetched = await User.findById(userId);
            if (refetched) user = refetched;
        }
    }

    // Check if this user was referred by someone
    const referredByRecord = await ReferralRecord.findOne({ refereeId: userId }).populate('referrerId', 'name phone');

    // Check how many people this user has referred
    const referralsTable = await ReferralRecord.find({ referrerId: userId }).populate('refereeId', 'name phone createdAt');

    return res.status(200).json({
        success: true,
        data: {
            referralCode: user?.referralCode || '',
            referredBy: referredByRecord,
            referrals: referralsTable,
            summary: {
                totalSignups: referralsTable.length,
                totalPurchases: referralsTable.filter(r => r.status !== 'joined').length
            }
        }
    });
});

// Internal logic to handle the referral signup
export const signupWithReferral = async (userId: mongoose.Types.ObjectId, referralCode: string) => {
    try {
        const uppercaseCode = referralCode.toUpperCase();
        // Find the User with this code
        const referrerUser = await User.findOne({ referralCode: uppercaseCode });
        if (!referrerUser) {
            console.error(`Referral signup failed: Invalid code ${uppercaseCode}`);
            return;
        }

        // Check for self-referral
        if (referrerUser._id.toString() === userId.toString()) {
            console.error(`Referral signup failed: Self-referral for user ${userId}`);
            return;
        }

        // Check if user has already been referred
        const existingReferral = await ReferralRecord.findOne({ refereeId: userId });
        if (existingReferral) {
            console.error(`Referral signup failed: User ${userId} already has been referred`);
            return;
        }

        // Record the referral
        await ReferralRecord.create({
            referrerId: referrerUser._id,
            refereeId: userId,
            referralCode: uppercaseCode,
            status: 'joined'
        });

    } catch (err) {
        console.error('Error during referral signup process:', err);
    }
};

// Internal logic to process rewards when a referred user purchases a plan
export const processReferralReward = async (userId: mongoose.Types.ObjectId, purchaseId: mongoose.Types.ObjectId) => {
    try {
        // Find if this user was referred by someone
        const record = await ReferralRecord.findOne({
            refereeId: userId,
            status: 'joined' // Only process if not already rewarded/purchased
        });

        if (!record) return;

        // Mark as purchased
        record.status = 'purchased';
        record.purchaseId = purchaseId;
        await record.save();

        // Check config to see if we should auto-grant coupons
        const config = await ReferralConfig.findOne({ isActive: true });
        if (!config) return;

        // Perform coupon grants
        const [referrer, referee] = await Promise.all([
            User.findById(record.referrerId).select('phone'),
            User.findById(record.refereeId).select('phone')
        ]);

        if (referrer && referee) {
            await Promise.all([
                // Grant Referrer the benefit
                Coupon.findByIdAndUpdate(config.referrerCouponId, {
                    $addToSet: { allowedPhoneNumbers: referrer.phone }
                }),
                // Grant Referee the benefit
                Coupon.findByIdAndUpdate(config.refereeCouponId, {
                    $addToSet: { allowedPhoneNumbers: referee.phone }
                })
            ]);

            // Mark record as rewarded
            record.status = 'rewarded';
            record.rewardedAt = new Date();
            await record.save();

            console.log(`Referral reward processed: Referrer ${referrer.phone}, Referee ${referee.phone}`);
        }

    } catch (err) {
        console.error('Error during referral reward processing:', err);
    }
};
