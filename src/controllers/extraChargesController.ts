import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import OrderItem, { IExtraCharge } from '../models/OrderItem';
import ServicePartner from '../models/ServicePartner';
import Booking from '../models/Booking';
import { BookingStatus, COMPLETED_BOOKING_STATUSES } from '../constants/bookingStatus';
import { getRazorpayInstance } from './paymentController';

// ============================================================
// SERVICE PARTNER EXTRA CHARGES ENDPOINTS
// ============================================================

// @desc    Add an extra charge to an order item
// @route   POST /api/provider/jobs/:id/extra-charges
// @access  Private (ServicePartner)
export const addExtraCharge = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { amount, description, notes } = req.body;
    const user = req.user;

    // Validation
    if (!amount || amount <= 0) {
        return next(new AppError('Amount must be a positive number', 400));
    }
    if (!description || description.trim().length < 3) {
        return next(new AppError('Description is required (minimum 3 characters)', 400));
    }

    const partner = await ServicePartner.findOne({ phone: user?.phone });
    if (!partner) {
        return next(new AppError('Partner not found', 404));
    }

    const job = await OrderItem.findOne({
        _id: id,
        assignedPartnerId: partner._id
    }).populate('bookingId');

    if (!job) {
        return next(new AppError('Job not found or not assigned to you', 404));
    }

    // Cannot add extra charges to completed/cancelled jobs
    if (COMPLETED_BOOKING_STATUSES.includes(job.status as BookingStatus)) {
        return next(new AppError('Cannot add extra charges to a completed or cancelled job', 400));
    }

    // Job must be in progress or reached to add extra charges
    const allowedStatuses = [BookingStatus.IN_PROGRESS, BookingStatus.REACHED];
    if (!allowedStatuses.includes(job.status as BookingStatus)) {
        return next(new AppError('Extra charges can only be added when job is in progress or reached', 400));
    }

    // Create new extra charge
    const extraCharge: IExtraCharge = {
        id: uuidv4(),
        amount: Math.round(amount * 100) / 100, // Round to 2 decimal places
        description: description.trim(),
        status: 'pending',
        addedBy: partner._id,
        addedByName: partner.name,
        addedAt: new Date(),
        notes: notes?.trim() || undefined
    };

    // Add to job's extra charges array
    if (!job.extraCharges) {
        job.extraCharges = [];
    }
    job.extraCharges.push(extraCharge);
    await job.save();

    // Log action on booking
    const booking = await Booking.findById(job.bookingId);
    if (booking) {
        booking.actionLog.push({
            action: 'EXTRA_CHARGE_ADDED',
            performedBy: partner.name,
            timestamp: new Date(),
            details: `Added extra charge of ₹${amount}: ${description}`
        });
        await booking.save();
    }

    res.status(201).json({
        success: true,
        message: 'Extra charge added successfully',
        data: {
            chargeId: extraCharge.id,
            charge: extraCharge,
            orderItem: job
        }
    });
});

// @desc    Get extra charges for a job
// @route   GET /api/provider/jobs/:id/extra-charges
// @access  Private (ServicePartner)
export const getExtraCharges = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const user = req.user;

    const partner = await ServicePartner.findOne({ phone: user?.phone });
    if (!partner) {
        return next(new AppError('Partner not found', 404));
    }

    const job = await OrderItem.findOne({
        _id: id,
        assignedPartnerId: partner._id
    });

    if (!job) {
        return next(new AppError('Job not found or not assigned to you', 404));
    }

    const charges = job.extraCharges || [];
    const pendingCharges = charges.filter(c => c.status === 'pending');
    const paidCharges = charges.filter(c => c.status === 'paid');
    const totalPending = pendingCharges.reduce((sum, c) => sum + c.amount, 0);
    const totalPaid = paidCharges.reduce((sum, c) => sum + c.amount, 0);

    res.status(200).json({
        success: true,
        data: {
            charges,
            summary: {
                total: charges.length,
                pending: pendingCharges.length,
                paid: paidCharges.length,
                totalPendingAmount: totalPending,
                totalPaidAmount: totalPaid
            }
        }
    });
});

