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
import { getRazorpayInstance } from './paymentController';
import { getFamilyGroupIds } from '../utils/userHelpers';
import { sendPlanPurchaseMessage, sendInternalPlanPurchaseNotification } from '../services/whatsappService';
import { scheduleWhatsAppMessage } from '../services/schedulerService';
import FamilyMember from '../models/FamilyMember';
import { assignCRMTask } from '../services/crmTaskService';
import { notifyAccountsTeamOnPlanPurchase } from '../services/emailService';
import { generateInvoiceBuffer } from '../utils/pdfGenerator';
import CompanySettings from '../models/CompanySettings';

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

  // Fetch Booking History for the entire family group
  const familyIds = await getFamilyGroupIds(userId);

  // Fetch Family Members
  const familyMembers = await FamilyMember.find({ userId });

  const bookings = await Booking.find({ userId: { $in: familyIds } })
    .sort({ createdAt: -1 })
    .populate('userId', 'name')
    .select('bookingId createdAt totalAmount creditsUsed status paymentStatus items userId');

  // Map bookings to include userName at the top level for the frontend
  const mappedBookings = bookings.map(b => {
    const bookingObj = b.toObject();
    return {
      ...bookingObj,
      userName: (bookingObj.userId as any)?.name || 'Unknown'
    };
  });

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
      familyMembers,
      bookings: mappedBookings
    }
  });
});

