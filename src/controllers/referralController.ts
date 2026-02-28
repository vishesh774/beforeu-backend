import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import mongoose from 'mongoose';
import UserPlan from '../models/UserPlan';
import ReferralConfig from '../models/ReferralConfig';
import ReferralRecord from '../models/ReferralRecord';
import User from '../models/User';
import Coupon from '../models/Coupon';
import { getPlanHolderId } from '../utils/userHelpers';

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

    res.status(200).json({
        success: true,
        data: config
    });
});

// @desc    Get current user's referral code and stats
// @route   GET /api/referral/my-code
// @access  Private/Customer
export const getMyReferralInfo = asyncHandler(async (req: any, res: Response) => {
    const userId = req.user._id;

    // Get plan holder ID for shared plans
    const planHolderId = await getPlanHolderId(userId);

    // Get the referral code from the plan holder's plan record
    const userPlan = await UserPlan.findOne({ userId: planHolderId });

    // If they have an active plan but no referral code, generate one
    if (userPlan && userPlan.activePlanId && !userPlan.referralCode) {
        const user = await User.findById(planHolderId);
        // Generate a code: 3 letters of name + 3 random alphanumeric
        const prefix = (user?.name?.substring(0, 3).replace(/[^a-zA-Z]/g, '').toUpperCase() || 'BU');
        const random = Math.random().toString(36).substring(2, 5).toUpperCase();
        const code = prefix + random;
        userPlan.referralCode = code;
        await userPlan.save();
    }

    // Get stats
    const signups = await ReferralRecord.countDocuments({ referrerId: planHolderId });
    const purchases = await ReferralRecord.countDocuments({ referrerId: planHolderId, status: { $in: ['purchased', 'rewarded'] } });

    res.status(200).json({
        success: true,
        data: {
            referralCode: userPlan?.referralCode || null,
            stats: {
                signups,
                purchases
            }
        }
    });
});

// @desc    Verify referral code and get benefits
// @route   GET /api/referral/verify/:code
// @access  Public
export const verifyReferralCode = asyncHandler(async (req: Request, res: Response, next: any) => {
    const { code } = req.params;

    const userPlan = await UserPlan.findOne({ referralCode: code.toUpperCase() });
    if (!userPlan) {
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

    res.status(200).json({
        success: true,
        data: {
            valid: true,
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

    // Check if this user was referred by someone
    const referredByRecord = await ReferralRecord.findOne({ refereeId: userId }).populate('referrerId', 'name phone');

    // Check how many people this user (or their plan) has referred
    const referralsTable = await ReferralRecord.find({ referrerId: userId }).populate('refereeId', 'name phone createdAt');

    res.status(200).json({
        success: true,
        data: {
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
        // Find the UserPlan with this code (shared plan holder)
        const userPlan = await UserPlan.findOne({ referralCode: uppercaseCode });
        if (!userPlan) {
            console.error(`Referral signup failed: Invalid code ${uppercaseCode}`);
            return;
        }

        // Check for self-referral
        if (userPlan.userId.toString() === userId.toString()) {
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
            referrerId: userPlan.userId,
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