// @desc    Cancel/remove a pending extra charge
// @route   DELETE /api/provider/jobs/:id/extra-charges/:chargeId
// @access  Private (ServicePartner)
export const cancelExtraCharge = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id, chargeId } = req.params;
    const user = req.user;

    const partner = await ServicePartner.findOne({ phone: user?.phone });
    if (!partner) {
        return next(new AppError('Partner not found', 404));
    }

    const job = await OrderItem.findOne({
        _id: id,
        assignedPartnerId: partner._id
    });

    if (!job) {
        return next(new AppError('Job not found or not assigned to you', 404));
    }

    const chargeIndex = job.extraCharges?.findIndex(c => c.id === chargeId);
    if (chargeIndex === undefined || chargeIndex === -1) {
        return next(new AppError('Extra charge not found', 404));
    }

    const charge = job.extraCharges[chargeIndex];

    // Can only cancel pending charges
    if (charge.status !== 'pending') {
        return next(new AppError('Only pending charges can be cancelled', 400));
    }

    // Mark as cancelled instead of removing
    job.extraCharges[chargeIndex].status = 'cancelled';
    await job.save();

    // Log action on booking
    const booking = await Booking.findById(job.bookingId);
    if (booking) {
        booking.actionLog.push({
            action: 'EXTRA_CHARGE_CANCELLED',
            performedBy: partner.name,
            timestamp: new Date(),
            details: `Cancelled extra charge of ₹${charge.amount}: ${charge.description}`
        });
        await booking.save();
    }

    res.status(200).json({
        success: true,
        message: 'Extra charge cancelled successfully',
        data: { orderItem: job }
    });
});

