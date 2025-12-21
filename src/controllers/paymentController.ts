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
import { BookingStatus } from '../constants/bookingStatus';

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

// @desc    Create Razorpay order and Pending Booking/Transaction
// @route   POST /api/payments/create-order
// @access  Private
export const createOrder = asyncHandler(async (req: AuthRequest, res: Response, next: any) => {
  const userId = req.user?.id;
  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  // Check Razorpay credentials upfront
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_API_SECRET;

  if (!keyId || !keySecret) {
    return next(new AppError('Payment gateway not configured. Please contact support.', 500));
  }

  const { amount, currency = 'INR', bookingData, planData } = req.body;

  // Validation
  if (!amount || amount <= 0) {
    return next(new AppError('Valid amount is required', 400));
  }

  // Validate that either bookingData or planData is provided, but not both
  if (!bookingData && !planData) {
    return next(new AppError('Either bookingData or planData is required', 400));
  }

  if (bookingData && planData) {
    return next(new AppError('Cannot process both booking and plan purchase in one order', 400));
  }

  try {
    const razorpayInstance = getRazorpayInstance();
    const userIdObj = new mongoose.Types.ObjectId(userId);

    // ==========================================
    // Handle PLAN Purchase
    // ==========================================
    if (planData) {
      if (!planData.planId) {
        return next(new AppError('Plan ID is required', 400));
      }

      const plan = await Plan.findById(planData.planId);
      if (!plan) {
        return next(new AppError('Plan not found', 404));
      }

      // Calculate expected amount
      const checkoutFields = await getActiveCheckoutFields();
      const calculationResult = await calculateCheckoutTotal(plan.finalPrice, checkoutFields);
      const expectedAmountInPaise = Math.round(calculationResult.total * 100);

      // Verify amount
      const tolerance = 500; // 5 Rs
      if (Math.abs(amount - expectedAmountInPaise) > tolerance) {
        return next(new AppError(`Amount mismatch. Expected ₹${calculationResult.total.toFixed(2)}, got ₹${amount / 100}`, 400));
      }

      // Create Razorpay Order
      const receipt = `PTX_${Date.now().toString(36)}_${userId.toString().slice(-4)}`;
      const options = {
        amount: Math.round(amount),
        currency: currency.toUpperCase(),
        receipt: receipt.substring(0, 40),
        notes: {
          userId,
          type: 'plan',
          planData: JSON.stringify({ planId: planData.planId })
        },
      };

      const order = await razorpayInstance.orders.create(options);

      // Create PENDING PlanTransaction
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
      const count = await PlanTransaction.countDocuments({
        transactionId: { $regex: new RegExp(`^PTX-${dateStr}-`) }
      });
      const transactionId = `PTX-${dateStr}-${String(count + 1).padStart(3, '0')}`;

      // Prepare payment breakdown
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

      await PlanTransaction.create({
        userId: userIdObj,
        planId: plan._id,
        orderId: order.id,
        transactionId,
        amount: calculationResult.total, // Store in Rupees
        credits: plan.totalCredits,
        planSnapshot: {
          name: plan.planName,
          originalPrice: plan.originalPrice,
          finalPrice: plan.finalPrice
        },
        paymentBreakdown: paymentBreakdown.length > 0 ? paymentBreakdown : undefined,
        status: 'pending' // Pending payment
      });

      res.status(200).json({
        success: true,
        data: {
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          keyId: process.env.RAZORPAY_KEY_ID,
        },
      });
      return;
    }

    // ==========================================
    // Handle BOOKING
    // ==========================================
    if (bookingData) {
      if (!bookingData.addressId || !bookingData.items || !Array.isArray(bookingData.items) || bookingData.items.length === 0) {
        return next(new AppError('Valid booking data is required', 400));
      }

      if (!bookingData.bookingType || !['ASAP', 'SCHEDULED'].includes(bookingData.bookingType)) {
        return next(new AppError('Valid booking type is required', 400));
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

      const userCreditsRecord = await UserCredits.findOne({ userId: userIdObj });
      let availableCredits = userCreditsRecord?.credits || 0;
      const userPlanRecord = await UserPlan.findOne({ userId: userIdObj });
      const hasActivePlan = !!userPlanRecord?.activePlanId;

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

        // Check for credit coverage
        let itemCredits = 0;
        let itemPriceForTotal = itemTotal;

        if (hasActivePlan && variant.includedInSubscription && variant.creditValue > 0) {
          const requiredCredits = variant.creditValue * quantity;
          if (availableCredits >= requiredCredits) {
            itemCredits = requiredCredits;
            itemPriceForTotal = 0;
            availableCredits -= requiredCredits;
          }
        }

        totalAmount += itemPriceForTotal;
        totalOriginalAmount += itemOriginalTotal;
        creditsUsed += itemCredits;

        orderItems.push({
          serviceId: service._id,
          serviceVariantId: variant._id,
          serviceName: service.name,
          variantName: variant.name,
          quantity,
          originalPrice: variant.originalPrice,
          finalPrice: itemPriceForTotal > 0 ? variant.finalPrice : 0,
          creditValue: variant.creditValue,
          estimatedTimeMinutes: variant.estimatedTimeMinutes,
          customerVisitRequired: variant.customerVisitRequired !== undefined ? variant.customerVisitRequired : false,
          paidWithCredits: itemCredits > 0 && itemPriceForTotal === 0,
        });
      }

      // Calculate expected amount
      const checkoutFields = await getActiveCheckoutFields();
      const calculationResult = await calculateCheckoutTotal(totalAmount, checkoutFields);
      const expectedAmountInPaise = Math.round(calculationResult.total * 100);

      // Verify amount
      const tolerance = 500;
      if (Math.abs(amount - expectedAmountInPaise) > tolerance) {
        return next(new AppError(`Amount mismatch. Expected ₹${calculationResult.total.toFixed(2)}, got ₹${amount / 100}`, 400));
      }

      // Create Razorpay Order
      const receipt = `BK_${Date.now().toString(36)}_${userId.toString().slice(-4)}`;
      const options = {
        amount: Math.round(amount),
        currency: currency.toUpperCase(),
        receipt: receipt.substring(0, 40),
        notes: {
          userId,
          type: 'booking',
          // minimal info in notes, detailed info in DB
          bookingRef: `user_${userId}`
        },
      };

      const order = await razorpayInstance.orders.create(options);

      // Prepare payment breakdown
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

      // Generate booking ID manually to use for Order Items assignment
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
      const count = await Booking.countDocuments({
        bookingId: { $regex: new RegExp(`^BOOK-${dateStr}-`) }
      });
      const bookingId = `BOOK-${dateStr}-${String(count + 1).padStart(3, '0')}`;

      // Create PENDING Booking
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
        scheduledDate: bookingData.bookingType === 'SCHEDULED'
          ? new Date(bookingData.scheduledDate)
          : (() => {
            const d = new Date();
            d.setMinutes(0, 0, 0);
            d.setHours(d.getHours() + 1);
            return d;
          })(),
        scheduledTime: bookingData.bookingType === 'SCHEDULED'
          ? bookingData.scheduledTime
          : (() => {
            const d = new Date();
            d.setMinutes(0, 0, 0);
            d.setHours(d.getHours() + 1);
            return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          })(),
        totalAmount: calculationResult.total,
        itemTotal: totalAmount,
        totalOriginalAmount,
        creditsUsed,
        paymentBreakdown: paymentBreakdown.length > 0 ? paymentBreakdown : undefined,
        status: BookingStatus.PENDING,
        paymentStatus: 'pending',
        orderId: order.id,
        notes: bookingData.notes || undefined,
      });

      try {
        // Create Order Items linked to this booking
        await OrderItem.insertMany(
          orderItems.map((item) => ({
            bookingId: booking._id,
            ...item,
            status: BookingStatus.PENDING
          }))
        );
      } catch (itemError) {
        // If creating items fails, we must delete the orphan booking to prevent "invisible" bookings
        await Booking.findByIdAndDelete(booking._id);
        throw itemError;
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
    }

  } catch (error: any) {
    console.error('[PaymentController] Error creating order:', error);
    // Provide nice error message
    let errorMessage = 'Failed to create payment order';
    if (error.error?.description) errorMessage = error.error.description;
    else if (error.message) errorMessage = error.message;
    return next(new AppError(errorMessage, 500));
  }
});

