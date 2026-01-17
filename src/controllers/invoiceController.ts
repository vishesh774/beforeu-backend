import { Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Booking from '../models/Booking';
import OrderItem from '../models/OrderItem';
import PlanTransaction from '../models/PlanTransaction';
import CompanySettings from '../models/CompanySettings';
import { generateInvoiceBuffer } from '../utils/pdfGenerator';

// @desc    Generate Invoice PDF
// @route   GET /api/admin/invoices/booking/:id OR /api/admin/invoices/plan-transaction/:id
// @access  Private/Admin
export const generateInvoicePDF = asyncHandler(async (req: any, res: Response, next: any) => {
    const { id } = req.params;
    const isBooking = req.path.includes('booking');

    try {
        const companySettings = (await CompanySettings.findOne()) || {
            name: "BeforeU",
            address: "",
            phone: "",
            email: "",
            gstNumber: "",
            invoicePrefix: "BU"
        };

        const settings = companySettings as any;
        let invoiceData: any = {};

        if (isBooking) {
            const booking = await Booking.findById(id).populate('userId');
            if (!booking) return next(new AppError('Booking not found', 404));

            const orderItems = await OrderItem.find({ bookingId: booking._id });
            const customer = booking.userId as any;

            // Determine payment method
            let paymentMethod = 'Online';
            if (booking.paymentDetails?.method) {
                paymentMethod = booking.paymentDetails.method;
            } else if (booking.creditsUsed > 0 && booking.totalAmount === 0) {
                paymentMethod = 'Credits';
            }

            invoiceData = {
                invoiceNumber: `${settings.invoicePrefix}-${booking.bookingId}`,
                date: booking.createdAt,
                customerName: customer?.name,
                customerPhone: customer?.phone,
                customerEmail: customer?.email,
                customerAddress: booking.address?.fullAddress,
                items: orderItems.map(item => ({
                    description: `${item.serviceName} - ${item.variantName}`,
                    quantity: item.quantity,
                    price: item.finalPrice / item.quantity, // Unit Price derived from final price (per unit)
                    total: item.finalPrice
                })),
                subtotal: booking.itemTotal || booking.totalOriginalAmount || 0,
                discount: booking.discountAmount || 0,
                creditsUsed: booking.creditsUsed || 0,
                taxBreakdown: booking.paymentBreakdown || [],
                total: booking.totalAmount || 0,
                paymentStatus: booking.paymentStatus,
                paymentId: booking.paymentId,
                paymentMethod: paymentMethod
            };
        } else {
            const planTx = await PlanTransaction.findById(id).populate('userId');
            if (!planTx) return next(new AppError('Plan Transaction not found', 404));

            const customer = planTx.userId as any;

            let paymentMethod = 'Online';
            if (planTx.paymentDetails?.method) {
                paymentMethod = planTx.paymentDetails.method;
            }

            invoiceData = {
                invoiceNumber: `${settings.invoicePrefix}-${planTx.transactionId}`,
                date: planTx.createdAt,
                customerName: customer?.name,
                customerPhone: customer?.phone,
                customerEmail: customer?.email,
                customerAddress: "N/A",
                items: [{
                    description: `Plan Purchase: ${planTx.planSnapshot?.name || 'Plan'}`,
                    quantity: 1,
                    price: planTx.planSnapshot?.finalPrice || planTx.amount, // Final price per unit
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