// @desc    Create Razorpay QR code for extra charge payment
// @route   POST /api/provider/jobs/:id/extra-charges/:chargeId/create-order
// @access  Private (ServicePartner)
export const createExtraChargeOrder = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id, chargeId } = req.params;
    const user = req.user;

    const partner = await ServicePartner.findOne({ phone: user?.phone });
    if (!partner) {
        return next(new AppError('Partner not found', 404));
    }

    const job = await OrderItem.findOne({
        _id: id,
        assignedPartnerId: partner._id
    }).populate('bookingId');

    if (!job) {
        return next(new AppError('Job not found or not assigned to you', 404));
    }

    const chargeIndex = job.extraCharges?.findIndex(c => c.id === chargeId);
    if (chargeIndex === undefined || chargeIndex === -1) {
        return next(new AppError('Extra charge not found', 404));
    }

    const charge = job.extraCharges[chargeIndex];

    if (charge.status === 'paid') {
        return res.status(200).json({
            success: true,
            message: 'Payment already completed',
            data: {
                alreadyPaid: true,
                orderItem: job
            }
        });
    }

    if (charge.status !== 'pending') {
        return next(new AppError('This charge is not pending', 400));
    }

    const booking = job.bookingId as any;

    // Type for Razorpay QR response
    interface RazorpayQrResponse {
        id: string;
        image_url: string;
        status: string;
        payments_count_received: number;
        close_by?: number;
    }

    // If QR code already exists, check its status
    if (charge.razorpayQrId) {
        try {
            // Fetch QR code status using fetch API (Razorpay SDK doesn't have direct QR methods)
            const qrResponse = await fetch(`https://api.razorpay.com/v1/payments/qr_codes/${charge.razorpayQrId}`, {
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_API_SECRET}`).toString('base64')
                }
            });

            if (qrResponse.ok) {
                const qrData = await qrResponse.json() as RazorpayQrResponse;

                // Check if there are payments on this QR
                if (qrData.payments_count_received > 0) {
                    // Payment received! Update status
                    job.extraCharges[chargeIndex].status = 'paid';
                    job.extraCharges[chargeIndex].paymentMethod = 'upi';
                    job.extraCharges[chargeIndex].paidAt = new Date();
                    await job.save();

                    return res.status(200).json({
                        success: true,
                        message: 'Payment already completed',
                        data: {
                            alreadyPaid: true,
                            orderItem: job
                        }
                    });
                }

                // QR still valid, return it
                if (qrData.status === 'active') {
                    return res.status(200).json({
                        success: true,
                        data: {
                            qrId: qrData.id,
                            qrCodeImageUrl: qrData.image_url,
                            amount: charge.amount,
                            description: charge.description,
                            bookingId: booking?.bookingId || 'Unknown',
                            expiresAt: qrData.close_by ? new Date(qrData.close_by * 1000).toISOString() : null
                        }
                    });
                }
            }
        } catch (error) {
            console.error('[ExtraCharges] Failed to fetch existing QR:', error);
            // Continue to create new QR
        }
    }

    // Create new Razorpay QR Code
    try {
        const closeBy = Math.floor(Date.now() / 1000) + 3600; // Expires in 1 hour

        const qrResponse = await fetch('https://api.razorpay.com/v1/payments/qr_codes', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_API_SECRET}`).toString('base64'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: 'upi_qr',
                name: `Extra Charge - ${booking?.bookingId || 'Job'}`,
                usage: 'single_use',
                fixed_amount: true,
                payment_amount: Math.round(charge.amount * 100), // Amount in paise
                description: charge.description.substring(0, 40), // Max 40 chars
                customer_id: null, // Optional
                close_by: closeBy,
                notes: {
                    type: 'extra_charge',
                    orderItemId: job._id.toString(),
                    chargeId: charge.id,
                    bookingId: booking?.bookingId || '',
                    addedBy: partner.name
                }
            })
        });

        if (!qrResponse.ok) {
            const errorData = await qrResponse.json() as { error?: { description?: string } };
            console.error('[ExtraCharges] Razorpay QR creation failed:', errorData);
            return next(new AppError(errorData.error?.description || 'Failed to create QR code', 500));
        }

        const qrData = await qrResponse.json() as RazorpayQrResponse;

        // Store QR ID on the charge for future reference
        job.extraCharges[chargeIndex].razorpayQrId = qrData.id;
        job.extraCharges[chargeIndex].razorpayOrderId = qrData.id; // Keep for compatibility
        await job.save();

        res.status(200).json({
            success: true,
            data: {
                qrId: qrData.id,
                qrCodeImageUrl: qrData.image_url,
                amount: charge.amount,
                description: charge.description,
                bookingId: booking?.bookingId || 'Unknown',
                expiresAt: new Date(closeBy * 1000).toISOString()
            }
        });
    } catch (error: any) {
        console.error('[ExtraCharges] Failed to create Razorpay QR:', error);
        return next(new AppError(error.message || 'Failed to create QR code', 500));
    }
});


