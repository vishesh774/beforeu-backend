import { Response } from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Booking from '../models/Booking';
import OrderItem from '../models/OrderItem';
import PlanTransaction from '../models/PlanTransaction';
import CompanySettings from '../models/CompanySettings';
import { generateInvoiceBuffer } from '../utils/pdfGenerator';

/**
 * Normalizes a booking ID by removing item-specific suffixes (e.g., BOOK-XXX-1 -> BOOK-XXX)
 */
const normalizeBookingId = (id: string): string => {
    if (!id || mongoose.Types.ObjectId.isValid(id)) return id;

    // Check for human-readable BOOK- format with extra parts
    if (id.startsWith('BOOK-')) {
        const parts = id.split('-');
        if (parts.length > 3) {
            return parts.slice(0, 3).join('-');
        }
    }
    return id;
};

/**
 * Common logic to prepare invoice data from a booking and its items
 */
const prepareInvoiceData = (booking: any, orderItems: any[], settings: any) => {
    // Gather paid extra charges from all items
    const paidExtraCharges = orderItems.flatMap(item =>
        (item.extraCharges || [])
            .filter((charge: any) => charge.status === 'paid')
            .map((charge: any) => ({
                description: `Extra: ${charge.description} (${item.variantName})`,
                quantity: 1,
                price: charge.amount,
                total: charge.amount
            }))
    );

    const extraChargesTotal = paidExtraCharges.reduce((sum, c) => sum + c.total, 0);

    // Determine payment method
    let paymentMethod = 'Online';
    if (booking.paymentDetails?.method) {
        paymentMethod = booking.paymentDetails.method.charAt(0).toUpperCase() + booking.paymentDetails.method.slice(1);
    } else if (booking.creditsUsed > 0 && booking.totalAmount === 0) {
        paymentMethod = 'Credits';
    }

    return {
        invoiceNumber: booking.invoiceNumber || `${settings.invoicePrefix}-${booking.bookingId}`,
        date: booking.createdAt,
        customerName: booking.userId?.name,
        customerPhone: booking.userId?.phone,
        customerEmail: booking.userId?.email,
        customerAddress: booking.address?.fullAddress,
        billingDetails: booking.billingDetails || undefined,
        items: [
            ...orderItems.map(item => ({
                description: `${item.serviceName} - ${item.variantName}`,
                quantity: item.quantity,
                price: item.finalPrice / item.quantity,
                total: item.finalPrice
            })),
            ...paidExtraCharges
        ],
        subtotal: (booking.itemTotal || booking.totalOriginalAmount || 0) + extraChargesTotal,
        discount: booking.discountAmount || 0,
        creditsUsed: booking.creditsUsed || 0,
        taxBreakdown: booking.paymentBreakdown || [],
        total: (booking.totalAmount || 0) + extraChargesTotal,
        paymentStatus: booking.paymentStatus,
        paymentId: booking.paymentId,
        paymentMethod: paymentMethod
    };
};

// @desc    Generate Invoice PDF (Admin)
// @route   GET /api/admin/invoices/booking/:id OR /api/admin/invoices/plan-transaction/:id
// @access  Private/Admin
export const generateInvoicePDF = asyncHandler(async (req: any, res: Response, next: any) => {
    const { id } = req.params;
    const isBooking = req.path.includes('booking');

    try {
        const companySettings = (await CompanySettings.findOne()) || {
            name: "BeforeU",
            invoicePrefix: "BU"
        };
        const settings = companySettings as any;

        let invoiceData: any;

        if (isBooking) {
            const lookupId = normalizeBookingId(id);
            const query = mongoose.Types.ObjectId.isValid(lookupId)
                ? { _id: lookupId }
                : { bookingId: lookupId };

            const booking = await Booking.findOne(query).populate('userId');
            if (!booking) return next(new AppError('Booking not found', 404));

            const orderItems = await OrderItem.find({ bookingId: booking._id });
            invoiceData = prepareInvoiceData(booking, orderItems, settings);
        } else {
            const planTx = await PlanTransaction.findById(id).populate('userId');
            if (!planTx) return next(new AppError('Plan Transaction not found', 404));

            const customer = planTx.userId as any;
            const paymentMethod = planTx.paymentDetails?.method
                ? planTx.paymentDetails.method.charAt(0).toUpperCase() + planTx.paymentDetails.method.slice(1)
                : 'Online';

            invoiceData = {
                invoiceNumber: planTx.invoiceNumber || `${settings.invoicePrefix}-${planTx.transactionId}`,
                date: planTx.createdAt,
                customerName: customer?.name,
                customerPhone: customer?.phone,
                customerEmail: customer?.email,
                customerAddress: "N/A",
                items: [{
                    description: `Plan Purchase: ${planTx.planSnapshot?.name || 'Plan'}`,
                    quantity: 1,
                    price: planTx.planSnapshot?.finalPrice || planTx.amount,
                    total: planTx.planSnapshot?.finalPrice || planTx.amount
                }],
                subtotal: planTx.planSnapshot?.finalPrice || planTx.amount,
                discount: planTx.discountAmount || 0,
                creditsUsed: 0,
                taxBreakdown: planTx.paymentBreakdown || [],
                total: planTx.amount || 0,
                paymentStatus: planTx.status === 'completed' ? 'paid' : 'pending',
                paymentId: planTx.paymentId,
                paymentMethod: paymentMethod
            };
        }

        const pdfBuffer = await generateInvoiceBuffer(invoiceData);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', pdfBuffer.length);
        res.setHeader('Content-Disposition', `attachment; filename=Invoice_${invoiceData.invoiceNumber}.pdf`);
        res.send(pdfBuffer);

    } catch (error: any) {
        console.error('Invoice generation error:', error);
        return next(new AppError('Failed to generate invoice', 500));
    }
});

// @desc    Generate User Invoice PDF (Customer)
// @route   GET /api/bookings/:id/invoice
// @access  Private
export const getUserInvoicePDF = asyncHandler(async (req: any, res: Response, next: any) => {
    const { id } = req.params;
    const userId = req.user.id; // Corrected: use req.user.id from auth middleware

    try {
        const companySettings = (await CompanySettings.findOne()) || {
            name: "BeforeU",
            invoicePrefix: "BU"
        };
        const settings = companySettings as any;

        const lookupId = normalizeBookingId(id);
        const query = mongoose.Types.ObjectId.isValid(lookupId)
            ? { _id: lookupId, userId }
            : { bookingId: lookupId, userId };

        const booking = await Booking.findOne(query).populate('userId');
        if (!booking) return next(new AppError('Invoice not found or access denied', 404));

        const orderItems = await OrderItem.find({ bookingId: booking._id });
        const invoiceData = prepareInvoiceData(booking, orderItems, settings);

        const pdfBuffer = await generateInvoiceBuffer(invoiceData);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', pdfBuffer.length);
        res.setHeader('Content-Disposition', `attachment; filename=Invoice_${invoiceData.invoiceNumber}.pdf`);
        res.send(pdfBuffer);

    } catch (error: any) {
        console.error('Invoice generation error:', error);
        return next(new AppError('Failed to generate invoice', 500));
    }
});
