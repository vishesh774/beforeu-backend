import { Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
// @ts-ignore - Razorpay doesn't have proper TypeScript definitions
const Razorpay = require('razorpay');
import crypto from 'crypto';
import mongoose from 'mongoose';
import Booking from '../models/Booking';
import OrderItem from '../models/OrderItem';
import Address from '../models/Address';
import Service from '../models/Service';
import ServiceVariant from '../models/ServiceVariant';
import Plan from '../models/Plan';
import PlanTransaction from '../models/PlanTransaction';
import UserPlan from '../models/UserPlan';
import UserCredits from '../models/UserCredits';
import User from '../models/User';
import { calculateCheckoutTotal, getActiveCheckoutFields } from '../utils/checkoutUtils';
import { autoAssignServicePartner } from '../services/bookingService';

// Initialize Razorpay - Lazy initialization to ensure env vars are loaded
let razorpay: any = null;

const getRazorpayInstance = (): any => {
  if (!razorpay) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_API_SECRET;

    if (!keyId || !keySecret) {
      throw new Error('Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_API_SECRET environment variables.');
    }

    razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }
  return razorpay;
};

// @desc    Test Razorpay configuration (for debugging)
// @route   GET /api/payments/test-config
// @access  Private
export const testRazorpayConfig = asyncHandler(async (_req: AuthRequest, res: Response, next: any) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_API_SECRET;

  try {
    res.status(200).json({
      success: true,
      message: 'Razorpay configured correctly',
      hasKeyId: !!keyId,
      hasSecret: !!keySecret,
      keyIdPrefix: keyId?.substring(0, 10) || 'none',
    });
  } catch (error: any) {
    return next(new AppError(error.message || 'Razorpay not configured', 500));
  }
});