// @desc    Verify Razorpay payment for extra charge
// @route   POST /api/provider/jobs/:id/extra-charges/:chargeId/verify-payment
// @access  Private (ServicePartner)
export const verifyExtraChargePayment = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id, chargeId } = req.params;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const user = req.user;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return next(new AppError('Missing payment verification parameters', 400));
    }

    const partner = await ServicePartner.findOne({ phone: user?.phone });
    if (!partner) {
        return next(new AppError('Partner not found', 404));
    }

    const job = await OrderItem.findOne({
        _id: id,
        assignedPartnerId: partner._id
    }).populate('bookingId');

    if (!job) {
        return next(new AppError('Job not found or not assigned to you', 404));
    }

    const chargeIndex = job.extraCharges?.findIndex(c => c.id === chargeId);
    if (chargeIndex === undefined || chargeIndex === -1) {
        return next(new AppError('Extra charge not found', 404));
    }

    const charge = job.extraCharges[chargeIndex];

    if (charge.status === 'paid') {
        return res.status(200).json({
            success: true,
            message: 'Payment already verified',
            data: { orderItem: job }
        });
    }

    // Verify signature
    const keySecret = process.env.RAZORPAY_API_SECRET;
    if (!keySecret) {
        return next(new AppError('Payment gateway not configured', 500));
    }

    const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

    if (expectedSignature !== razorpay_signature) {
        return next(new AppError('Payment verification failed - invalid signature', 400));
    }

    // Update charge status
    job.extraCharges[chargeIndex].status = 'paid';
    job.extraCharges[chargeIndex].paymentMethod = 'upi';
    job.extraCharges[chargeIndex].razorpayPaymentId = razorpay_payment_id;
    job.extraCharges[chargeIndex].paidAt = new Date();
    await job.save();

    // Log action on booking
    const booking = await Booking.findById(job.bookingId);
    if (booking) {
        booking.actionLog.push({
            action: 'EXTRA_CHARGE_PAID',
            performedBy: partner.name,
            timestamp: new Date(),
            details: `Extra charge of ₹${charge.amount} paid via UPI (${razorpay_payment_id})`
        });
        await booking.save();
    }

    res.status(200).json({
        success: true,
        message: 'Payment verified successfully',
        data: { orderItem: job }
    });
});

// @desc    Confirm cash payment for extra charge
// @route   POST /api/provider/jobs/:id/extra-charges/:chargeId/confirm-cash
// @access  Private (ServicePartner)
export const confirmCashPayment = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id, chargeId } = req.params;
    const { confirmation } = req.body;
    const user = req.user;

    if (confirmation !== true) {
        return next(new AppError('Please confirm you have collected the cash payment', 400));
    }

    const partner = await ServicePartner.findOne({ phone: user?.phone });
    if (!partner) {
        return next(new AppError('Partner not found', 404));
    }

    const job = await OrderItem.findOne({
        _id: id,
        assignedPartnerId: partner._id
    }).populate('bookingId');

    if (!job) {
        return next(new AppError('Job not found or not assigned to you', 404));
    }

    const chargeIndex = job.extraCharges?.findIndex(c => c.id === chargeId);
    if (chargeIndex === undefined || chargeIndex === -1) {
        return next(new AppError('Extra charge not found', 404));
    }

    const charge = job.extraCharges[chargeIndex];

    if (charge.status === 'paid') {
        return res.status(200).json({
            success: true,
            message: 'Payment already confirmed',
            data: { orderItem: job }
        });
    }

    if (charge.status !== 'pending') {
        return next(new AppError('This charge is not pending', 400));
    }

    // Update charge status
    job.extraCharges[chargeIndex].status = 'paid';
    job.extraCharges[chargeIndex].paymentMethod = 'cash';
    job.extraCharges[chargeIndex].paidAt = new Date();
    await job.save();

    // Log action on booking
    const booking = await Booking.findById(job.bookingId);
    if (booking) {
        booking.actionLog.push({
            action: 'EXTRA_CHARGE_PAID',
            performedBy: partner.name,
            timestamp: new Date(),
            details: `Extra charge of ₹${charge.amount} collected in cash`
        });
        await booking.save();
    }

    res.status(200).json({
        success: true,
        message: 'Cash payment confirmed successfully',
        data: { orderItem: job }
    });
});

// @desc    Check if job can be completed (no pending extra charges)
// @route   GET /api/provider/jobs/:id/can-complete
// @access  Private (ServicePartner)
export const canCompleteJob = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const user = req.user;

    const partner = await ServicePartner.findOne({ phone: user?.phone });
    if (!partner) {
        return next(new AppError('Partner not found', 404));
    }

    const job = await OrderItem.findOne({
        _id: id,
        assignedPartnerId: partner._id
    });

    if (!job) {
        return next(new AppError('Job not found or not assigned to you', 404));
    }

    const pendingCharges = (job.extraCharges || []).filter(c => c.status === 'pending');
    const canComplete = pendingCharges.length === 0;
    const pendingAmount = pendingCharges.reduce((sum, c) => sum + c.amount, 0);

    res.status(200).json({
        success: true,
        data: {
            canComplete,
            pendingChargesCount: pendingCharges.length,
            pendingAmount,
            message: canComplete
                ? 'Job can be completed'
                : `Please collect ${pendingCharges.length} pending payment(s) of ₹${pendingAmount} before completing the job`
        }
    });
});

