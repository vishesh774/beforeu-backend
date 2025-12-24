import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import Plan from '../models/Plan';
import User from '../models/User';
import UserPlan from '../models/UserPlan';
import UserCredits from '../models/UserCredits';
import PlanTransaction from '../models/PlanTransaction';
import Booking from '../models/Booking';
import OrderItem from '../models/OrderItem';
import mongoose from 'mongoose';
import { getPlanPurchaseService } from '../utils/systemServices';

// @desc    Get all plans
// @route   GET /api/admin/plans or GET /api/auth/plans
// @access  Private/Admin (for admin) or Public (for customers - only active plans)
export const getAllPlans = asyncHandler(async (req: Request, res: Response) => {
  const { planStatus } = req.query;

  const filter: any = {};
  // If accessed via /api/auth/plans (customer route), only show active plans
  const isCustomerRoute = req.path.includes('/auth/plans');
  if (isCustomerRoute) {
    filter.planStatus = 'active';
  } else if (planStatus !== undefined) {
    filter.planStatus = planStatus;
  }

  const plans = await Plan.find(filter)
    .sort({ finalPrice: -1 });

  // Transform _id to id for frontend
  const transformedPlans = plans.map(plan => ({
    ...plan.toObject(),
    id: plan._id.toString()
  }));

  res.status(200).json({
    success: true,
    data: {
      plans: transformedPlans
    }
  });
});


// @desc    Get all user plans (users who purchased plans)
// @route   GET /api/admin/user-plans
// @access  Private/Admin
export const getUserPlans = asyncHandler(async (_: Request, res: Response) => {
  // Aggregate to get user plan details with user and plan info
  const userPlans = await UserPlan.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $unwind: '$user' },
    {
      $lookup: {
        from: 'plans',
        let: { planId: { $toObjectId: '$activePlanId' } }, // Convert string ID to ObjectId for lookup if needed, or if stored as string in UserPlan and ObjectId in Plans, need conversion
        // UserPlan.activePlanId is defined as String in schema in step 3122. Plan._id is ObjectId.
        // So we need to convert activePlanId string to ObjectId for matching.
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$planId'] } } }
        ],
        as: 'plan'
      }
    },
    { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'usercredits',
        localField: 'userId',
        foreignField: 'userId',
        as: 'credits'
      }
    },
    { $unwind: { path: '$credits', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        userId: '$user._id',
        userName: '$user.name',
        userEmail: '$user.email',
        userPhone: '$user.phone',
        planName: { $ifNull: ['$plan.planName', 'Unknown Plan'] },
        planId: '$activePlanId',
        status: {
          $cond: { if: { $ifNull: ['$plan', false] }, then: 'Active', else: 'Expired/Unknown' }
        }, // Simplistic status logic for now
        totalCredits: { $ifNull: ['$plan.totalCredits', 0] },
        remainingCredits: { $ifNull: ['$credits.credits', 0] },
        purchaseDate: '$updatedAt', // UserPlan updatedAt is essentially the last purchase/activation time
        expiresAt: '$expiresAt',
        createdAt: '$createdAt'
      }
    },
    { $sort: { purchaseDate: -1 } }
  ]);

  res.status(200).json({
    success: true,
    data: {
      userPlans
    }
  });
});