// @desc    Create Razorpay order
// @route   POST /api/payments/create-order
// @access  Private
export const createOrder = asyncHandler(async (req: AuthRequest, res: Response, next: any) => {
  const userId = req.user?.id;
  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  // Log request for debugging
  console.log('[PaymentController] createOrder called:', {
    userId,
    body: {
      amount: req.body.amount,
      currency: req.body.currency,
      hasBookingData: !!req.body.bookingData,
      hasPlanData: !!req.body.planData,
    },
  });

  // Check Razorpay credentials upfront
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_API_SECRET;

  if (!keyId || !keySecret) {
    console.error('[PaymentController] Razorpay credentials missing:', {
      hasKeyId: !!keyId,
      hasSecret: !!keySecret,
      keyIdLength: keyId?.length || 0,
      keySecretLength: keySecret?.length || 0,
      envKeys: Object.keys(process.env).filter(k => k.includes('RAZORPAY')),
    });
    return next(new AppError('Payment gateway not configured. Please contact support.', 500));
  }

  console.log('[PaymentController] Razorpay credentials found:', {
    hasKeyId: !!keyId,
    hasSecret: !!keySecret,
    keyIdPrefix: keyId?.substring(0, 10) || 'none',
  });

  const { amount, currency = 'INR', bookingData, planData } = req.body;

  // Validation
  if (!amount || amount <= 0) {
    return next(new AppError('Valid amount is required', 400));
  }

  if (amount < 100) {
    return next(new AppError('Minimum amount is ₹1 (100 paise)', 400));
  }

  // Validate that either bookingData or planData is provided, but not both
  if (!bookingData && !planData) {
    return next(new AppError('Either bookingData or planData is required', 400));
  }

  if (bookingData && planData) {
    return next(new AppError('Cannot process both booking and plan purchase in one order', 400));
  }

  // Validate booking data if provided
  if (bookingData) {
    if (!bookingData.addressId || !bookingData.items || !Array.isArray(bookingData.items) || bookingData.items.length === 0) {
      return next(new AppError('Valid booking data is required', 400));
    }

    if (!bookingData.bookingType || !['ASAP', 'SCHEDULED'].includes(bookingData.bookingType)) {
      return next(new AppError('Valid booking type is required', 400));
    }

    if (bookingData.bookingType === 'SCHEDULED' && (!bookingData.scheduledDate || !bookingData.scheduledTime)) {
      return next(new AppError('Scheduled date and time are required for scheduled bookings', 400));
    }
  }

  // Validate plan data if provided
  if (planData) {
    if (!planData.planId) {
      return next(new AppError('Plan ID is required', 400));
    }

    const plan = await Plan.findById(planData.planId);
    if (!plan) {
      return next(new AppError('Plan not found', 404));
    }

    // Calculate expected amount using checkout config fields
    const checkoutFields = await getActiveCheckoutFields();
    const calculationResult = await calculateCheckoutTotal(plan.finalPrice, checkoutFields);
    const expectedAmountInPaise = Math.round(calculationResult.total * 100);

    // Verify amount matches calculated price (with tolerance of 5 Rs = 500 paise)
    const tolerance = 500; // 5 Rs tolerance
    const amountDifference = Math.abs(amount - expectedAmountInPaise);
    if (amountDifference > tolerance) {
      return next(new AppError(`Amount mismatch. Expected ₹${calculationResult.total.toFixed(2)}, got ₹${amount / 100}`, 400));
    }
  }

  try {
    // Get Razorpay instance (will throw if credentials not configured)
    let razorpayInstance;
    try {
      razorpayInstance = getRazorpayInstance();
    } catch (razorpayError: any) {
      console.error('[PaymentController] Razorpay initialization error:', razorpayError);
      return next(new AppError('Payment gateway not configured. Please contact support.', 500));
    }

    // Create Razorpay order
    // Receipt must be max 40 characters - use short format
    const timestamp = Date.now().toString(36); // Base36 for shorter string
    const userIdShort = userId.toString().slice(-6); // Last 6 chars of userId
    const receipt = `${timestamp}_${userIdShort}`.substring(0, 40); // Ensure max 40 chars

    const options = {
      amount: Math.round(amount), // Amount in paise
      currency: currency.toUpperCase(),
      receipt: receipt,
      notes: {
        userId,
        type: planData ? 'plan' : 'booking',
        ...(bookingData && { bookingData: JSON.stringify(bookingData) }),
        ...(planData && { planData: JSON.stringify(planData) }),
      },
    };

    console.log('[PaymentController] Creating Razorpay order with options:', {
      amount: options.amount,
      currency: options.currency,
      receipt: options.receipt,
      type: options.notes.type,
    });

    let order;
    try {
      order = await razorpayInstance.orders.create(options);
      console.log('[PaymentController] Razorpay order created:', order.id);
    } catch (razorpayError: any) {
      // Razorpay errors have a specific structure
      console.error('[PaymentController] Razorpay API error:', razorpayError);
      console.error('[PaymentController] Razorpay error details:', {
        message: razorpayError.message,
        description: razorpayError.description,
        code: razorpayError.code,
        field: razorpayError.field,
        source: razorpayError.source,
        step: razorpayError.step,
        reason: razorpayError.reason,
        statusCode: razorpayError.statusCode,
        error: razorpayError.error,
        status: razorpayError.status,
      });

      // Extract error message from Razorpay error structure
      let errorMessage = 'Failed to create payment order';
      if (razorpayError.error?.description) {
        errorMessage = razorpayError.error.description;
      } else if (razorpayError.description) {
        errorMessage = razorpayError.description;
      } else if (razorpayError.message) {
        errorMessage = razorpayError.message;
      }

      return next(new AppError(errorMessage, 500));
    }

    res.status(200).json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
      },
    });

    // Create Pending Plan Transaction if this is a plan purchase
    if (planData && planData.planId) {
      try {
        const plan = await Plan.findById(planData.planId);
        if (plan) {
          await PlanTransaction.create({
            userId,
            planId: plan._id,
            orderId: order.id,
            amount: amount, // Amount in paise, consistent with schema use
            credits: plan.totalCredits,
            planSnapshot: {
              name: plan.planName,
              originalPrice: plan.originalPrice,
              finalPrice: plan.finalPrice
            },
            status: 'pending'
          });
          console.log('[PaymentController] Created pending PlanTransaction for order:', order.id);
        }
      } catch (txError) {
        console.error('[PaymentController] Error creating pending PlanTransaction:', txError);
        // Don't fail the response, just log the error
      }
    }
  } catch (error: any) {
    console.error('[PaymentController] Unexpected error creating Razorpay order:', error);
    console.error('[PaymentController] Error stack:', error.stack);
    console.error('[PaymentController] Error details:', {
      message: error.message,
      code: error.code,
      description: error.description,
      field: error.field,
      source: error.source,
      step: error.step,
      reason: error.reason,
      metadata: error.metadata,
      statusCode: error.statusCode,
      error: error.error,
    });

    // Provide more specific error messages
    let errorMessage = 'Failed to create payment order';
    if (error.message) {
      errorMessage = error.message;
    } else if (error.description) {
      errorMessage = error.description;
    } else if (error.error?.description) {
      errorMessage = error.error.description;
    }

    return next(new AppError(errorMessage, 500));
  }
});