// @desc    Check payment status for an extra charge (poll endpoint)
// @route   GET /api/provider/jobs/:id/extra-charges/:chargeId/payment-status
// @access  Private (ServicePartner)
export const checkPaymentStatus = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id, chargeId } = req.params;
    const user = req.user;

    const partner = await ServicePartner.findOne({ phone: user?.phone });
    if (!partner) {
        return next(new AppError('Partner not found', 404));
    }

    const job = await OrderItem.findOne({
        _id: id,
        assignedPartnerId: partner._id
    }).populate('bookingId');

    if (!job) {
        return next(new AppError('Job not found or not assigned to you', 404));
    }

    const chargeIndex = job.extraCharges?.findIndex(c => c.id === chargeId);
    if (chargeIndex === undefined || chargeIndex === -1) {
        return next(new AppError('Extra charge not found', 404));
    }

    const charge = job.extraCharges[chargeIndex];

    // Already paid - return success
    if (charge.status === 'paid') {
        return res.status(200).json({
            success: true,
            data: {
                status: 'paid',
                paymentMethod: charge.paymentMethod,
                paidAt: charge.paidAt
            }
        });
    }

    // If no QR ID, still pending
    if (!charge.razorpayQrId) {
        return res.status(200).json({
            success: true,
            data: {
                status: 'pending',
                message: 'No payment initiated yet'
            }
        });
    }

    // Check Razorpay QR status
    try {
        // Type for Razorpay QR response
        interface RazorpayQrResponse {
            id: string;
            status: string;
            payments_count_received: number;
            payments_amount_received: number;
        }

        const qrResponse = await fetch(`https://api.razorpay.com/v1/payments/qr_codes/${charge.razorpayQrId}`, {
            headers: {
                'Authorization': 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_API_SECRET}`).toString('base64')
            }
        });

        if (!qrResponse.ok) {
            return res.status(200).json({
                success: true,
                data: {
                    status: 'pending',
                    message: 'Unable to verify payment status'
                }
            });
        }

        const qrData = await qrResponse.json() as RazorpayQrResponse;

        // Check if payment received
        if (qrData.payments_count_received > 0) {
            // Payment received! Update charge status
            job.extraCharges[chargeIndex].status = 'paid';
            job.extraCharges[chargeIndex].paymentMethod = 'upi';
            job.extraCharges[chargeIndex].paidAt = new Date();
            await job.save();

            // Log action on booking
            const booking = await Booking.findById(job.bookingId);
            if (booking) {
                booking.actionLog.push({
                    action: 'EXTRA_CHARGE_PAID',
                    performedBy: 'Customer (via UPI)',
                    timestamp: new Date(),
                    details: `Extra charge of ₹${charge.amount} paid via UPI QR`
                });
                await booking.save();
            }

            return res.status(200).json({
                success: true,
                data: {
                    status: 'paid',
                    paymentMethod: 'upi',
                    paidAt: new Date()
                }
            });
        }

        // Still pending
        return res.status(200).json({
            success: true,
            data: {
                status: 'pending',
                qrStatus: qrData.status,
                message: 'Waiting for payment'
            }
        });

    } catch (error: any) {
        console.error('[ExtraCharges] Failed to check payment status:', error);
        return res.status(200).json({
            success: true,
            data: {
                status: 'pending',
                message: 'Unable to verify payment status'
            }
        });
    }
});

// ============================================================
// CUSTOMER EXTRA CHARGES ENDPOINTS
// ============================================================


// @desc    Get bookings with pending extra charges for customer
// @route   GET /api/bookings/pending-extra-payments
// @access  Private (Customer)
export const getCustomerPendingPayments = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) {
        return next(new AppError('User not authenticated', 401));
    }

    // Find bookings for this user
    const bookings = await Booking.find({ userId }).select('_id bookingId');
    const bookingIds = bookings.map(b => b._id);

    // Find order items with pending extra charges
    const orderItems = await OrderItem.find({
        bookingId: { $in: bookingIds },
        'extraCharges.status': 'pending'
    }).populate('bookingId', 'bookingId scheduledDate scheduledTime address');

    // Transform to useful format
    const pendingPayments: any[] = [];

    for (const item of orderItems) {
        const pendingCharges = (item.extraCharges || []).filter(c => c.status === 'pending');
        if (pendingCharges.length === 0) continue;

        const booking = item.bookingId as any;

        for (const charge of pendingCharges) {
            pendingPayments.push({
                orderItemId: item._id,
                chargeId: charge.id,
                bookingId: booking?.bookingId,
                bookingMongoId: booking?._id,
                serviceName: item.serviceName,
                variantName: item.variantName,
                amount: charge.amount,
                description: charge.description,
                addedByName: charge.addedByName,
                addedAt: charge.addedAt
            });
        }
    }

    res.status(200).json({
        success: true,
        data: {
            pendingPayments,
            totalPending: pendingPayments.reduce((sum, p) => sum + p.amount, 0),
            count: pendingPayments.length
        }
    });
});

// @desc    Create Razorpay order for customer to pay extra charge
// @route   POST /api/bookings/:bookingId/items/:itemId/extra-charges/:chargeId/pay
// @access  Private (Customer)
export const createCustomerPaymentOrder = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { bookingId, itemId, chargeId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
        return next(new AppError('User not authenticated', 401));
    }

    // Find booking and verify ownership
    const booking = await Booking.findOne({
        $or: [
            { _id: bookingId },
            { bookingId: bookingId }
        ],
        userId
    });

    if (!booking) {
        return next(new AppError('Booking not found', 404));
    }

    const job = await OrderItem.findOne({
        _id: itemId,
        bookingId: booking._id
    });

    if (!job) {
        return next(new AppError('Order item not found', 404));
    }

    const chargeIndex = job.extraCharges?.findIndex(c => c.id === chargeId);
    if (chargeIndex === undefined || chargeIndex === -1) {
        return next(new AppError('Extra charge not found', 404));
    }

    const charge = job.extraCharges[chargeIndex];

    if (charge.status !== 'pending') {
        return next(new AppError('This charge is not pending', 400));
    }

    // Create Razorpay order
    try {
        const razorpay = getRazorpayInstance();

        const order = await razorpay.orders.create({
            amount: Math.round(charge.amount * 100), // Convert to paise
            currency: 'INR',
            receipt: `ECU-${chargeId.substring(0, 8)}`,
            notes: {
                type: 'extra_charge_customer',
                orderItemId: job._id.toString(),
                chargeId: charge.id,
                bookingId: booking.bookingId,
                userId: userId
            }
        });
        // Store order ID
        job.extraCharges[chargeIndex].razorpayOrderId = order.id;
        await job.save();

        res.status(200).json({
            success: true,
            data: {
                orderId: order.id,
                amount: order.amount,
                amountDisplay: charge.amount,
                currency: order.currency,
                description: charge.description,
                keyId: process.env.RAZORPAY_KEY_ID,
                prefill: {
                    name: req.user?.name || '',
                    contact: req.user?.phone || '',
                    email: req.user?.email || ''
                }
            }
        });
    } catch (error: any) {
        console.error('[ExtraCharges] Failed to create customer payment order:', error);
        return next(new AppError(error.message || 'Failed to create payment order', 500));
    }
});

// @desc    Verify customer payment for extra charge
// @route   POST /api/bookings/:bookingId/items/:itemId/extra-charges/:chargeId/verify
// @access  Private (Customer)
export const verifyCustomerPayment = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { bookingId, itemId, chargeId } = req.params;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const userId = req.user?.id;

    if (!userId) {
        return next(new AppError('User not authenticated', 401));
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return next(new AppError('Missing payment verification parameters', 400));
    }

    // Find booking and verify ownership
    const booking = await Booking.findOne({
        $or: [
            { _id: bookingId },
            { bookingId: bookingId }
        ],
        userId
    });

    if (!booking) {
        return next(new AppError('Booking not found', 404));
    }

    const job = await OrderItem.findOne({
        _id: itemId,
        bookingId: booking._id
    });

    if (!job) {
        return next(new AppError('Order item not found', 404));
    }

    const chargeIndex = job.extraCharges?.findIndex(c => c.id === chargeId);
    if (chargeIndex === undefined || chargeIndex === -1) {
        return next(new AppError('Extra charge not found', 404));
    }

    const charge = job.extraCharges[chargeIndex];

    if (charge.status === 'paid') {
        return res.status(200).json({
            success: true,
            message: 'Payment already verified',
            data: { alreadyPaid: true }
        });
    }

    // Verify signature
    const keySecret = process.env.RAZORPAY_API_SECRET;
    if (!keySecret) {
        return next(new AppError('Payment gateway not configured', 500));
    }

    const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

    if (expectedSignature !== razorpay_signature) {
        return next(new AppError('Payment verification failed - invalid signature', 400));
    }

    // Update charge status
    job.extraCharges[chargeIndex].status = 'paid';
    job.extraCharges[chargeIndex].paymentMethod = 'razorpay';
    job.extraCharges[chargeIndex].razorpayPaymentId = razorpay_payment_id;
    job.extraCharges[chargeIndex].paidAt = new Date();
    await job.save();

    // Log action on booking
    booking.actionLog.push({
        action: 'EXTRA_CHARGE_PAID',
        performedBy: 'Customer',
        timestamp: new Date(),
        details: `Extra charge of ₹${charge.amount} paid via Razorpay (${razorpay_payment_id})`
    });
    await booking.save();

    res.status(200).json({
        success: true,
        message: 'Payment verified successfully'
    });
});
// ============================================================
// ADMIN EXTRA CHARGES ENDPOINTS
// ============================================================

// @desc    Waive off a pending extra charge (Admin)
// @route   POST /api/admin/bookings/:id/items/:itemId/extra-charges/:chargeId/waive
// @access  Private (Admin)
export const waiveExtraCharge = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const { id, itemId, chargeId } = req.params;
    const adminUser = req.user;

    const job = await OrderItem.findOne({
        _id: itemId,
        $or: [
            { bookingId: id },
            { _id: itemId } // In case id is booking or item, findOne handles it
        ]
    }).populate('bookingId');

    if (!job) {
        return next(new AppError('Item not found', 404));
    }

    const chargeIndex = job.extraCharges?.findIndex(c => c.id === chargeId);
    if (chargeIndex === undefined || chargeIndex === -1) {
        return next(new AppError('Extra charge not found', 404));
    }

    const charge = job.extraCharges[chargeIndex];

    // Can only waive pending charges
    if (charge.status !== 'pending') {
        return next(new AppError('Only pending charges can be waived', 400));
    }

    // Mark as waived
    job.extraCharges[chargeIndex].status = 'waived';
    await job.save();

    // Log action on booking
    const booking = await Booking.findById(job.bookingId);
    if (booking) {
        booking.actionLog.push({
            action: 'EXTRA_CHARGE_WAIVED',
            performedBy: adminUser?.name || 'Admin',
            timestamp: new Date(),
            details: `Admin waived off extra charge of ₹${charge.amount}: ${charge.description}`
        });
        await booking.save();
    }

    res.status(200).json({
        success: true,
        message: 'Extra charge waived successfully',
        data: { orderItem: job }
    });
});