// @desc    Get all plan transactions
// @route   GET /api/admin/plan-transactions
// @access  Private/Admin
export const getPlanTransactions = asyncHandler(async (_: Request, res: Response) => {
  const transactions = await PlanTransaction.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $unwind: '$user' },
    {
      $lookup: {
        from: 'usercredits',
        localField: 'userId',
        foreignField: 'userId',
        as: 'userCredits'
      }
    },
    {
      $unwind: { path: '$userCredits', preserveNullAndEmptyArrays: true }
    },
    {
      $lookup: {
        from: 'userplans',
        localField: 'userId',
        foreignField: 'userId',
        as: 'userPlan'
      }
    },
    {
      $unwind: { path: '$userPlan', preserveNullAndEmptyArrays: true }
    },
    {
      $project: {
        _id: 1,
        userId: '$user._id',
        userName: '$user.name',
        userEmail: '$user.email',
        userPhone: '$user.phone',
        planName: '$planSnapshot.name',
        amount: '$amount',
        credits: '$credits',
        remainingCredits: { $ifNull: ['$userCredits.credits', 0] },
        status: '$status',
        orderId: '$orderId',
        transactionId: '$transactionId',
        purchaseDate: '$createdAt',
        expiresAt: '$userPlan.expiresAt'
      }
    },
    { $sort: { purchaseDate: -1 } }
  ]);

  // Fetch existing active plans to display as "legacy" transactions if they aren't in the transactions table
  // This ensures we show the "active plan info" the user sees
  const activePlans = await UserPlan.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $unwind: '$user' },
    {
      $lookup: {
        from: 'plans',
        let: { planId: { $toObjectId: '$activePlanId' } },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$planId'] } } }
        ],
        as: 'plan'
      }
    },
    { $unwind: { path: '$plan', preserveNullAndEmptyArrays: false } }, // STRICTLY require a plan to exist
    {
      $lookup: {
        from: 'usercredits',
        localField: 'userId',
        foreignField: 'userId',
        as: 'credits'
      }
    },
    { $unwind: { path: '$credits', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: { $concat: ['LEGACY-', { $toString: '$_id' }] }, // Mock ID for routing
        userId: '$user._id',
        userName: '$user.name',
        userEmail: '$user.email',
        userPhone: '$user.phone',
        planName: { $ifNull: ['$plan.planName', 'Unknown Plan'] },
        amount: { $ifNull: ['$plan.finalPrice', 0] },
        credits: { $ifNull: ['$plan.totalCredits', 0] },
        remainingCredits: { $ifNull: ['$credits.credits', 0] }, // Use previously looked up credits
        status: { $cond: { if: { $ifNull: ['$plan', false] }, then: 'completed', else: 'failed' } }, // Map active to completed
        orderId: { $concat: ['LEGACY-', { $toString: '$_id' }] }, // Mock Order ID
        purchaseDate: '$updatedAt',
        expiresAt: '$expiresAt'
      }
    }
  ]);

  // Filter out active plans that already have a corresponding real transaction
  // This prevents duplicates for users who purchased via the new flow (which creates both a transaction and updates UserPlan)
  const uniqueActivePlans = activePlans.filter(ap => {
    const hasTransaction = transactions.some(tx =>
      tx.userId.toString() === ap.userId.toString() &&
      (tx.planName === ap.planName || (tx.planSnapshot && tx.planSnapshot.name === ap.planName))
    );
    return !hasTransaction;
  });

  const allTransactions = [...transactions, ...uniqueActivePlans];

  // Sort combined results by date desc
  allTransactions.sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());


  res.status(200).json({
    success: true,
    data: {
      transactions: allTransactions
    }
  });
});

