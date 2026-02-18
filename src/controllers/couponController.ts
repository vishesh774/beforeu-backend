import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Coupon from '../models/Coupon';
import User from '../models/User';

const normalizePhone = (p: string) => p.replace(/\D/g, '').slice(-10);

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
        allowedPhoneNumbers: allowedPhoneNumbers ? allowedPhoneNumbers.map((p: string) => ({
            phone: normalizePhone(p),
            expiryDate: expiryDate ? new Date(expiryDate) : undefined
        })) : [],
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

// @desc    Get all coupons with associated users (for export and detailed list)
// @route   GET /api/coupons/with-users
// @access  Admin
export const getCouponsWithUsers = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { search, type, appliesTo, status } = req.query;

    const query: any = { $and: [] };

    // 1. Search Filter
    if (search) {
        query.$and.push({
            $or: [
                { code: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ]
        });
    }

    // 2. Type Filter
    if (type && type !== 'all') {
        query.type = type;
    }

    // 3. Applies To Filter
    if (appliesTo && appliesTo !== 'all') {
        query.appliesTo = appliesTo;
    }

    // 4. Status Filter
    const now = new Date();
    if (status === 'non-expired') {
        query.$and.push({
            $or: [
                { expiryDate: { $exists: false } },
                { expiryDate: null },
                { expiryDate: { $gt: now } }
            ]
        });
    } else if (status === 'expired') {
        query.expiryDate = { $lt: now };
    } else if (status === 'active') {
        query.isActive = true;
        query.$and.push({
            $or: [
                { expiryDate: { $exists: false } },
                { expiryDate: null },
                { expiryDate: { $gt: now } }
            ]
        });
    } else if (status === 'inactive') {
        query.isActive = false;
    }

    // If $and is empty, remove it to avoid empty query issues
    const finalQuery = query.$and.length > 0 ? query : { ...query };
    if (finalQuery.$and && finalQuery.$and.length === 0) delete finalQuery.$and;

    // 1. Get filtered coupons
    const coupons = await Coupon.find(finalQuery).sort({ createdAt: -1 });

    // 2. Identify all phone numbers from restricted coupons
    const allPhoneNumbers = new Set<string>();
    coupons.forEach(coupon => {
        if (coupon.type === 'restricted' && coupon.allowedPhoneNumbers) {
            coupon.allowedPhoneNumbers.forEach((ap: any) => {
                const phone = typeof ap === 'string' ? ap : ap.phone;
                if (phone) allPhoneNumbers.add(phone);
            });
        }
    });

    // 3. Find users matching these phone numbers
    // We need to handle potential +91 prefix issues
    const phoneArray = Array.from(allPhoneNumbers);
    const searchPhones = [...phoneArray];
    phoneArray.forEach(p => {
        if (p.startsWith('+91')) searchPhones.push(p.replace('+91', ''));
        else searchPhones.push('+91' + p);
    });

    const users = await User.find({
        phone: { $in: searchPhones },
        role: 'customer'
    }).select('name email phone');

    // Create a map for quick lookup by normalized phone
    const userMapByNormPhone = new Map<string, any>();
    users.forEach(u => {
        userMapByNormPhone.set(normalizePhone(u.phone), u);
    });

    const mappedUsers: Record<string, any[]> = {};

    coupons.forEach(coupon => {
        if (coupon.type === 'restricted' && coupon.allowedPhoneNumbers) {
            const usersList: any[] = [];
            coupon.allowedPhoneNumbers.forEach((ap: any) => {
                const phone = typeof ap === 'string' ? ap : ap.phone;
                const expiryDate = typeof ap === 'string' ? coupon.expiryDate : ap.expiryDate;

                const normPhone = normalizePhone(phone);
                const foundUser = userMapByNormPhone.get(normPhone);

                usersList.push({
                    name: foundUser?.name || 'Unknown',
                    email: foundUser?.email || 'N/A',
                    phone: phone, // Keep original
                    isRegistered: !!foundUser,
                    expiryDate: expiryDate
                });
            });
            mappedUsers[coupon._id.toString()] = usersList;
        }
    });

    // 5. Transform data for export
    const exportData: any[] = [];
    coupons.forEach(coupon => {
        if (coupon.type === 'restricted') {
            const usersList = mappedUsers[coupon._id.toString()] || [];
            usersList.forEach(u => {
                exportData.push({
                    couponCode: coupon.code,
                    couponType: 'restricted',
                    appliesTo: coupon.appliesTo,
                    discount: `${coupon.discountValue}%`,
                    userName: u.name,
                    userEmail: u.email,
                    userPhone: u.phone,
                    isRegistered: u.isRegistered,
                    userExpiry: u.expiryDate ? new Date(u.expiryDate).toLocaleDateString() : 'No expiry'
                });
            });
        } else {
            exportData.push({
                couponCode: coupon.code,
                couponType: 'public',
                appliesTo: coupon.appliesTo,
                discount: `${coupon.discountValue}%`,
                userName: 'Public Use',
                userEmail: 'N/A',
                userPhone: 'N/A',
                isRegistered: true
            });
        }
    });

    res.status(200).json({
        success: true,
        data: {
            coupons,
            exportData,
            mappedUsers
        }
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
export const getApplicableCoupons = asyncHandler(async (req: any, res: Response, _next: NextFunction) => {
    const userPhone = req.user.phone;
    const currentDate = new Date();

    // Find coupons that are:
    // 1. Active
    // 2. Not expired
    // 3. EITHER type is 'public' OR (type is 'restricted' AND allowedPhoneNumbers contains user.phone)
    // 4. Usage limit not exceeded (if strictly global usage, but user asked for multi-use which might complicate global tracking without user tracking. Assuming maxUses is global for now.)

    const query = {
        isActive: true,
        $and: [
            // Root checks for public or basic restricted availability
            {
                $or: [
                    { type: 'public' },
                    {
                        type: 'restricted',
                        $or: [
                            { allowedPhoneNumbers: normalizePhone(userPhone) },
                            { 'allowedPhoneNumbers.phone': normalizePhone(userPhone) }
                        ]
                    }
                ]
            },
            // Check usage limit
            {
                $or: [
                    { maxUses: -1 },
                    { $expr: { $lt: ["$usedCount", "$maxUses"] } }
                ]
            }
        ]
    };

    const coupons = await Coupon.find(query as any).sort({ discountValue: -1 });

    // 2. Post-fetch filter and map for mobile app response
    const applicableCoupons = coupons.filter(coupon => {
        if (coupon.type === 'public') {
            return !coupon.expiryDate || new Date(coupon.expiryDate) > currentDate;
        } else {
            // Find the specific number entry
            const normUserPhone = normalizePhone(userPhone);
            const entry: any = coupon.allowedPhoneNumbers.find((ap: any) => {
                const phone = typeof ap === 'string' ? ap : ap.phone;
                return normalizePhone(phone) === normUserPhone;
            });

            if (!entry) return false;

            // Check individual expiry
            const userExpiry = typeof entry === 'string' ? coupon.expiryDate : entry.expiryDate;
            return !userExpiry || new Date(userExpiry) > currentDate;
        }
    }).map(coupon => {
        const couponObj = coupon.toObject();
        if (couponObj.type === 'restricted') {
            const normUserPhone = normalizePhone(userPhone);
            const entry = couponObj.allowedPhoneNumbers.find((ap: any) => {
                const phone = typeof ap === 'string' ? ap : ap.phone;
                return normalizePhone(phone) === normUserPhone;
            });
            // Overwrite the root expiryDate with the user-specific one for the UI
            if (entry) {
                couponObj.expiryDate = typeof entry === 'string' ? couponObj.expiryDate : entry.expiryDate;
            }
        }
        return couponObj;
    });

    res.status(200).json({
        success: true,
        data: applicableCoupons
    });
});

// @desc    Validate coupon
// @route   POST /api/coupons/validate
// @access  Private
export const validateCoupon = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const { code, serviceId, isPlanPurchase } = req.body;
    const userPhone = req.user.phone;

    const coupon = await Coupon.findOne({
        code: code.toUpperCase(),
        isActive: true
    });

    if (!coupon) {
        return next(new AppError('Invalid coupon code', 404));
    }

    // Check Restricted
    if (coupon.type === 'restricted') {
        const normUserPhone = normalizePhone(userPhone);
        const entry: any = coupon.allowedPhoneNumbers.find((ap: any) => {
            const phone = typeof ap === 'string' ? ap : ap.phone;
            return normalizePhone(phone) === normUserPhone;
        });

        if (!entry) {
            return next(new AppError('This coupon is not available for your account', 400));
        }

        // Check Individual Expiry Date
        const userExpiry = typeof entry === 'string' ? coupon.expiryDate : entry.expiryDate;
        if (userExpiry && new Date() > userExpiry) {
            return next(new AppError('Coupon has expired for your number', 400));
        }
    } else {
        // For Public coupons, check root expiry
        if (coupon.expiryDate && new Date() > coupon.expiryDate) {
            return next(new AppError('Coupon has expired', 400));
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

    // Normalize all incoming numbers
    const incomingNormalized = phoneNumbers.map((p: string) => normalizePhone(p));

    // Filter out numbers that are already in the list to avoid duplicates (comparing normalized)
    const existingNormalized = coupon.allowedPhoneNumbers.map((ap: any) => {
        const phone = typeof ap === 'string' ? ap : ap.phone;
        return normalizePhone(phone);
    });
    const newNumbers = incomingNormalized.filter(phone => !existingNormalized.includes(phone));

    if (newNumbers.length > 0) {
        // Important: NEW numbers get the CURRENT global expiry date
        const currentGlobalExpiry = coupon.expiryDate;

        const entriesToAdd = newNumbers.map(p => ({
            phone: p,
            expiryDate: currentGlobalExpiry
        }));

        coupon.allowedPhoneNumbers.push(...entriesToAdd);
        await coupon.save();
    }

    res.status(200).json({
        success: true,
        message: `${newNumbers.length} phone numbers added successfully`,
        data: coupon
    });
});
// @desc    Get coupon by ID
// @route   GET /api/coupons/:id
// @access  Admin
export const getCouponById = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
        return next(new AppError('Coupon not found', 404));
    }

    res.status(200).json({
        success: true,
        data: coupon
    });
});

