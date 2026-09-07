import nodemailer from 'nodemailer';
import { Attachment } from 'nodemailer/lib/mailer';

// Email Configuration
const getEmailConfig = () => ({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '', // Brevo SMTP Key
    },
    fromName: process.env.SMTP_FROM_NAME || 'BeforeU System',
    fromEmail: process.env.SMTP_FROM_EMAIL || 'noreply@beforeu.in',
    accountsTeamEmails: process.env.ACCOUNTS_TEAM_EMAILS || '',
    operationsTeamEmails: process.env.OPERATIONS_TEAM_EMAILS || '',
});

const parseEmailList = (raw: string): string[] =>
    raw.split(',').map(e => e.trim()).filter(e => e.length > 0);

/**
 * Everyone who should receive a copy of a completed sale (plan or service booking).
 * Accounts + operations, de-duplicated. Configured via ACCOUNTS_TEAM_EMAILS and
 * OPERATIONS_TEAM_EMAILS, both comma-separated.
 */
export const getSalesTeamRecipients = (): string[] => {
    const config = getEmailConfig();
    return [...new Set([
        ...parseEmailList(config.accountsTeamEmails),
        ...parseEmailList(config.operationsTeamEmails)
    ])];
};

export const sendEmail = async (options: {
    to: string | string[];
    subject: string;
    html: string;
    attachments?: Attachment[];
}) => {
    try {
        const config = getEmailConfig();

        if (!config.auth.user || !config.auth.pass) {
            console.warn('[EmailService] SMTP credentials missing. Skipping email send.');
            return false;
        }

        const transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: config.auth,
        });

        const mailOptions = {
            from: `"${config.fromName}" <${config.fromEmail}>`,
            to: Array.isArray(options.to) ? options.to.join(',') : options.to,
            subject: options.subject,
            html: options.html,
            attachments: options.attachments,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('[EmailService] Email sent successfully via Brevo: %s', info.messageId);
        return true;
    } catch (error) {
        console.error('[EmailService] Error sending email via Brevo:', error);
        return false;
    }
};