// @desc    Get plan transaction details
// @route   GET /api/admin/plan-transactions/:id
// @access  Private/Admin
export const getPlanTransactionDetails = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;
  let transaction: any = null;
  let userId: any = null;

  // Check if it's a legacy ID
  if (id.startsWith('LEGACY-')) {
    const userPlanId = id.replace('LEGACY-', '');
    // Fetch from UserPlan
    const userPlan = await UserPlan.findById(userPlanId);
    if (!userPlan) {
      return next(new AppError('Transaction not found', 404));
    }

    // Fetch related plan details
    const activePlan = await Plan.findById(userPlan.activePlanId);
    if (!activePlan) {
      // Should verify if activePlanId is valid, if not, handle gracefully
    }

    userId = userPlan.userId;

    // Mock transaction object
    transaction = {
      _id: id,
      userId: userPlan.userId,
      orderId: id,
      planName: activePlan?.planName || 'Unknown Plan',
      amount: activePlan?.finalPrice || 0,
      credits: activePlan?.totalCredits || 0,
      status: activePlan ? 'completed' : 'failed',
      planSnapshot: activePlan ? {
        name: activePlan.planName,
        originalPrice: activePlan.originalPrice,
        finalPrice: activePlan.finalPrice
      } : {},
      purchaseDate: userPlan.updatedAt
    };
  } else {
    // Normal Transaction ID
    const planTx = await PlanTransaction.findById(id);
    if (!planTx) {
      return next(new AppError('Transaction not found', 404));
    }
    transaction = planTx.toObject();
    // Normalize fields to match frontend expectation if needed (already matches schema)
    transaction.planName = planTx.planSnapshot.name;
    transaction.purchaseDate = planTx.createdAt;

    // Ensure payment details are exposed
    transaction.paymentDetails = planTx.paymentDetails;
    transaction.paymentBreakdown = planTx.paymentBreakdown;

    userId = planTx.userId;
  }

  // Fetch active plan details for expiry
  const userPlan = await UserPlan.findOne({ userId });

  // Fetch User Details
  const user = await User.findById(userId).select('name email phone');

  // Fetch User Credits (Wallet Balance)
  const userCredits = await UserCredits.findOne({ userId });
  const remainingCredits = userCredits?.credits || 0;

  // Fetch Booking History
  const bookings = await Booking.find({ userId })
    .sort({ createdAt: -1 })
    .select('bookingId createdAt totalAmount creditsUsed status paymentStatus items');

  res.status(200).json({
    success: true,
    data: {
      transaction,
      user,
      stats: {
        totalCredits: transaction.credits,
        remainingCredits,
        expiryDate: userPlan?.expiresAt || 'Lifetime'
      },
      bookings
    }
  });
});

// @desc    Get single plan
// @route   GET /api/admin/plans/:id
// @access  Private/Admin
export const getPlan = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const plan = await Plan.findById(id);

  if (!plan) {
    return next(new AppError('Plan not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      plan: {
        ...plan.toObject(),
        id: plan._id.toString()
      }
    }
  });
});

// @desc    Create plan
// @route   POST /api/admin/plans
// @access  Private/Admin
export const createPlan = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { planName, planTitle, planSubTitle, planStatus, allowSOS, totalCredits, services, originalPrice, finalPrice, totalMembers, validity, extraDiscount } = req.body;

  if (!planName || !planName.trim()) {
    return next(new AppError('Plan name is required', 400));
  }

  if (!planTitle || !planTitle.trim()) {
    return next(new AppError('Plan title is required', 400));
  }

  if (!planSubTitle || !planSubTitle.trim()) {
    return next(new AppError('Plan subtitle is required', 400));
  }

  if (originalPrice === undefined || originalPrice === null || originalPrice < 0) {
    return next(new AppError('Valid original price is required', 400));
  }

  if (finalPrice === undefined || finalPrice === null || finalPrice < 0) {
    return next(new AppError('Valid final price is required', 400));
  }

  if (totalMembers === undefined || totalMembers === null || totalMembers < 1) {
    return next(new AppError('Total members must be at least 1', 400));
  }

  if (totalCredits === undefined || totalCredits === null || totalCredits < 0) {
    return next(new AppError('Total credits must be a valid number and cannot be negative', 400));
  }

  if (!Array.isArray(services)) {
    return next(new AppError('Services must be an array', 400));
  }

  // Validate services array
  const validServices = services.filter((service: any) =>
    service.serviceId &&
    service.subServiceId &&
    service.subServiceName &&
    (service.totalCountLimit === undefined || (typeof service.totalCountLimit === 'number' && service.totalCountLimit >= 0))
  );

  // Check for duplicate subServiceIds
  const subServiceIds = validServices.map((s: any) => s.subServiceId);
  if (new Set(subServiceIds).size !== subServiceIds.length) {
    return next(new AppError('Each sub-service can only be added once to a plan', 400));
  }

  const plan = await Plan.create({
    planName: planName.trim(),
    planTitle: planTitle.trim(),
    planSubTitle: planSubTitle.trim(),
    planStatus: planStatus || 'active',
    allowSOS: allowSOS !== undefined ? allowSOS : false,
    totalCredits: totalCredits !== undefined ? totalCredits : 0,
    services: validServices,
    originalPrice,
    finalPrice,
    totalMembers,
    validity: validity || 365,
    extraDiscount: extraDiscount !== undefined && extraDiscount !== null ? extraDiscount : undefined
  });

  res.status(201).json({
    success: true,
    data: {
      plan: {
        ...plan.toObject(),
        id: plan._id.toString()
      }
    }
  });
});