// @desc    Update coupon
// @route   PUT /api/coupons/:id
// @access  Admin
export const updateCoupon = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
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

    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
        return next(new AppError('Coupon not found', 404));
    }

    // If code is being changed, check if new code already exists
    if (code && code.toUpperCase() !== coupon.code) {
        const couponExists = await Coupon.findOne({ code: code.toUpperCase() });
        if (couponExists) {
            return next(new AppError('Coupon code already exists', 400));
        }
        coupon.code = code.toUpperCase();
    }

    if (description !== undefined) coupon.description = description;
    if (type !== undefined) coupon.type = type;
    if (discountValue !== undefined) coupon.discountValue = discountValue;
    if (appliesTo !== undefined) coupon.appliesTo = appliesTo;
    if (serviceId !== undefined) coupon.serviceId = serviceId;
    if (maxUses !== undefined) coupon.maxUses = maxUses;
    if (expiryDate !== undefined) coupon.expiryDate = expiryDate;
    if (isActive !== undefined) coupon.isActive = isActive;

    if (allowedPhoneNumbers !== undefined && Array.isArray(allowedPhoneNumbers)) {
        // Logic: Keep existing numbers with their ORIGINAL expiries.
        // Add new numbers with the NEW global expiryDate (from req.body).

        const existingMap = new Map();
        coupon.allowedPhoneNumbers.forEach((ap: any) => {
            const phone = typeof ap === 'string' ? ap : ap.phone;
            const expiry = typeof ap === 'string' ? coupon.expiryDate : ap.expiryDate;
            existingMap.set(normalizePhone(phone), expiry);
        });

        const newGlobalExpiry = expiryDate ? new Date(expiryDate) : coupon.expiryDate;

        coupon.allowedPhoneNumbers = allowedPhoneNumbers.map(p => {
            const norm = normalizePhone(p);
            // If already existed, KEEP its old expiry. Otherwise, use the new one.
            const oldExpiry = existingMap.get(norm);
            return {
                phone: p,
                expiryDate: oldExpiry !== undefined ? oldExpiry : newGlobalExpiry
            };
        });
    }

    await coupon.save();

    res.status(200).json({
        success: true,
        data: coupon
    });
});