// @desc    Verify payment and create booking/plan purchase
// @route   POST /api/payments/verify
// @access  Private
export const verifyPayment = asyncHandler(async (req: AuthRequest, res: Response, next: any) => {
  const userId = req.user?.id;
  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  // Validation
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return next(new AppError('Payment verification data is required', 400));
  }

  try {
    // Fetch order from Razorpay to get notes
    const razorpayInstance = getRazorpayInstance();
    const order = await razorpayInstance.orders.fetch(razorpay_order_id);

    if (!order || order.status !== 'paid') {
      return next(new AppError('Order not found or not paid', 400));
    }

    // Verify signature
    const text = `${razorpay_order_id}|${razorpay_payment_id}`;
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_API_SECRET || '')
      .update(text)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return next(new AppError('Invalid payment signature', 400));
    }

    // Fetch payment details from Razorpay
    let paymentDetails: any = null;
    try {
      const payment = await razorpayInstance.payments.fetch(razorpay_payment_id);
      paymentDetails = {
        method: payment.method || null,
        bank: payment.bank || null,
        wallet: payment.wallet || null,
        vpa: payment.vpa || null,
        card: payment.card ? {
          id: payment.card.id || null,
          last4: payment.card.last4 || null,
          network: payment.card.network || null,
          type: payment.card.type || null,
          issuer: payment.card.issuer || null,
        } : null,
        contact: payment.contact || null,
        email: payment.email || null,
        fee: payment.fee ? payment.fee / 100 : null, // Convert from paise to rupees
        tax: payment.tax ? payment.tax / 100 : null, // Convert from paise to rupees
        international: payment.international || false,
        captured: payment.captured || false,
        description: payment.description || null,
        refundStatus: payment.refund_status || null,
        amountRefunded: payment.amount_refunded ? payment.amount_refunded / 100 : null, // Convert from paise to rupees
        createdAt: payment.created_at ? new Date(payment.created_at * 1000) : null, // Convert Unix timestamp to Date
      };
    } catch (paymentError: any) {
      console.error('[PaymentController] Error fetching payment details:', paymentError);
      // Continue without payment details if fetch fails
    }

    // Extract metadata from order notes
    const notes = order.notes || {};
    const orderUserId = notes.userId;
    const orderType = notes.type;

    // Verify user matches
    if (orderUserId !== userId) {
      return next(new AppError('Order does not belong to this user', 403));
    }

    const userIdObj = new mongoose.Types.ObjectId(userId);

    // Process based on order type
    if (orderType === 'plan') {
      // Handle plan purchase
      const planData = notes.planData ? JSON.parse(String(notes.planData)) : null;
      if (!planData || !planData.planId) {
        return next(new AppError('Plan data not found in order', 400));
      }

      const plan = await Plan.findById(planData.planId);
      if (!plan) {
        return next(new AppError('Plan not found', 404));
      }

      // Calculate expected amount using checkout config fields
      const checkoutFields = await getActiveCheckoutFields();
      const calculationResult = await calculateCheckoutTotal(plan.finalPrice, checkoutFields);
      const expectedAmountInPaise = Math.round(calculationResult.total * 100);

      // Verify amount matches calculated price (with tolerance of 5 Rs = 500 paise)
      const tolerance = 500; // 5 Rs tolerance
      const amountDifference = Math.abs(order.amount - expectedAmountInPaise);
      if (amountDifference > tolerance) {
        return next(new AppError(`Amount mismatch. Expected ₹${calculationResult.total.toFixed(2)}, got ₹${order.amount / 100}`, 400));
      }

      // Get plan ID as string
      const planIdString = plan._id.toString();

      // Update or create UserPlan record
      let userPlan = await UserPlan.findOne({ userId: userIdObj });
      if (!userPlan) {
        userPlan = await UserPlan.create({
          userId: userIdObj,
          activePlanId: planIdString,
        });
      } else {
        userPlan.activePlanId = planIdString;
        await userPlan.save();
      }

      // Add credits to user
      let userCredits = await UserCredits.findOne({ userId: userIdObj });
      if (!userCredits) {
        userCredits = await UserCredits.create({
          userId: userIdObj,
          credits: plan.totalCredits,
        });
      } else {
        userCredits.credits += plan.totalCredits;
        await userCredits.save();
      }

      // Prepare payment breakdown for storage (similar to booking)
      const paymentBreakdown = calculationResult.breakdown.map(item => {
        const field = checkoutFields.find(f => f.fieldName === item.fieldName);
        return {
          fieldName: item.fieldName,
          fieldDisplayName: item.fieldDisplayName,
          chargeType: field?.chargeType || 'fixed',
          value: field?.value || 0,
          amount: item.amount
        };
      });

      // Create or Update PlanTransaction Record
      const existingTx = await PlanTransaction.findOne({ orderId: razorpay_order_id });

      if (existingTx) {
        existingTx.status = 'completed';
        existingTx.paymentId = razorpay_payment_id;
        existingTx.paymentDetails = paymentDetails || undefined;
        existingTx.paymentBreakdown = paymentBreakdown.length > 0 ? paymentBreakdown : undefined;
        await existingTx.save();
      } else {
        // Fallback: Create if not exists (e.g. for legacy testing or if createOrder failed to create it)
        await PlanTransaction.create({
          userId: userIdObj,
          planId: plan._id,
          orderId: razorpay_order_id,
          amount: calculationResult.total,
          credits: plan.totalCredits,
          planSnapshot: {
            name: plan.planName,
            originalPrice: plan.originalPrice,
            finalPrice: plan.finalPrice
          },
          status: 'completed',
          paymentId: razorpay_payment_id,
          paymentDetails: paymentDetails || undefined,
          paymentBreakdown: paymentBreakdown.length > 0 ? paymentBreakdown : undefined
        });
      }

      // Fetch updated user
      const user = await User.findById(userIdObj).select('-password');

      res.status(200).json({
        success: true,
        data: {
          plan: {
            id: plan._id.toString(),
            planName: plan.planName,
            planTitle: plan.planTitle,
            planSubTitle: plan.planSubTitle,
            totalCredits: plan.totalCredits,
            finalPrice: plan.finalPrice,
          },
          user: user?.toObject(),
        },
      });
    } else if (orderType === 'booking') {
      // Handle booking creation
      const bookingData = notes.bookingData ? JSON.parse(String(notes.bookingData)) : null;
      if (!bookingData) {
        return next(new AppError('Booking data not found in order', 400));
      }

      // Get user's address
      const address = await Address.findOne({ userId: userIdObj, id: bookingData.addressId });
      if (!address) {
        return next(new AppError('Address not found', 404));
      }

      // Calculate totals and validate items
      let totalAmount = 0;
      let totalOriginalAmount = 0;
      let creditsUsed = 0;

      const orderItems = [];
      for (const item of bookingData.items) {
        const variant = await ServiceVariant.findOne({ id: item.variantId }).populate('serviceId');
        if (!variant) {
          return next(new AppError(`Service variant ${item.variantId} not found`, 404));
        }

        const service = await Service.findById(variant.serviceId);
        if (!service || !service.isActive) {
          return next(new AppError(`Service ${item.serviceId} is not available`, 400));
        }

        if (!variant.isActive) {
          return next(new AppError(`Service variant ${item.variantId} is not available`, 400));
        }

        const quantity = parseInt(item.quantity) || 1;
        const itemTotal = variant.finalPrice * quantity;
        const itemOriginalTotal = variant.originalPrice * quantity;
        const itemCredits = variant.includedInSubscription ? variant.creditValue * quantity : 0;

        totalAmount += itemTotal;
        totalOriginalAmount += itemOriginalTotal;
        creditsUsed += itemCredits;

        orderItems.push({
          serviceId: service._id,
          serviceVariantId: variant._id,
          serviceName: service.name,
          variantName: variant.name,
          quantity,
          originalPrice: variant.originalPrice,
          finalPrice: variant.finalPrice,
          creditValue: variant.creditValue,
          estimatedTimeMinutes: variant.estimatedTimeMinutes,
          customerVisitRequired: variant.customerVisitRequired !== undefined ? variant.customerVisitRequired : false,
        });
      }

      // Calculate expected amount using checkout config fields
      const checkoutFields = await getActiveCheckoutFields();
      const calculationResult = await calculateCheckoutTotal(totalAmount, checkoutFields);
      const expectedAmountInPaise = Math.round(calculationResult.total * 100);

      // Verify amount matches calculated total (with tolerance of 5 Rs = 500 paise)
      const tolerance = 500; // 5 Rs tolerance
      const amountDifference = Math.abs(order.amount - expectedAmountInPaise);
      if (amountDifference > tolerance) {
        return next(new AppError(`Amount mismatch. Expected ₹${calculationResult.total.toFixed(2)}, got ₹${order.amount / 100}`, 400));
      }

      // Prepare payment breakdown for storage
      const paymentBreakdown = calculationResult.breakdown.map(item => {
        const field = checkoutFields.find(f => f.fieldName === item.fieldName);
        return {
          fieldName: item.fieldName,
          fieldDisplayName: item.fieldDisplayName,
          chargeType: field?.chargeType || 'fixed',
          value: field?.value || 0,
          amount: item.amount
        };
      });

      // Generate booking ID
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const count = await Booking.countDocuments({
        $or: [
          {
            createdAt: {
              $gte: startOfDay,
              $lt: endOfDay,
            },
          },
          {
            bookingId: {
              $regex: new RegExp(`^BOOK-${dateStr}-`),
            },
          },
        ],
      });
      const bookingId = `BOOK-${dateStr}-${String(count + 1).padStart(3, '0')}`;

      // Create booking
      const booking = await Booking.create({
        userId: userIdObj,
        bookingId,
        addressId: address.id,
        address: {
          label: address.label,
          fullAddress: address.fullAddress,
          area: address.area,
          coordinates: address.coordinates,
        },
        bookingType: bookingData.bookingType,
        scheduledDate: bookingData.bookingType === 'SCHEDULED' ? new Date(bookingData.scheduledDate) : undefined,
        scheduledTime: bookingData.bookingType === 'SCHEDULED' ? bookingData.scheduledTime : undefined,
        totalAmount: calculationResult.total, // Final amount including all checkout fields
        itemTotal: totalAmount, // Item total before checkout fields
        totalOriginalAmount,
        creditsUsed,
        paymentBreakdown: paymentBreakdown.length > 0 ? paymentBreakdown : undefined,
        status: 'pending',
        paymentStatus: 'paid',
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        paymentDetails: paymentDetails || undefined,
        notes: bookingData.notes || undefined,
      });

      // Create order items
      // Create order items
      const createdOrderItems = await OrderItem.insertMany(
        orderItems.map((item) => ({
          bookingId: booking._id,
          ...item,
        }))
      );

      // Auto-assign service partner
      try {
        await autoAssignServicePartner(booking, createdOrderItems);
      } catch (error) {
        console.error('[PaymentController] Error auto-assigning partner:', error);
      }

      // Deduct credits if used
      if (creditsUsed > 0) {
        const userCredits = await UserCredits.findOne({ userId: userIdObj });
        if (userCredits) {
          userCredits.credits -= creditsUsed;
          if (userCredits.credits < 0) {
            userCredits.credits = 0;
          }
          await userCredits.save();
        }
      }

      // Transform booking for response
      const transformedBooking = {
        id: booking._id.toString(),
        bookingId: booking.bookingId,
        items: orderItems.map((item) => ({
          serviceId: item.serviceId.toString(),
          variantId: item.serviceVariantId.toString(),
          variantName: item.variantName,
          serviceName: item.serviceName,
          price: item.finalPrice,
          originalPrice: item.originalPrice,
          creditCost: item.creditValue,
          quantity: item.quantity,
        })),
        totalAmount: booking.totalAmount,
        itemTotal: booking.itemTotal || totalAmount, // Fallback for old bookings
        paymentBreakdown: booking.paymentBreakdown || [],
        status: booking.status === 'pending' ? 'Upcoming' : booking.status,
        date: booking.scheduledDate?.toISOString() || new Date().toISOString(),
        time: booking.scheduledTime || '',
        address: {
          id: address.id,
          label: address.label,
          fullAddress: address.fullAddress,
          area: address.area,
          coordinates: address.coordinates,
          isDefault: address.isDefault || false,
        },
        type: booking.bookingType === 'ASAP' ? 'ASAP' : 'SCHEDULED',
      };

      res.status(200).json({
        success: true,
        data: {
          booking: transformedBooking,
        },
      });
    } else {
      return next(new AppError('Invalid order type', 400));
    }
  } catch (error: any) {
    console.error('[PaymentController] Error verifying payment:', error);
    return next(new AppError(error.message || 'Payment verification failed', 500));
  }
});

