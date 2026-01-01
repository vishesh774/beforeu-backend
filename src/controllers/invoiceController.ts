import { Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Booking from '../models/Booking';
import OrderItem from '../models/OrderItem';
import PlanTransaction from '../models/PlanTransaction';
import CompanySettings from '../models/CompanySettings';
import PDFDocument from 'pdfkit';

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

        // Helper to format date
        const formatDate = (date: Date) => {
            return new Date(date).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
        };

        // Helper to check valid value (not null/undefined/N/A)
        const hasValue = (val: any) => val && val !== 'N/A' && val !== '';

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

        // Create PDF logic wrapped in a Promise to use Buffer
        const generateBuffer = (): Promise<Buffer> => {
            return new Promise((resolve, reject) => {
                try {
                    const doc = new PDFDocument({ margin: 50 });
                    const chunks: Buffer[] = [];

                    doc.on('data', (chunk) => chunks.push(chunk));
                    doc.on('end', () => resolve(Buffer.concat(chunks)));
                    doc.on('error', (err) => reject(err));

                    // --- PDF Design ---
                    const blueColor = '#2563eb';
                    const grayColor = '#4b5563';
                    const blackColor = '#0f172a';

                    // Layout Constants
                    const margin = 50;
                    const pageWidth = 595; // A4 width
                    const contentWidth = pageWidth - (margin * 2); // 495
                    const rightEdge = pageWidth - margin; // 545

                    // Column Grid (Strict alignment)
                    // Description: 50 -> 310 (width 260)
                    // Qty: 320 -> 360 (width 40)
                    // Price: 370 -> 450 (width 80)
                    // Total: 460 -> 545 (width 85)

                    const colDesc = 50;
                    const colQty = 320;
                    const colPrice = 370;
                    const colTotal = 460;

                    const colWDesc = 260;
                    const colWQty = 40;
                    const colWPrice = 80;
                    const colWTotal = 85;

                    // Header Section
                    let yPos = 50;

                    // Logo (Left)
                    if (settings.logoUrl && settings.logoUrl.startsWith('data:image')) {
                        try {
                            const base64Data = settings.logoUrl.split(',')[1];
                            const logoBuffer = Buffer.from(base64Data, 'base64');
                            doc.image(logoBuffer, 50, 35, { fit: [100, 70], valign: 'center' });
                        } catch (e) {
                            doc.font('Helvetica-Bold').fontSize(20).fillColor(blueColor).text(settings.name, margin, yPos);
                        }
                    } else {
                        doc.font('Helvetica-Bold').fontSize(24).fillColor(blueColor).text(settings.name, margin, yPos);
                    }

                    // Company Details (Right Aligned)
                    doc.font('Helvetica').fontSize(9).fillColor(grayColor);
                    const companyInfoX = 300;
                    const companyInfoWidth = rightEdge - companyInfoX;

                    if (hasValue(settings.address)) {
                        doc.text(settings.address, companyInfoX, yPos, { width: companyInfoWidth, align: 'right' });
                        yPos += doc.heightOfString(settings.address, { width: companyInfoWidth }) + 2;
                    } else {
                        yPos += 12;
                    }

                    if (hasValue(settings.phone)) {
                        doc.text(`Phone: ${settings.phone}`, companyInfoX, yPos, { width: companyInfoWidth, align: 'right' });
                        yPos += 12;
                    }
                    if (hasValue(settings.email)) {
                        doc.text(`Email: ${settings.email}`, companyInfoX, yPos, { width: companyInfoWidth, align: 'right' });
                        yPos += 12;
                    }
                    if (hasValue(settings.gstNumber)) {
                        doc.text(`GST: ${settings.gstNumber}`, companyInfoX, yPos, { width: companyInfoWidth, align: 'right' });
                        yPos += 12;
                    }

                    // Divider
                    yPos = Math.max(yPos, 110) + 15;
                    doc.rect(margin, yPos, contentWidth, 1).fill(blueColor);
                    yPos += 20;

                    // Invoice Info & Bill To
                    const sectionY = yPos;

                    // Left: Invoice Details
                    doc.font('Helvetica-Bold').fontSize(16).fillColor(blackColor).text('INVOICE', margin, sectionY);

                    let metaY = sectionY + 25;
                    doc.font('Helvetica').fontSize(10).fillColor(grayColor);

                    const drawMetaRow = (label: string, value: string) => {
                        doc.font('Helvetica').fillColor(grayColor).text(label, margin, metaY);
                        doc.font('Helvetica-Bold').fillColor(blackColor).text(value, margin + 65, metaY);
                        metaY += 15;
                    };

                    drawMetaRow('Invoice No:', invoiceData.invoiceNumber);
                    drawMetaRow('Date:', formatDate(invoiceData.date));

                    // Right: Bill To
                    const billToX = 350;
                    doc.font('Helvetica-Bold').fontSize(11).fillColor(blackColor).text('BILL TO', billToX, sectionY);

                    let billY = sectionY + 20;
                    doc.font('Helvetica').fontSize(10).fillColor(grayColor);
                    const billToWidth = rightEdge - billToX;

                    if (hasValue(invoiceData.customerName)) {
                        doc.text(invoiceData.customerName, billToX, billY, { width: billToWidth });
                        billY += 14;
                    }
                    if (hasValue(invoiceData.customerPhone)) {
                        doc.text(invoiceData.customerPhone, billToX, billY, { width: billToWidth });
                        billY += 14;
                    }
                    if (hasValue(invoiceData.customerEmail)) {
                        doc.text(invoiceData.customerEmail, billToX, billY, { width: billToWidth });
                        billY += 14;
                    }
                    if (hasValue(invoiceData.customerAddress)) {
                        doc.text(invoiceData.customerAddress, billToX, billY, { width: billToWidth });
                        // Adjust Y based on address height
                        billY += doc.heightOfString(invoiceData.customerAddress, { width: billToWidth }) + 5;
                    }

                    // Table Header
                    yPos = Math.max(metaY, billY) + 20;
                    const tableHeaderY = yPos;

                    doc.font('Helvetica-Bold').fontSize(10).fillColor(blueColor);
                    doc.text('Description', colDesc, tableHeaderY, { width: colWDesc });
                    doc.text('Qty', colQty, tableHeaderY, { width: colWQty, align: 'right' });
                    doc.text('Unit Price', colPrice, tableHeaderY, { width: colWPrice, align: 'right' });
                    doc.text('Total', colTotal, tableHeaderY, { width: colWTotal, align: 'right' });

                    doc.rect(margin, tableHeaderY + 15, contentWidth, 1).fill(blueColor);

                    // Items
                    let rowY = tableHeaderY + 25;
                    doc.font('Helvetica').fontSize(10).fillColor(blackColor);

                    invoiceData.items.forEach((item: any) => {
                        // Page Break Check
                        if (rowY > doc.page.height - 150) { // Leave space for footer/totals
                            doc.addPage();
                            rowY = 50;
                            // Redraw header on new page? (Optional, kept simple for now)
                        }

                        // Background for alternate rows (optional, kept clean white for now)
                        // if (index % 2 === 0) doc.rect(margin, rowY - 5, contentWidth, 20).fill('#f8fafc');

                        doc.text(item.description, colDesc, rowY, { width: colWDesc });
                        doc.text(item.quantity.toString(), colQty, rowY, { width: colWQty, align: 'right' });
                        doc.text(`Rs.${(item.price || 0).toFixed(2)}`, colPrice, rowY, { width: colWPrice, align: 'right' });
                        doc.font('Helvetica-Bold').text(`Rs.${(item.total || 0).toFixed(2)}`, colTotal, rowY, { width: colWTotal, align: 'right' });
                        doc.font('Helvetica'); // Reset font

                        // Calculate height of this row based on description wrapping
                        const descHeight = doc.heightOfString(item.description, { width: colWDesc });
                        const rowHeight = Math.max(descHeight, 15) + 10;
                        rowY += rowHeight;
                    });

                    doc.rect(margin, rowY, contentWidth, 0.5).fill('#e2e8f0');
                    rowY += 15;

                    // Totals Section (Right Aligned)
                    const totalsStartY = rowY;
                    let totalsY = totalsStartY;
                    const labelX = 340;
                    const valueX = colTotal; // Align with Total column
                    const valueW = colWTotal;

                    const drawTotalRow = (label: string, value: string, isBold: boolean = false, color: string = blackColor) => {
                        doc.font('Helvetica').fontSize(10).fillColor(grayColor).text(label, labelX, totalsY, { width: 100, align: 'right' });
                        doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color).text(value, valueX, totalsY, { width: valueW, align: 'right' });
                        totalsY += 18;
                    };

                    drawTotalRow('Subtotal:', `Rs.${(invoiceData.subtotal || 0).toFixed(2)}`);

                    if (invoiceData.discount > 0) {
                        drawTotalRow('Discount:', `-Rs.${invoiceData.discount.toFixed(2)}`, false, '#ef4444');
                    }
                    if (invoiceData.creditsUsed > 0) {
                        drawTotalRow('Credits Used:', `-${invoiceData.creditsUsed}`, false, '#7c3aed');
                    }
                    invoiceData.taxBreakdown.forEach((tax: any) => {
                        drawTotalRow(`${tax.fieldDisplayName}:`, `Rs.${tax.amount.toFixed(2)}`);
                    });

                    doc.rect(labelX + 20, totalsY + 5, 185, 1).fill(blueColor);
                    totalsY += 15;

                    // Grand Total
                    doc.font('Helvetica-Bold').fontSize(12).fillColor(blueColor);
                    doc.text('GRAND TOTAL:', labelX, totalsY, { width: 100, align: 'right' });
                    doc.text(`Rs.${(invoiceData.total || 0).toFixed(2)}`, valueX, totalsY, { width: valueW, align: 'right' });
                    totalsY += 25;

                    // Payment Information (Bottom Left, relative to Totals)
                    // If plenty of space, put it alongside. If not, put it below.
                    // Let's put it below to be safe but keep it compact.

                    const paymentY = totalsY + 10;

                    // Check if we need to push to next page (rare given compaction)
                    if (paymentY > doc.page.height - 100) {
                        doc.addPage();
                        // Reset Y if needed, but for simple footer we just use bottom coordinates
                    }

                    doc.rect(margin, paymentY, contentWidth, 0.5).fill('#e2e8f0');

                    let payInfoY = paymentY + 15; // Initialize payInfoY here

                    // Inline Payment Information with Status Badge
                    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e293b').text('Payment Information:', margin, payInfoY, { continued: true });

                    const paymentStatus = invoiceData.paymentStatus.toUpperCase();
                    const statusColor = paymentStatus === 'PAID' || paymentStatus === 'COMPLETED' ? '#16a34a' : '#ea580c'; // Green or Orange

                    doc.fillColor(statusColor).text(`  ${paymentStatus}`);

                    payInfoY += 15;

                    doc.font('Helvetica').fontSize(9).fillColor(grayColor); // Smaller font

                    // Display payment details in a single line
                    let paymentInfoText = `Mode: ${invoiceData.paymentMethod}`;
                    if (hasValue(invoiceData.paymentId)) {
                        paymentInfoText += `  |  ID: ${invoiceData.paymentId}`;
                    }

                    doc.text(paymentInfoText, margin, payInfoY);

                    // Disclaimer Footer (Fixed at bottom)
                    const bottomY = doc.page.height - 100;
                    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
                        .text('This is a computer generated invoice and does not require a signature.', margin, bottomY, { width: contentWidth, align: 'center' });

                    doc.end();
                } catch (err) {
                    reject(err);
                }
            });
        };

        const pdfBuffer = await generateBuffer();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', pdfBuffer.length);
        res.setHeader('Content-Disposition', `attachment; filename=Invoice_${invoiceData.invoiceNumber}.pdf`);
        res.send(pdfBuffer);

    } catch (error: any) {
        console.error('Invoice generation error:', error);
        return next(new AppError('Failed to generate invoice', 500));
    }
});