export const notifyAccountsTeamOnPlanPurchase = async (data: {
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    planName: string;
    amount: number;
    invoiceNumber: string;
    purchaseDate: Date;
    pdfBuffer: Buffer;
}) => {
    const accountsEmails = getSalesTeamRecipients();

    if (accountsEmails.length === 0) {
        console.warn('[EmailService] No sales team emails configured (ACCOUNTS_TEAM_EMAILS / OPERATIONS_TEAM_EMAILS).');
        return;
    }

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f1f5f9; margin: 0; padding: 40px 0; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 32px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.025em; }
        .content { padding: 32px; }
        .intro { margin-bottom: 24px; }
        .intro p { margin: 0; font-size: 16px; color: #475569; }
        .section { background: #f8fafc; border-radius: 8px; padding: 20px; border: 1px solid #f1f5f9; margin-bottom: 24px; }
        .section-title { font-size: 14px; font-weight: 700; color: #2563eb; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
        .info-grid { width: 100%; border-collapse: collapse; }
        .info-row td { padding: 8px 0; font-size: 14px; }
        .info-label { color: #64748b; width: 120px; font-weight: 500; }
        .info-value { color: #0f172a; font-weight: 600; }
        .amount-highlight { font-size: 18px; color: #2563eb; font-weight: 700; }
        .footer { padding: 24px; text-align: center; background: #f8fafc; border-top: 1px solid #e2e8f0; }
        .footer p { margin: 0; font-size: 12px; color: #94a3b8; }
        .attachment-note { display: flex; align-items: center; justify-content: center; margin-top: 16px; color: #64748b; font-size: 13px; font-style: italic; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>New Plan Purchase</h1>
        </div>
        <div class="content">
            <div class="intro">
                <p>Hello Accounts Team,</p>
                <p style="margin-top: 8px;">A new subscription plan has been successfully activated. Details of the transaction are provided below.</p>
            </div>

            <div class="section">
                <div class="section-title">Plan Details</div>
                <table class="info-grid">
                    <tr class="info-row">
                        <td class="info-label">Plan Name</td>
                        <td class="info-value">${data.planName}</td>
                    </tr>
                    <tr class="info-row">
                        <td class="info-label">Invoice No</td>
                        <td class="info-value">${data.invoiceNumber}</td>
                    </tr>
                    <tr class="info-row">
                        <td class="info-label">Amount Paid</td>
                        <td class="info-value amount-highlight">Rs. ${data.amount.toFixed(2)}</td>
                    </tr>
                    <tr class="info-row">
                        <td class="info-label">Date</td>
                        <td class="info-value">${data.purchaseDate.toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}</td>
                    </tr>
                </table>
            </div>

            <div class="section">
                <div class="section-title">Customer Information</div>
                <table class="info-grid">
                    <tr class="info-row">
                        <td class="info-label">Name</td>
                        <td class="info-value">${data.customerName}</td>
                    </tr>
                    <tr class="info-row">
                        <td class="info-label">Phone</td>
                        <td class="info-value">${data.customerPhone}</td>
                    </tr>
                    <tr class="info-row">
                        <td class="info-label">Email</td>
                        <td class="info-value">${data.customerEmail}</td>
                    </tr>
                </table>
            </div>

            <p style="font-size: 14px; color: #475569; text-align: center;">The PDF invoice has been generated and is attached to this email.</p>
        </div>
        <div class="footer">
            <p>&copy; ${new Date().getFullYear()} BeforeU System. All rights reserved.</p>
            <p style="margin-top: 4px;">Automated Financial Notification</p>
        </div>
    </div>
</body>
</html>
    `;

    await sendEmail({
        to: accountsEmails,
        subject: `[Plan Purchase] ${data.invoiceNumber} - ${data.customerName}`,
        html,
        attachments: [
            {
                filename: `Invoice-${data.invoiceNumber}.pdf`,
                content: data.pdfBuffer,
            }
        ]
    });
};

/**
 * Copy of a service-booking sales invoice to the accounts + operations teams.
 *
 * Plan purchases already had this via notifyAccountsTeamOnPlanPurchase(); service bookings had no
 * equivalent — their invoices were download-only from the dashboard. Generic across every service
 * type: the line items come straight off the booking's order items.
 */
export const notifyTeamOnBookingInvoice = async (data: {
    bookingRef: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    serviceSummary: string;
    amount: number;
    paymentMethod: string;
    invoiceNumber: string;
    bookingDate: Date;
    pdfBuffer: Buffer;
}) => {
    const recipients = getSalesTeamRecipients();

    if (recipients.length === 0) {
        console.warn('[EmailService] No sales team emails configured (ACCOUNTS_TEAM_EMAILS / OPERATIONS_TEAM_EMAILS).');
        return;
    }

    const formattedAmount = `₹${data.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const formattedDate = data.bookingDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f1f5f9; margin: 0; padding: 40px 0; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 32px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.025em; }
        .content { padding: 32px; }
        .section { background: #f8fafc; border-radius: 8px; padding: 20px; border: 1px solid #f1f5f9; margin-bottom: 24px; }
        .section-title { font-size: 14px; font-weight: 700; color: #2563eb; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
        .info-grid { width: 100%; border-collapse: collapse; }
        .info-row td { padding: 8px 0; font-size: 14px; }
        .info-label { color: #64748b; width: 40%; }
        .info-value { color: #1e293b; font-weight: 600; text-align: right; }
        .footer { background: #f8fafc; padding: 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><h1>Service Booking Invoice</h1></div>
        <div class="content">
            <div class="section">
                <div class="section-title">Booking</div>
                <table class="info-grid">
                    <tr class="info-row"><td class="info-label">Booking ID</td><td class="info-value">${data.bookingRef}</td></tr>
                    <tr class="info-row"><td class="info-label">Invoice No.</td><td class="info-value">${data.invoiceNumber}</td></tr>
                    <tr class="info-row"><td class="info-label">Service</td><td class="info-value">${data.serviceSummary}</td></tr>
                    <tr class="info-row"><td class="info-label">Amount</td><td class="info-value">${formattedAmount}</td></tr>
                    <tr class="info-row"><td class="info-label">Payment</td><td class="info-value">${data.paymentMethod}</td></tr>
                    <tr class="info-row"><td class="info-label">Date (IST)</td><td class="info-value">${formattedDate}</td></tr>
                </table>
            </div>
            <div class="section">
                <div class="section-title">Customer</div>
                <table class="info-grid">
                    <tr class="info-row"><td class="info-label">Name</td><td class="info-value">${data.customerName}</td></tr>
                    <tr class="info-row"><td class="info-label">Phone</td><td class="info-value">${data.customerPhone}</td></tr>
                    <tr class="info-row"><td class="info-label">Email</td><td class="info-value">${data.customerEmail}</td></tr>
                </table>
            </div>
            <p style="font-size: 14px; color: #475569; text-align: center;">The PDF invoice is attached to this email.</p>
        </div>
        <div class="footer">
            <p>&copy; ${new Date().getFullYear()} BeforeU System. All rights reserved.</p>
            <p style="margin-top: 4px;">Automated Financial Notification</p>
        </div>
    </div>
</body>
</html>
    `;

    await sendEmail({
        to: recipients,
        subject: `[Service Booking] ${data.invoiceNumber} - ${data.customerName}`,
        html,
        attachments: [
            {
                filename: `Invoice-${data.invoiceNumber}.pdf`,
                content: data.pdfBuffer,
            }
        ]
    });
};

export const sendOTPVerificationEmail = async (email: string, otp: string) => {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 0; }
        .wrapper { width: 100%; table-layout: fixed; background-color: #f8fafc; padding-bottom: 40px; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; margin-top: 40px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); padding: 40px 20px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.025em; }
        .content { padding: 40px; text-align: center; }
        .welcome-text { font-size: 18px; color: #475569; margin-bottom: 12px; font-weight: 500; }
        .instruction { font-size: 16px; color: #64748b; margin-bottom: 32px; }
        .otp-container { background-color: #f1f5f9; border-radius: 12px; padding: 24px; border: 2px dashed #cbd5e1; display: inline-block; margin-bottom: 32px; }
        .otp-code { font-size: 36px; font-weight: 800; color: #4f46e5; letter-spacing: 0.25em; font-family: 'Courier New', Courier, monospace; }
        .expiry-note { font-size: 14px; color: #94a3b8; margin-top: 8px; }
        .warning-box { background-color: #fff7ed; border-radius: 8px; padding: 16px; border: 1px solid #ffedd5; margin-bottom: 32px; text-align: left; }
        .warning-text { font-size: 13px; color: #9a3412; margin: 0; }
        .footer { padding: 32px; text-align: center; background-color: #f8fafc; border-top: 1px solid #e2e8f0; }
        .footer p { margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.5; }
        .logo-placeholder { font-weight: 900; color: #4f46e5; font-size: 20px; margin-bottom: 24px; display: block; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="container">
            <div class="header">
                <h1>Verify Your Email</h1>
            </div>
            <div class="content">
                <span class="logo-placeholder">BeforeU</span>
                <p class="welcome-text">Security Verification Code</p>
                <p class="instruction">To continue with your request, please use the following one-time password (OTP) to verify your email address.</p>
                
                <div class="otp-container">
                    <div class="otp-code">${otp}</div>
                    <div class="expiry-note">Valid for 10 minutes</div>
                </div>

                <div class="warning-box">
                    <p class="warning-text"><strong>Security Note:</strong> If you did not request this verification, please ignore this email and secure your account. Do not share this code with anyone.</p>
                </div>

                <p style="font-size: 14px; color: #64748b; margin-top: 40px;">Thank you for choosing <strong>BeforeU</strong>.</p>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    return await sendEmail({
        to: email,
        subject: `[BeforeU] Your Verification Code: ${otp}`,
        html
    });
};