// @desc    Verify payment status for a pending plan transaction from Razorpay
// @route   POST /api/admin/plan-transactions/:id/verify
// @access  Private/Admin
export const verifyPlanPaymentStatus = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  // 1. Find the transaction
  const planTx = await PlanTransaction.findById(id);
  if (!planTx) {
    return next(new AppError('Transaction not found', 404));
  }

  if (planTx.status === 'completed') {
    return res.status(200).json({
      success: true,
      message: 'Transaction is already completed',
      data: planTx
    });
  }

  if (!planTx.orderId) {
    return next(new AppError('No order ID associated with this transaction', 400));
  }

  try {
    const razorpay = getRazorpayInstance();

    console.log(`[verifyPlanPaymentStatus] Verifying Razorpay Order ID: ${planTx.orderId} for Transaction: ${planTx.transactionId}`);

    let payments;
    try {
      // 2. Fetch payments for this order from Razorpay
      // This is the correct way to get payments linked specifically to an order
      payments = await razorpay.orders.fetchPayments(planTx.orderId);
    } catch (err: any) {
      console.error(`[verifyPlanPaymentStatus] Razorpay API Error for Order ${planTx.orderId}:`, err);
      return res.status(200).json({
        success: false,
        message: `Razorpay returned an error: ${err.description || err.message || 'Unknown error'}. This usually means the Order ID does not exist on the account associated with the current API keys.`,
        data: { status: planTx.status, orderId: planTx.orderId, error: err.description }
      });
    }

    console.log(`[verifyPlanPaymentStatus] Razorpay response count: ${payments.count || 0}`);

    const items = payments.items || [];

    if (items.length === 0) {
      console.log(`[verifyPlanPaymentStatus] No payments found for Order ID: ${planTx.orderId}`);
      return res.status(200).json({
        success: false,
        message: `No payments found for order ${planTx.orderId} on Razorpay. The order exists, but no successful payments were recorded for it.`,
        data: { status: planTx.status, orderId: planTx.orderId }
      });
    }

    // 3. Find a successful (captured) payment
    const successfulPayment = items.find((p: any) => p.status === 'captured');

    if (!successfulPayment) {
      // If no captured payment, check if any is authorized (can be captured)
      const authorizedPayment = items.find((p: any) => p.status === 'authorized');

      console.log(`[verifyPlanPaymentStatus] No captured payment found. Razorpay status: ${items[0]?.status}`);

      return res.status(200).json({
        success: false,
        message: authorizedPayment
          ? 'Payment is authorized but not yet captured. Please capture it manually in Razorpay dashboard or wait for automatic capture.'
          : `No successful (captured) payment found on Razorpay for order ${planTx.orderId}. Current status: ${items[0]?.status || 'unknown'}.`,
        data: {
          status: planTx.status,
          razorpayStatus: items[0]?.status,
          orderId: planTx.orderId
        }
      });
    }

    // 4. If successful payment found, activate the plan
    const userId = planTx.userId;
    const paymentId = successfulPayment.id;
    console.log(`[verifyPlanPaymentStatus] Found captured payment: ${paymentId}. Proceeding with activation.`);

    // Update Transaction
    planTx.status = 'completed';
    planTx.paymentId = paymentId;
    planTx.paymentDetails = successfulPayment;
    await planTx.save();

    // Update Plan and Credits
    const plan = await Plan.findById(planTx.planId);
    if (plan) {
      const expiryDate = new Date();
      const validityDays = plan.validity || 365;
      expiryDate.setDate(expiryDate.getDate() + validityDays);

      let userPlan = await UserPlan.findOne({ userId });
      if (!userPlan) {
        await UserPlan.create({
          userId,
          activePlanId: plan._id.toString(),
          expiresAt: expiryDate
        });
      } else {
        userPlan.activePlanId = plan._id.toString();
        userPlan.expiresAt = expiryDate;
        await userPlan.save();
      }

      let userCredits = await UserCredits.findOne({ userId });
      if (!userCredits) {
        await UserCredits.create({ userId, credits: plan.totalCredits });
      } else {
        userCredits.credits += plan.totalCredits;
        await userCredits.save();
      }

      // --- WhatsApp Notification (Plan Purchase) ---
      try {
        const userForMsg = await User.findById(userId);
        if (userForMsg) {
          let homeRepairCount: number | string = 0;
          let advisoryCount: number | string = 0;
          let repairUnlimited = false;
          let advisoryUnlimited = false;

          if (plan.services && Array.isArray(plan.services)) {
            for (const s of plan.services) {
              const name = s.subServiceName || '';
              const isRepair = ['Electrician', 'Plumber', 'Carpenter'].some(t => name.includes(t));
              const isAdvisory = ['Advocate', 'Doctor', 'Physician', 'Medical'].some(t => name.includes(t));

              if (isRepair) {
                if (s.totalCountLimit === undefined || s.totalCountLimit === null) repairUnlimited = true;
                else if (typeof homeRepairCount === 'number') homeRepairCount += s.totalCountLimit;
              }
              if (isAdvisory) {
                if (s.totalCountLimit === undefined || s.totalCountLimit === null) advisoryUnlimited = true;
                else if (typeof advisoryCount === 'number') advisoryCount += s.totalCountLimit;
              }
            }
          }
          if (repairUnlimited) homeRepairCount = "Unlimited";
          if (advisoryUnlimited) advisoryCount = "Unlimited";

          const sosCount = plan.allowSOS ? "Unlimited" : "0";

          sendPlanPurchaseMessage({
            phone: userForMsg.phone,
            userName: userForMsg.name,
            planName: plan.planName,
            membersCount: plan.totalMembers,
            validity: plan.validity,
            sosCount,
            homeRepairCount,
            advisoryCount
          }).catch(err => console.error('[PlanController] WhatsApp plan msg failed:', err));

          // Schedule "Add Family Member" prompt (8 hours delay)
          scheduleWhatsAppMessage(userForMsg.phone, 'add_family_member', [], 8)
            .catch(err => console.error('[PlanController] WhatsApp schedule family msg failed:', err));

          // Notify Admins
          sendInternalPlanPurchaseNotification(
            userForMsg.name,
            userForMsg.phone,
            plan.planName,
            plan.finalPrice
          ).catch(err => console.error('[PlanController] WhatsApp internal notify failed:', err));
        }
      } catch (waError) {
        console.error('[PlanController] Error preparing WhatsApp msg:', waError);
      }
      // ---------------------------------------------

      // --- NEW: Email Notification to Accounts Team ---
      try {
        const userForEmail = await User.findById(userId);
        if (userForEmail) {
          const companySettings = (await CompanySettings.findOne()) || {
            invoicePrefix: "BU"
          };
          const settings = companySettings as any;
          const invoiceNumber = `${settings.invoicePrefix}-${planTx.transactionId}`;

          const invoiceDataForEmail = {
            invoiceNumber,
            date: planTx.createdAt,
            customerName: userForEmail.name,
            customerPhone: userForEmail.phone,
            customerEmail: userForEmail.email || 'N/A',
            customerAddress: "N/A",
            items: [{
              description: `Plan Purchase: ${plan.planName}`,
              quantity: 1,
              price: plan.finalPrice,
              total: plan.finalPrice
            }],
            subtotal: plan.finalPrice,
            discount: planTx.discountAmount || 0,
            creditsUsed: 0,
            taxBreakdown: planTx.paymentBreakdown || [],
            total: planTx.amount || 0,
            paymentStatus: 'completed',
            paymentId: planTx.paymentId,
            paymentMethod: successfulPayment.method || 'Online'
          };

          const pdfBuffer = await generateInvoiceBuffer(invoiceDataForEmail as any);

          notifyAccountsTeamOnPlanPurchase({
            customerName: userForEmail.name,
            customerPhone: userForEmail.phone,
            customerEmail: userForEmail.email || 'N/A',
            planName: plan.planName,
            amount: planTx.amount,
            invoiceNumber,
            purchaseDate: planTx.createdAt,
            pdfBuffer
          }).catch(err => console.error('[PlanController] Email notification failed:', err));
        }
      } catch (emailError) {
        console.error('[PlanController] Error preparing Email notification:', emailError);
      }
      // ------------------------------------------------

      // --- Task Assignment Logic ---
      try {
        // 1. Find potential assignees (GuestCare role with valid CRM ID)
        const guestCareUsers = await User.find({
          role: 'GuestCare',
          crmId: { $exists: true, $ne: '' },
          isActive: true
        });

        if (guestCareUsers.length > 0) {
          // 2. Pick one randomly
          const assignee = guestCareUsers[Math.floor(Math.random() * guestCareUsers.length)];
          const assigneeCrmId = assignee.crmId;

          if (assigneeCrmId) {
            // 3. User info for task description
            const buyer = await User.findById(userId);

            // 4. Create Task
            // assigned_by_id: We need a valid ID. For now, we can reuse the assignee's ID (assign to self) 
            // or use a system 'admin' ID if configured in env. 
            // Let's assume the assignee assigns it to themselves or use a fallback.
            const adminAssignerId = process.env.CRM_ADMIN_ASSIGNER_ID || assigneeCrmId;

            assignCRMTask({
              title: `New Plan Purchase: verified - ${buyer?.name}`,
              description: `User ${buyer?.name} (${buyer?.phone}) has purchased the plan "${plan.planName}". Please initiate the welcome call.`,
              assignedById: adminAssignerId,
              assignedToId: assigneeCrmId,
              priority: 'High',
              targetDate: new Date().toISOString().split('T')[0]
            }).catch(err => console.error('[PlanController] Background task assignment failed:', err));
          }
        } else {
          console.log('[PlanController] No GuestCare users with CRM ID found. Skipping task assignment.');
        }
      } catch (taskError) {
        console.error('[PlanController] Error in task assignment block:', taskError);
      }
      // -----------------------------

    }

    // 5. Update associated Booking and OrderItem
    // Plan purchases via purchasePlan create a booking with bookingId = planTx.orderId
    const booking = await Booking.findOne({ bookingId: planTx.orderId });
    if (booking) {
      booking.paymentStatus = 'paid';
      booking.paymentId = paymentId;
      booking.status = 'confirmed';
      await booking.save();

      await OrderItem.updateMany(
        { bookingId: booking._id },
        { status: 'confirmed' }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Payment verified and plan activated successfully',
      data: planTx
    });

  } catch (error: any) {
    console.error('[verifyPlanPaymentStatus] Error:', error);
    return next(new AppError(error.message || 'Error verifying payment status', 500));
  }
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