// @desc    Update plan
// @route   PUT /api/admin/plans/:id
// @access  Private/Admin
export const updatePlan = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;
  const { planName, planTitle, planSubTitle, planStatus, allowSOS, totalCredits, services, originalPrice, finalPrice, totalMembers, validity, extraDiscount } = req.body;

  const plan = await Plan.findById(id);

  if (!plan) {
    return next(new AppError('Plan not found', 404));
  }

  // Update fields if provided
  if (planName !== undefined) {
    if (!planName.trim()) {
      return next(new AppError('Plan name cannot be empty', 400));
    }
    plan.planName = planName.trim();
  }

  if (planTitle !== undefined) {
    if (!planTitle.trim()) {
      return next(new AppError('Plan title cannot be empty', 400));
    }
    plan.planTitle = planTitle.trim();
  }

  if (planSubTitle !== undefined) {
    if (!planSubTitle.trim()) {
      return next(new AppError('Plan subtitle cannot be empty', 400));
    }
    plan.planSubTitle = planSubTitle.trim();
  }

  if (planStatus !== undefined) {
    if (!['active', 'inactive'].includes(planStatus)) {
      return next(new AppError('Plan status must be either "active" or "inactive"', 400));
    }
    plan.planStatus = planStatus;
  }

  if (allowSOS !== undefined) {
    plan.allowSOS = allowSOS;
  }

  if (totalCredits !== undefined) {
    if (totalCredits < 0) {
      return next(new AppError('Total credits cannot be negative', 400));
    }
    plan.totalCredits = totalCredits;
  }

  if (originalPrice !== undefined) {
    if (originalPrice < 0) {
      return next(new AppError('Original price cannot be negative', 400));
    }
    plan.originalPrice = originalPrice;
  }

  if (finalPrice !== undefined) {
    if (finalPrice < 0) {
      return next(new AppError('Final price cannot be negative', 400));
    }
    plan.finalPrice = finalPrice;
  }

  if (totalMembers !== undefined) {
    if (totalMembers < 1) {
      return next(new AppError('Total members must be at least 1', 400));
    }
    plan.totalMembers = totalMembers;
  }

  if (validity !== undefined) {
    if (validity <= 0) {
      return next(new AppError('Validity must be a positive number', 400));
    }
    plan.validity = validity;
  }

  if (extraDiscount !== undefined) {
    if (extraDiscount === null) {
      plan.extraDiscount = undefined;
    } else if (extraDiscount < 0 || extraDiscount > 100) {
      return next(new AppError('Extra discount must be between 0 and 100', 400));
    } else {
      plan.extraDiscount = extraDiscount;
    }
  }

  if (services !== undefined) {
    if (!Array.isArray(services)) {
      return next(new AppError('Services must be an array', 400));
    }

    // Validate services array
    const validServices = services.filter((service: any) =>
      service.serviceId &&
      service.subServiceId &&
      service.subServiceName &&
      (service.totalCountLimit === undefined || (typeof service.totalCountLimit === 'number' && service.totalCountLimit >= 0))
    );

    // Check for duplicate subServiceIds
    const subServiceIds = validServices.map((s: any) => s.subServiceId);
    if (new Set(subServiceIds).size !== subServiceIds.length) {
      return next(new AppError('Each sub-service can only be added once to a plan', 400));
    }

    plan.services = validServices;
  }

  await plan.save();

  res.status(200).json({
    success: true,
    data: {
      plan: {
        ...plan.toObject(),
        id: plan._id.toString()
      }
    }
  });
});

