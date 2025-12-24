import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Coupon from '../models/Coupon';
import User from '../models/User';

// @desc    Create a new coupon
// @route   POST /api/coupons
// @access  Admin
export const createCoupon = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const {
        code,
        description,
        type,
        discountValue,
        appliesTo,
        serviceId,
        allowedPhoneNumbers,
        maxUses,
        expiryDate,
        isActive
    } = req.body;

    // Basic validation that might not be caught by mongoose
    if (appliesTo === 'service' && !serviceId) {
        return next(new AppError('Service ID is required when coupon applies to service', 400));
    }



    const couponExists = await Coupon.findOne({ code });
    if (couponExists) {
        return next(new AppError('Coupon already exists', 400));
    }

    const coupon = await Coupon.create({
        code,
        description,
        type,
        discountValue,
        appliesTo,
        serviceId,
        allowedPhoneNumbers,
        maxUses: maxUses || -1,
        expiryDate,
        isActive: isActive !== undefined ? isActive : true
    });

    res.status(201).json({
        success: true,
        data: coupon
    });
});

// @desc    Get all coupons
// @route   GET /api/coupons
// @access  Admin
export const getCoupons = asyncHandler(async (_req: Request, res: Response, _next: NextFunction) => {
    const coupons = await Coupon.find({}).sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        data: coupons
    });
});

// @desc    Delete coupon
// @route   DELETE /api/coupons/:id
// @access  Admin
export const deleteCoupon = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
        return next(new AppError('Coupon not found', 404));
    }

    await coupon.deleteOne();

    res.status(200).json({
        success: true,
        message: 'Coupon removed'
    });
});

// @desc    Get applicable coupons for logged in user
// @route   GET /api/coupons/applicable
// @access  Private (User)
export const getApplicableCoupons = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user) {
        return next(new AppError('User not found', 404));
    }

    const currentDate = new Date();

    // Find coupons that are:
    // 1. Active
    // 2. Not expired
    // 3. EITHER type is 'public' OR (type is 'restricted' AND allowedPhoneNumbers contains user.phone)
    // 4. Usage limit not exceeded (if strictly global usage, but user asked for multi-use which might complicate global tracking without user tracking. Assuming maxUses is global for now.)

    const query = {
        isActive: true,
        $or: [
            { expiryDate: { $exists: false } }, // No expiry
            { expiryDate: { $gt: currentDate } } // Not expired
        ],
        $and: [
            {
                $or: [
                    { type: 'public' },
                    { type: 'restricted', allowedPhoneNumbers: user.phone }
                ]
            },
            // Check maxUsage if not unlimited (-1)
            {
                $or: [
                    { maxUses: -1 },
                    { $expr: { $lt: ["$usedCount", "$maxUses"] } }
                ]
            }
        ]
    };

    const coupons = await Coupon.find(query).sort({ discountValue: -1 });

    res.status(200).json({
        success: true,
        data: coupons
    });
});

// @desc    Validate coupon
// @route   POST /api/coupons/validate
// @access  Private
export const validateCoupon = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const { code, serviceId, isPlanPurchase } = req.body;
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user) {
        return next(new AppError('User not found', 404));
    }

    const coupon = await Coupon.findOne({
        code: code.toUpperCase(),
        isActive: true
    });

    if (!coupon) {
        return next(new AppError('Invalid coupon code', 404));
    }

    // Check expiry
    if (coupon.expiryDate && new Date() > coupon.expiryDate) {
        return next(new AppError('Coupon has expired', 400));
    }

    // Check usage limit
    if (coupon.maxUses !== -1 && coupon.usedCount >= coupon.maxUses) {
        return next(new AppError('Coupon usage limit exceeded', 400));
    }

    // Check Restricted
    if (coupon.type === 'restricted') {
        if (!coupon.allowedPhoneNumbers.includes(user.phone)) {
            return next(new AppError('This coupon is not available for your account', 400));
        }
    }

    // Check Relevance (Plan vs Service)
    if (coupon.appliesTo === 'service') {
        if (isPlanPurchase) {
            return next(new AppError('This coupon is only applicable for service bookings, not plan purchases.', 400));
        }
        // If serviceId is provided, check if it matches.
        // If coupon.serviceId is set, inputs must match.
        // However, if the cart has multiple items, validation logic might be complex.
        // Assuming single service checkout or strictly passing the serviceId being validated.
        if (serviceId && coupon.serviceId && coupon.serviceId !== serviceId) {
            return next(new AppError('This coupon is not applicable for this service.', 400));
        }
        // If serviceId not provided in request but coupon is specific
        if (!serviceId && coupon.serviceId) {
            // Frontend might call validate generally. We can warn.
            // But usually validation happens at cart.
        }
    } else if (coupon.appliesTo === 'plan') {
        if (!isPlanPurchase) {
            return next(new AppError('This coupon is only applicable for plan purchases.', 400));
        }
    }

    res.status(200).json({
        success: true,
        data: {
            valid: true,
            couponWithDiscount: {
                code: coupon.code,
                discountType: coupon.discountType,
                discountValue: coupon.discountValue,
                appliesTo: coupon.appliesTo
            }
        }
    });
});

// @desc    Append phone numbers to a restricted coupon
// @route   POST /api/coupons/:id/append-phones
// @access  Admin
export const appendPhoneNumbers = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { phoneNumbers } = req.body;
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
        return next(new AppError('Coupon not found', 404));
    }

    if (coupon.type !== 'restricted') {
        return next(new AppError('Phone numbers can only be added to restricted coupons', 400));
    }

    if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
        return next(new AppError('Phone numbers array is required', 400));
    }

    // Filter out numbers that are already in the list to avoid duplicates
    const newNumbers = phoneNumbers.filter(phone => !coupon.allowedPhoneNumbers.includes(phone));

    if (newNumbers.length > 0) {
        coupon.allowedPhoneNumbers.push(...newNumbers);
        await coupon.save();
    }

    res.status(200).json({
        success: true,
        message: `${newNumbers.length} phone numbers added successfully`,
        data: coupon
    });
});