// @desc    Toggle plan status
// @route   PATCH /api/admin/plans/:id/toggle-status
// @access  Private/Admin
export const togglePlanStatus = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const plan = await Plan.findById(id);

  if (!plan) {
    return next(new AppError('Plan not found', 404));
  }

  // Toggle status
  plan.planStatus = plan.planStatus === 'active' ? 'inactive' : 'active';
  await plan.save();

  res.status(200).json({
    success: true,
    data: {
      plan: {
        ...plan.toObject(),
        id: plan._id.toString()
      }
    },
    message: `Plan ${plan.planStatus === 'active' ? 'activated' : 'deactivated'} successfully`
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


// @desc    Get current user's plan details with credits and savings
// @route   GET /api/auth/my-plan
// @access  Private
export const getMyPlanDetails = asyncHandler(async (req: AuthRequest, res: Response, next: any) => {
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('Not authenticated', 401));
  }

  const userIdObj = new mongoose.Types.ObjectId(userId);

  // Get user's active plan
  const userPlan = await UserPlan.findOne({ userId: userIdObj });

  if (!userPlan || !userPlan.activePlanId) {
    return res.status(200).json({
      success: true,
      data: {
        hasPlan: false,
        message: 'No active plan found'
      }
    });
  }

  // Get the plan details
  const plan = await Plan.findById(userPlan.activePlanId);
  if (!plan) {
    return res.status(200).json({
      success: true,
      data: {
        hasPlan: false,
        message: 'Plan not found'
      }
    });
  }

  // Get user credits
  const userCredits = await UserCredits.findOne({ userId: userIdObj });
  const remainingCredits = userCredits?.credits || 0;

  // Get family member IDs for this user (to include their bookings)
  const familyIds = await getFamilyGroupIds(userIdObj);

  // Calculate credits used from completed bookings
  const creditUsageAgg = await Booking.aggregate([
    {
      $match: {
        userId: { $in: familyIds },
        creditsUsed: { $gt: 0 },
        status: { $in: ['completed', 'in_progress', 'reached', 'en_route', 'confirmed', 'assigned'] }
      }
    },
    {
      $group: {
        _id: null,
        totalCreditsUsed: { $sum: '$creditsUsed' },
        bookingsCount: { $sum: 1 },
        totalAmountSaved: { $sum: { $multiply: ['$creditsUsed', 1] } } // Each credit saves ₹1 worth
      }
    }
  ]);

  const creditStats = creditUsageAgg[0] || { totalCreditsUsed: 0, bookingsCount: 0, totalAmountSaved: 0 };

  // Calculate estimated savings (credits used * estimated value per credit)
  // We'll estimate each credit saves roughly the average service price
  // For simplicity, we'll use the plan's totalCredits vs finalPrice ratio
  const creditValue = plan.totalCredits > 0 ? plan.finalPrice / plan.totalCredits : 0;
  const estimatedSavings = creditStats.totalCreditsUsed * creditValue;

  // Get services included in plan
  const includedServices = plan.services?.map(s => ({
    name: s.subServiceName,
    limit: s.totalCountLimit
  })) || [];

  res.status(200).json({
    success: true,
    data: {
      hasPlan: true,
      plan: {
        id: plan._id.toString(),
        name: plan.planName,
        title: plan.planTitle,
        subtitle: plan.planSubTitle,
        status: plan.planStatus,
        allowSOS: plan.allowSOS,
        totalCredits: plan.totalCredits,
        totalMembers: plan.totalMembers,
        originalPrice: plan.originalPrice,
        finalPrice: plan.finalPrice,
        expiresAt: userPlan.expiresAt,
        purchaseDate: userPlan.updatedAt,
        includedServices
      },
      credits: {
        total: plan.totalCredits,
        used: creditStats.totalCreditsUsed,
        remaining: remainingCredits
      },
      savings: {
        bookingsWithCredits: creditStats.bookingsCount,
        totalCreditsUsed: creditStats.totalCreditsUsed,
        estimatedSavings: Math.round(estimatedSavings),
        valuePerCredit: Math.round(creditValue)
      }
    }
  });
});