// @desc    Delete plan
// @route   DELETE /api/admin/plans/:id
// @access  Private/Admin
export const deletePlan = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const plan = await Plan.findById(id);

  if (!plan) {
    return next(new AppError('Plan not found', 404));
  }

  await plan.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Plan deleted successfully'
  });
});

// @desc    Purchase a plan
// @route   POST /api/auth/plans/purchase
// @access  Private
export const purchasePlan = asyncHandler(async (req: AuthRequest, res: Response, next: any) => {
  const { planId } = req.body;
  const userIdString = req.user?.id;

  if (!userIdString) {
    return next(new AppError('User not authenticated', 401));
  }

  if (!planId) {
    return next(new AppError('Plan ID is required', 400));
  }

  // Find the plan
  const plan = await Plan.findById(planId);
  if (!plan) {
    return next(new AppError('Plan not found', 404));
  }

  if (plan.planStatus !== 'active') {
    return next(new AppError('Plan is not available for purchase', 400));
  }

  // Convert userId string to ObjectId
  const userId = new mongoose.Types.ObjectId(userIdString);

  // Check if user exists
  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // --- NEW: Create Booking and OrderItem for Plan Purchase ---
  try {
    const { service, variant } = await getPlanPurchaseService();

    // Generate booking ID
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const count = await Booking.countDocuments({
      bookingId: { $regex: new RegExp(`^BOOK-${dateStr}-`) }
    });
    const bookingId = `BOOK-${dateStr}-${String(count + 1).padStart(3, '0')}`;

    const booking = await Booking.create({
      userId: userId,
      bookingId,
      addressId: 'PLAN_PURCHASE',
      address: {
        label: 'Plan Purchase',
        fullAddress: 'Digital Service Activation',
      },
      bookingType: 'PLAN_PURCHASE',
      itemTotal: plan.finalPrice,
      totalAmount: plan.finalPrice,
      totalOriginalAmount: plan.originalPrice,
      status: 'pending',
      paymentStatus: 'pending',
      notes: `Purchase of Plan: ${plan.planName}`
    });

    await OrderItem.create({
      bookingId: booking._id,
      serviceId: service._id,
      serviceVariantId: variant._id,
      serviceName: service.name,
      variantName: variant.name,
      quantity: 1,
      originalPrice: plan.originalPrice,
      finalPrice: plan.finalPrice,
      creditValue: plan.totalCredits,
      estimatedTimeMinutes: 5,
      customerVisitRequired: false,
      status: 'pending',
      startJobOtp: 'NONE', // No start OTP
    });

    // Create Plan Transaction Record (marked as pending)
    await PlanTransaction.create({
      userId,
      planId: plan._id,
      orderId: bookingId,
      amount: plan.finalPrice,
      credits: plan.totalCredits,
      planSnapshot: {
        name: plan.planName,
        originalPrice: plan.originalPrice,
        finalPrice: plan.finalPrice
      },
      status: 'pending',
    });

    res.status(200).json({
      success: true,
      data: {
        plan: {
          ...plan.toObject(),
          id: plan._id.toString()
        },
        bookingId: booking.bookingId
      },
      message: 'Plan purchase initiated. Awaiting admin completion.'
    });

  } catch (error) {
    console.error('[purchasePlan] Error creating plan booking:', error);
    return next(new AppError('Failed to initiate plan purchase', 500));
  }
});