// @desc    Verify payment and confirm booking/plan purchase
// @route   POST /api/payments/verify
// @access  Private
export const verifyPayment = asyncHandler(async (req: AuthRequest, res: Response, next: any) => {
  const userId = req.user?.id;
  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return next(new AppError('Payment verification data is required', 400));
  }

  try {
    const userIdObj = new mongoose.Types.ObjectId(userId);

    // Verify signature
    const text = `${razorpay_order_id}|${razorpay_payment_id}`;
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_API_SECRET || '')
      .update(text)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return next(new AppError('Invalid payment signature', 400));
    }

    // Try to find a pending PlanTransaction with this orderId
    const planTx = await PlanTransaction.findOne({ orderId: razorpay_order_id });

    // ==========================================
    // Handle PLAN Verification
    // ==========================================
    if (planTx) {
      if (planTx.userId.toString() !== userId) {
        return next(new AppError('Transaction does not belong to this user', 403));
      }

      if (planTx.status === 'completed') {
        // Already completed, just return success
        res.status(200).json({ success: true, data: { plan: { /* minimal data needed */ } } });
        return;
      }

      // Update Transaction
      planTx.status = 'completed';
      planTx.paymentId = razorpay_payment_id;
      // Fetch and save details asynchronously if needed, or skip for speed
      await planTx.save();

      // Update User Plan & Credits
      const plan = await Plan.findById(planTx.planId);
      if (plan) {
        // Update UserPlan
        const expiryDate = new Date();
        const validityDays = plan.validity || 365;
        expiryDate.setDate(expiryDate.getDate() + validityDays);

        let userPlan = await UserPlan.findOne({ userId: userIdObj });
        if (!userPlan) {
          userPlan = await UserPlan.create({
            userId: userIdObj,
            activePlanId: plan._id.toString(),
            expiresAt: expiryDate
          });
        } else {
          userPlan.activePlanId = plan._id.toString();
          userPlan.expiresAt = expiryDate;
          await userPlan.save();
        }

        // Add Credits
        let userCredits = await UserCredits.findOne({ userId: userIdObj });
        if (!userCredits) {
          userCredits = await UserCredits.create({ userId: userIdObj, credits: plan.totalCredits });
        } else {
          userCredits.credits += plan.totalCredits;
          await userCredits.save();
        }
      }

      // Return success
      const user = await User.findById(userIdObj).select('-password');
      res.status(200).json({
        success: true,
        data: {
          plan: {
            id: plan?._id.toString(),
            planName: plan?.planName,
            finalPrice: plan?.finalPrice,
          },
          user: user?.toObject(),
        },
      });
      return;
    }

    // ==========================================
    // Handle BOOKING Verification
    // ==========================================
    const booking = await Booking.findOne({ orderId: razorpay_order_id });

    if (booking) {
      if (booking.userId.toString() !== userId) {
        return next(new AppError('Booking does not belong to this user', 403));
      }

      if (booking.paymentStatus === 'paid') {
        res.status(200).json({ success: true, data: { booking: { id: booking._id } } });
        return;
      }

      // Update Booking
      booking.paymentStatus = 'paid';
      booking.paymentId = razorpay_payment_id;
      booking.status = 'confirmed'; // Confirmed after payment
      await booking.save();

      // 1. Deduct Credits
      if (booking.creditsUsed > 0) {
        const userCredits = await UserCredits.findOne({ userId: userIdObj });
        if (userCredits) {
          userCredits.credits = Math.max(0, userCredits.credits - booking.creditsUsed);
          await userCredits.save();
          console.log(`[PaymentController] Deducted ${booking.creditsUsed} credits from user ${userIdObj}`);
        }
      }

      // 2. Fetch Order Items for this booking
      const orderItems = await OrderItem.find({ bookingId: booking._id });

      // 3. Auto-Assign
      try {
        await autoAssignServicePartner(booking, orderItems);
      } catch (err) {
        console.error('[PaymentController] Auto-assign failed:', err);
      }

      // 4. Construct response
      const address = booking.address;
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
        itemTotal: booking.itemTotal,
        paymentBreakdown: booking.paymentBreakdown || [],
        status: booking.status,
        date: booking.scheduledDate?.toISOString() || new Date().toISOString(),
        time: booking.scheduledTime || '',
        address: {
          id: booking.addressId,
          label: address.label,
          fullAddress: address.fullAddress,
          area: address.area,
          coordinates: address.coordinates,
          isDefault: false,
        },
        type: booking.bookingType === 'ASAP' ? 'ASAP' : 'SCHEDULED',
      };

      res.status(200).json({
        success: true,
        data: {
          booking: transformedBooking,
        },
      });
      return;
    }

    // If neither planTx nor booking found
    return next(new AppError('Order not found', 404));

  } catch (error: any) {
    console.error('[PaymentController] Error verifying payment:', error);
    return next(new AppError(error.message || 'Payment verification failed', 500));
  }
});

