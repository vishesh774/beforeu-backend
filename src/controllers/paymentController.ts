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
import Coupon from '../models/Coupon';
import { calculateCheckoutTotal, getActiveCheckoutFields } from '../utils/checkoutUtils';
import { autoAssignServicePartner } from '../services/bookingService';
import { BookingStatus } from '../constants/bookingStatus';

// Initialize Razorpay - Lazy initialization to ensure env vars are loaded
let razorpay: any = null;

export const getRazorpayInstance = (): any => {
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
  if (amount === undefined || amount === null || amount < 0) {
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

      // Handle Coupon
      let discountAmount = 0;
      if (planData.couponCode) {
        const userPhone = req.user!.phone;
        const coupon = await Coupon.findOne({
          code: planData.couponCode.toUpperCase(),
          isActive: true,
          appliesTo: 'plan'
        });

        if (coupon) {
          // Validate Restricted
          let isAllowed = true;
          if (coupon.type === 'restricted') {
            const phoneVariants = [userPhone, userPhone.replace(/^\+91/, ''), userPhone.startsWith('+91') ? userPhone : `+91${userPhone}`];
            isAllowed = phoneVariants.some(variant => coupon.allowedPhoneNumbers.includes(variant));
          }

          if (isAllowed && (!coupon.expiryDate || new Date() <= coupon.expiryDate) && (coupon.maxUses === -1 || coupon.usedCount < coupon.maxUses)) {
            discountAmount = (plan.finalPrice * coupon.discountValue) / 100;
          }
        }
      }

      // Calculate expected amount
      const checkoutFields = await getActiveCheckoutFields();
      const calculationResult = await calculateCheckoutTotal(
        plan.finalPrice,
        checkoutFields,
        discountAmount > 0 ? { amount: discountAmount, label: `Coupon (${planData.couponCode!.toUpperCase()})` } : undefined
      );
      const expectedAmountInPaise = Math.round(calculationResult.total * 100);

      // Verify amount
      const tolerance = 500; // 5 Rs
      if (Math.abs(amount - expectedAmountInPaise) > tolerance) {
        return next(new AppError(`Amount mismatch. Expected ₹${calculationResult.total.toFixed(2)}, got ₹${amount / 100}`, 400));
      }

      // If amount is 0, we don't need Razorpay
      let orderId = 'free_' + Date.now().toString(36);
      let orderAmount = 0;

      if (amount > 0) {
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
        orderId = order.id;
        orderAmount = order.amount;
      }

      // Create PlanTransaction ID
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
        orderId: orderId,
        transactionId,
        amount: calculationResult.total, // Store in Rupees
        credits: plan.totalCredits,
        planSnapshot: {
          name: plan.planName,
          originalPrice: plan.originalPrice,
          finalPrice: plan.finalPrice
        },
        couponCode: planData.couponCode ? planData.couponCode.toUpperCase() : undefined,
        discountAmount: discountAmount || 0,
        paymentBreakdown: paymentBreakdown.length > 0 ? paymentBreakdown : undefined,
        status: amount === 0 ? 'completed' : 'pending'
      });

      // If free, activate plan immediately
      if (amount === 0) {
        const expiryDate = new Date();
        const validityDays = plan.validity || 365;
        expiryDate.setDate(expiryDate.getDate() + validityDays);

        let userPlan = await UserPlan.findOne({ userId: userIdObj });
        if (!userPlan) {
          await UserPlan.create({
            userId: userIdObj,
            activePlanId: plan._id.toString(),
            expiresAt: expiryDate
          });
        } else {
          userPlan.activePlanId = plan._id.toString();
          userPlan.expiresAt = expiryDate;
          await userPlan.save();
        }

        let userCredits = await UserCredits.findOne({ userId: userIdObj });
        if (!userCredits) {
          await UserCredits.create({ userId: userIdObj, credits: plan.totalCredits });
        } else {
          userCredits.credits += plan.totalCredits;
          await userCredits.save();
        }
      }

      res.status(200).json({
        success: true,
        data: {
          orderId: orderId,
          amount: orderAmount,
          currency: currency.toUpperCase(),
          keyId: process.env.RAZORPAY_KEY_ID,
          isFree: amount === 0
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
      const address = await Address.findOne({ id: bookingData.addressId, userId });
      if (!address) {
        return next(new AppError('Address not found', 404));
      }

      // 1. Calculate base item total and validate items
      let totalAmount = 0;
      let totalOriginalAmount = 0;
      let orderItems = [];

      for (const item of bookingData.items) {
        const service = await Service.findOne({
          $or: [
            { id: item.serviceId },
            { name: item.serviceId }
          ]
        });
        const variant = await ServiceVariant.findOne({
          $or: [
            { id: item.variantId },
            { name: item.variantId }
          ]
        });

        if (!service || !variant) {
          return next(new AppError(`Service or variant not found for item ${item.variantId}`, 404));
        }

        const quantity = item.quantity || 1;
        totalAmount += variant.finalPrice * quantity;
        totalOriginalAmount += variant.originalPrice * quantity;

        orderItems.push({
          serviceId: service._id,
          serviceVariantId: variant._id,
          variantName: variant.name,
          serviceName: service.name,
          basePrice: variant.finalPrice,
          originalPrice: variant.originalPrice,
          finalPrice: variant.finalPrice, // Discount will be handled at booking level
          quantity: quantity,
          creditValue: variant.creditValue || 0,
          estimatedTimeMinutes: variant.estimatedTimeMinutes,
          customerVisitRequired: variant.customerVisitRequired || false
        });
      }

      // 2. Handle Credits (Deduct from amount calculation, not current balance yet)
      let creditsUsed = 0;
      if (bookingData.useCredits) {
        const userCredits = await UserCredits.findOne({ userId: userIdObj });
        if (userCredits && userCredits.credits > 0) {
          // Credits apply to item total
          // We assume credits cover full item cost if available
          let remainingAmount = 0;
          let tempUserCredits = userCredits.credits;

          // Re-calculate how many items are covered by credits
          for (let i = 0; i < orderItems.length; i++) {
            const item = orderItems[i];
            const itemCostInCredits = item.creditValue * item.quantity;

            if (tempUserCredits >= itemCostInCredits && itemCostInCredits > 0) {
              tempUserCredits -= itemCostInCredits;
              creditsUsed += itemCostInCredits;
              // This item is covered by credits
              (item as any).paidWithCredits = true;
              (item as any).finalPrice = 0;
            } else {
              remainingAmount += item.basePrice * item.quantity;
              (item as any).paidWithCredits = false;
            }
          }
          totalAmount = remainingAmount;
        }
      }

      // 3. Handle Coupon
      let discountAmount = 0;
      let appliedCouponCode = undefined;

      if (bookingData.couponCode) {
        const userPhone = req.user!.phone;
        const coupon = await Coupon.findOne({
          code: bookingData.couponCode.toUpperCase(),
          isActive: true,
          appliesTo: 'service'
        });

        if (coupon) {
          // Validate Restricted
          let isAllowed = true;
          if (coupon.type === 'restricted') {
            const phoneVariants = [userPhone, userPhone.replace(/^\+91/, ''), userPhone.startsWith('+91') ? userPhone : `+91${userPhone}`];
            isAllowed = phoneVariants.some(variant => coupon.allowedPhoneNumbers.includes(variant));
          }

          // Check relevance if serviceId is specific
          let isRelevant = true;
          if (coupon.serviceId) {
            isRelevant = bookingData.items.some((item: any) => item.serviceId === coupon.serviceId);
          }

          if (isAllowed && isRelevant && (!coupon.expiryDate || new Date() <= coupon.expiryDate) && (coupon.maxUses === -1 || coupon.usedCount < coupon.maxUses)) {
            discountAmount = (totalAmount * coupon.discountValue) / 100;
            appliedCouponCode = coupon.code;
          }
        }
      }

      // Calculate expected amount using checkout utils
      const checkoutFields = await getActiveCheckoutFields();
      const calculationResult = await calculateCheckoutTotal(
        totalAmount,
        checkoutFields,
        discountAmount > 0 ? { amount: discountAmount, label: `Coupon (${bookingData.couponCode!.toUpperCase()})` } : undefined
      );
      const expectedAmountInPaise = Math.round(calculationResult.total * 100);

      // Verify amount
      const tolerance = 500;
      if (Math.abs(amount - expectedAmountInPaise) > tolerance) {
        return next(new AppError(`Amount mismatch. Expected ₹${calculationResult.total.toFixed(2)}, got ₹${amount / 100}`, 400));
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

      // Handle Razorpay Order Creation if amount > 0
      let orderId = 'free_' + Date.now().toString(36);
      let orderAmount = 0;

      if (amount > 0) {
        const receipt = `BK_${Date.now().toString(36)}_${userId.toString().slice(-4)}`;
        const options = {
          amount: Math.round(amount),
          currency: currency.toUpperCase(),
          receipt: receipt.substring(0, 40),
          notes: {
            userId,
            type: 'booking',
          },
        };

        const razorpayOrder = await razorpayInstance.orders.create(options);
        orderId = razorpayOrder.id;
        orderAmount = razorpayOrder.amount;
      }

      // Generate Booking ID
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
      const count = await Booking.countDocuments({
        bookingId: { $regex: new RegExp(`^BOOK-${dateStr}-`) }
      });
      const bookingId = `BOOK-${dateStr}-${String(count + 1).padStart(3, '0')}`;

      // Create Booking
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
        couponCode: appliedCouponCode,
        discountAmount,
        paymentBreakdown: paymentBreakdown.length > 0 ? paymentBreakdown : undefined,
        status: amount === 0 ? 'confirmed' : BookingStatus.PENDING,
        paymentStatus: amount === 0 ? 'paid' : 'pending',
        orderId: orderId,
        notes: bookingData.notes || undefined,
      });

      try {
        // Create Order Items linked to this booking
        const itemsToInsert = orderItems.map((item) => ({
          bookingId: booking._id,
          ...item,
          status: amount === 0 ? 'confirmed' : BookingStatus.PENDING
        }));
        await OrderItem.insertMany(itemsToInsert);

        // If free, handle finalizations immediately
        if (amount === 0) {
          // Deduct Credits if used
          if (booking.creditsUsed > 0) {
            const userCredits = await UserCredits.findOne({ userId: userIdObj });
            if (userCredits) {
              userCredits.credits = Math.max(0, userCredits.credits - booking.creditsUsed);
              await userCredits.save();
            }
          }
          // Auto-assign partner
          try {
            const orderItemsFetched = await OrderItem.find({ bookingId: booking._id });
            await autoAssignServicePartner(booking, orderItemsFetched);
          } catch (err) {
            console.error('[PaymentController] Auto-assign failed for free booking:', err);
          }
        }
      } catch (itemError) {
        // Cleanup if item creation fails
        await Booking.findByIdAndDelete(booking._id);
        throw itemError;
      }

      res.status(200).json({
        success: true,
        data: {
          orderId: orderId,
          amount: orderAmount,
          currency: currency.toUpperCase(),
          keyId: process.env.RAZORPAY_KEY_ID,
          isFree: amount === 0,
          booking: {
            ...booking.toObject(),
            id: booking._id.toString(),
            items: orderItems.map(item => ({
              ...item,
              price: item.finalPrice,
              originalPrice: item.originalPrice,
              creditCost: item.creditValue,
              quantity: item.quantity
            })),
            date: booking.scheduledDate?.toISOString() || new Date().toISOString(),
            time: booking.scheduledTime || '',
            type: booking.bookingType
          }
        },
      });
      return;
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

// @desc    Get Razorpay order/payment details for reconciliation
// @route   GET /api/admin/payments/razorpay-order/:orderId
// @access  Private/Admin
export const getRazorpayOrderDetails = asyncHandler(async (req: any, res: Response, next: any) => {
  const { orderId: id } = req.params; // Can be Order ID (order_...) or Payment ID (pay_...)

  try {
    const razorpay = getRazorpayInstance();
    let order: any = null;
    let payments: any[] = [];
    let capturedPayment: any = null;
    let orderId: string | null = null;

    if (id.startsWith('pay_')) {
      // It's a Payment ID
      try {
        capturedPayment = await razorpay.payments.fetch(id);
        orderId = capturedPayment.order_id;
        if (orderId) {
          try {
            order = await razorpay.orders.fetch(orderId);
            const allPayments = await razorpay.orders.fetchPayments(orderId);
            payments = allPayments.items;
          } catch (e) {
            // Order might not exist if it was a direct payment
            payments = [capturedPayment];
          }
        } else {
          payments = [capturedPayment];
        }
      } catch (err: any) {
        return next(new AppError(`Razorpay Payment not found: ${err.description || err.message}`, 404));
      }
    } else {
      // Assume it's an Order ID
      orderId = id;
      try {
        order = await razorpay.orders.fetch(orderId);
        const allPayments = await razorpay.orders.fetchPayments(orderId);
        payments = allPayments.items;
        capturedPayment = payments.find((p: any) => p.status === 'captured');
      } catch (err: any) {
        return next(new AppError(`Razorpay Order not found: ${err.description || err.message}`, 404));
      }
    }

    // 3. Check if already linked in our system
    // Search by both Order ID and Payment ID to be thorough
    const query: any = { $or: [] };
    if (orderId) query.$or.push({ orderId: orderId });
    if (capturedPayment) query.$or.push({ paymentId: capturedPayment.id });

    const existingPlanTx = query.$or.length > 0 ? await PlanTransaction.findOne(query) : null;
    const existingBooking = query.$or.length > 0 ? await Booking.findOne(query) : null;

    res.status(200).json({
      success: true,
      data: {
        order,
        payments: payments,
        capturedPayment,
        isAlreadyLinked: !!(existingPlanTx || existingBooking),
        linkedTo: existingPlanTx ? 'plan' : (existingBooking ? 'booking' : null)
      }
    });
  } catch (error: any) {
    console.error('[PaymentController] Error fetching Razorpay details:', error);
    return next(new AppError(error.message || 'Failed to fetch Razorpay details', 500));
  }
});

// @desc    Reconcile external payment manually
// @route   POST /api/admin/payments/reconcile
// @access  Private/Admin
export const reconcileExternalPayment = asyncHandler(async (req: any, res: Response, next: any) => {
  const {
    userId,
    orderId: providedId, // Can be Order ID or Payment ID
    targetType, // 'plan' or 'service'
    targetId,   // planId or booking configuration
    allowAmountMismatch = false
  } = req.body;

  if (!userId || !providedId || !targetType || !targetId) {
    return next(new AppError('User ID, ID (Order/Payment), Target Type and Target data are required', 400));
  }

  try {
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const user = await User.findById(userIdObj);
    if (!user) return next(new AppError('User not found', 404));

    const razorpay = getRazorpayInstance();
    let successfulPayment: any = null;
    let finalOrderId: string | null = null;

    // 1. Verify Razorpay Payment
    if (providedId.startsWith('pay_')) {
      successfulPayment = await razorpay.payments.fetch(providedId);
      if (successfulPayment.status !== 'captured') {
        return next(new AppError(`Payment ${providedId} is not captured. Status: ${successfulPayment.status}`, 400));
      }
      finalOrderId = successfulPayment.order_id;
    } else {
      const payments = await razorpay.orders.fetchPayments(providedId);
      successfulPayment = payments.items.find((p: any) => p.status === 'captured');
      finalOrderId = providedId;
    }

    if (!successfulPayment) {
      return next(new AppError('No captured payment found for this ID on Razorpay', 400));
    }

    const payedAmountInRupees = successfulPayment.amount / 100;

    // 2. Prevent duplication (only if not linking to an existing specific system ID)
    const existingId = targetId.existingId;

    if (!existingId) {
      const query: any = { $or: [{ paymentId: successfulPayment.id }] };
      if (finalOrderId) query.$or.push({ orderId: finalOrderId });

      const alreadyReconciledPlanTx = await PlanTransaction.findOne(query);
      const alreadyReconciledBooking = await Booking.findOne(query);
      if (alreadyReconciledPlanTx || alreadyReconciledBooking) {
        return next(new AppError('This payment/order is already reconciled in the system', 400));
      }
    }

    const orderIdToStore = finalOrderId || `manual_${successfulPayment.id}`;

    // 3. Handle Plan Reconcile
    if (targetType === 'plan') {
      let planTx;

      if (existingId) {
        planTx = await PlanTransaction.findById(existingId);
        if (!planTx) return next(new AppError('Existing Plan Transaction not found', 404));
        if (planTx.status === 'completed') return next(new AppError('This transaction is already completed', 400));

        // Update existing
        planTx.status = 'completed';
        planTx.paymentId = successfulPayment.id;
        planTx.paymentDetails = successfulPayment;
        planTx.orderId = orderIdToStore;
        await planTx.save();
      } else {
        const plan = await Plan.findById(targetId.planId);
        if (!plan) return next(new AppError('Plan not found', 404));

        // Calculate expected amount
        let discountAmount = 0;
        if (targetId.couponCode) {
          const coupon = await Coupon.findOne({
            code: targetId.couponCode.toUpperCase(),
            isActive: true,
            appliesTo: 'plan'
          });
          if (coupon) {
            discountAmount = (plan.finalPrice * coupon.discountValue) / 100;
          }
        }

        const checkoutFields = await getActiveCheckoutFields();
        const calculation = await calculateCheckoutTotal(
          plan.finalPrice,
          checkoutFields,
          discountAmount > 0 ? { amount: discountAmount, label: `Coupon (${targetId.couponCode!.toUpperCase()})` } : undefined
        );

        // Verify amount
        if (Math.abs(calculation.total - payedAmountInRupees) > 1 && !allowAmountMismatch) {
          return res.status(200).json({
            success: false,
            needsConfirmation: true,
            message: `Amount mismatch! Razorpay: ₹${payedAmountInRupees}, Expected: ₹${calculation.total.toFixed(2)}`,
            data: { razorpayAmount: payedAmountInRupees, expectedAmount: calculation.total }
          });
        }

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
        const count = await PlanTransaction.countDocuments({
          transactionId: { $regex: new RegExp(`^PTX-${dateStr}-`) }
        });
        const transactionId = `PTX-${dateStr}-${String(count + 1).padStart(3, '0')}`;

        const paymentBreakdown = calculation.breakdown.map((item: any) => {
          const field = checkoutFields.find(f => f.fieldName === item.fieldName);
          return {
            fieldName: item.fieldName,
            fieldDisplayName: item.fieldDisplayName,
            chargeType: field?.chargeType || 'fixed',
            value: field?.value || 0,
            amount: item.amount
          };
        });

        planTx = await PlanTransaction.create({
          userId: userIdObj,
          planId: plan._id,
          orderId: orderIdToStore,
          transactionId,
          amount: payedAmountInRupees,
          credits: plan.totalCredits,
          planSnapshot: {
            name: plan.planName,
            originalPrice: plan.originalPrice,
            finalPrice: plan.finalPrice
          },
          paymentId: successfulPayment.id,
          paymentDetails: successfulPayment,
          paymentBreakdown,
          status: 'completed',
          couponCode: targetId.couponCode?.toUpperCase(),
          discountAmount
        });
      }

      // Activation logic for plan
      const planToActivate = await Plan.findById(planTx.planId);
      if (!planToActivate) return next(new AppError('Associated Plan not found', 404));

      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + (planToActivate.validity || 365));

      let userPlan = await UserPlan.findOne({ userId: userIdObj });
      if (!userPlan) {
        await UserPlan.create({ userId: userIdObj, activePlanId: planToActivate._id.toString(), expiresAt: expiryDate });
      } else {
        userPlan.activePlanId = planToActivate._id.toString();
        userPlan.expiresAt = expiryDate;
        await userPlan.save();
      }

      let userCredits = await UserCredits.findOne({ userId: userIdObj });
      if (!userCredits) {
        await UserCredits.create({ userId: userIdObj, credits: planTx.credits });
      } else {
        userCredits.credits += planTx.credits;
        await userCredits.save();
      }

      return res.status(200).json({ success: true, message: 'Plan reconciled and activated successfully', data: planTx });
    }

    // 4. Handle Service Reconcile
    if (targetType === 'service') {
      if (existingId) {
        const booking = await Booking.findById(existingId);
        if (!booking) return next(new AppError('Existing Booking not found', 404));
        if (booking.paymentStatus === 'paid') return next(new AppError('This booking is already paid', 400));

        // Update existing booking
        booking.paymentStatus = 'paid';
        booking.status = 'confirmed';
        booking.paymentId = successfulPayment.id;
        booking.paymentDetails = successfulPayment;
        booking.orderId = orderIdToStore;
        // Optionally update breakdown if we have a way to recalculate it or just store the final total
        await booking.save();

        await OrderItem.updateMany({ bookingId: booking._id }, { status: 'confirmed' });
        await autoAssignServicePartner(booking, await OrderItem.find({ bookingId: booking._id }));

        return res.status(200).json({ success: true, message: 'Existing booking reconciled successfully', data: booking });
      }

      const { items, addressId, bookingType, scheduledDate, scheduledTime, couponCode, useCredits } = targetId;

      const address = await Address.findOne({ id: addressId, userId: userIdObj });
      if (!address) return next(new AppError('Address not found', 404));

      let totalAmount = 0;
      let totalOriginalAmount = 0;
      let orderItemsData = [];
      let creditsToDeduct = 0;

      for (const item of items) {
        const service = await Service.findOne({ $or: [{ id: item.serviceId }, { name: item.serviceId }] });
        const variant = await ServiceVariant.findOne({ $or: [{ id: item.variantId }, { name: item.variantId }] });
        if (!service || !variant) return next(new AppError(`Service/variant not found: ${item.variantId}`, 404));

        const qty = item.quantity || 1;
        totalAmount += variant.finalPrice * qty;
        totalOriginalAmount += variant.originalPrice * qty;

        orderItemsData.push({
          serviceId: service._id,
          serviceVariantId: variant._id,
          variantName: variant.name,
          serviceName: service.name,
          basePrice: variant.finalPrice,
          originalPrice: variant.originalPrice,
          finalPrice: variant.finalPrice,
          quantity: qty,
          creditValue: variant.creditValue || 0,
          estimatedTimeMinutes: variant.estimatedTimeMinutes,
          customerVisitRequired: variant.customerVisitRequired || false
        });
      }

      if (useCredits) {
        const uCredits = await UserCredits.findOne({ userId: userIdObj });
        let tempCredits = uCredits?.credits || 0;
        for (const item of orderItemsData) {
          const cost = item.creditValue * item.quantity;
          if (tempCredits >= cost && cost > 0) {
            tempCredits -= cost;
            creditsToDeduct += cost;
            item.finalPrice = 0;
            totalAmount -= item.basePrice * item.quantity;
          }
        }
      }

      let discountAmount = 0;
      if (couponCode) {
        const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true, appliesTo: 'service' });
        if (coupon) discountAmount = (totalAmount * coupon.discountValue) / 100;
      }

      const checkoutFields = await getActiveCheckoutFields();
      const calculation = await calculateCheckoutTotal(totalAmount, checkoutFields, discountAmount > 0 ? { amount: discountAmount, label: `Coupon (${couponCode.toUpperCase()})` } : undefined);

      if (Math.abs(calculation.total - payedAmountInRupees) > 1 && !allowAmountMismatch) {
        return res.status(200).json({
          success: false,
          needsConfirmation: true,
          message: `Amount mismatch! Razorpay: ₹${payedAmountInRupees}, Expected: ₹${calculation.total.toFixed(2)}`,
          data: { razorpayAmount: payedAmountInRupees, expectedAmount: calculation.total }
        });
      }

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
      const bCount = await Booking.countDocuments({ bookingId: { $regex: new RegExp(`^BOOK-${dateStr}-`) } });
      const bookingId = `BOOK-${dateStr}-${String(bCount + 1).padStart(3, '0')}`;

      const booking = await Booking.create({
        userId: userIdObj,
        bookingId,
        addressId: address.id,
        address: { label: address.label, fullAddress: address.fullAddress, area: address.area, coordinates: address.coordinates },
        bookingType: bookingType || 'ASAP',
        scheduledDate: scheduledDate ? new Date(scheduledDate) : new Date(),
        scheduledTime: scheduledTime || 'ASAP',
        totalAmount: calculation.total,
        itemTotal: totalAmount,
        totalOriginalAmount,
        creditsUsed: creditsToDeduct,
        couponCode: couponCode?.toUpperCase(),
        discountAmount,
        paymentStatus: 'paid',
        paymentId: successfulPayment.id,
        paymentDetails: successfulPayment,
        status: 'confirmed',
        orderId: orderIdToStore,
        paymentBreakdown: calculation.breakdown
      });

      await OrderItem.insertMany(orderItemsData.map(item => ({ ...item, bookingId: booking._id, status: 'confirmed' })));

      if (creditsToDeduct > 0) {
        const uCredits = await UserCredits.findOne({ userId: userIdObj });
        if (uCredits) {
          uCredits.credits = Math.max(0, uCredits.credits - creditsToDeduct);
          await uCredits.save();
        }
      }

      await autoAssignServicePartner(booking, await OrderItem.find({ bookingId: booking._id }));

      return res.status(200).json({ success: true, message: 'Service booking reconciled successfully', data: booking });
    }

    return next(new AppError('Invalid target type', 400));
  } catch (error: any) {
    console.error('[PaymentController] Error in reconcileExternalPayment:', error);
    return next(new AppError(error.message || 'Reconciliation failed', 500));
  }
});

