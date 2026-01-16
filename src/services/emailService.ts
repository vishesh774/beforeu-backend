import nodemailer from 'nodemailer';

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
    fromEmail: process.env.SMTP_FROM_EMAIL || 'system@beforeu.in',
    accountsTeamEmails: process.env.ACCOUNTS_TEAM_EMAILS || '',
});

export const sendEmail = async (options: {
    to: string | string[];
    subject: string;
    html: string;
    attachments?: any[];
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
    const config = getEmailConfig();
    const accountsEmails = config.accountsTeamEmails.split(',').map(e => e.trim()).filter(e => e);

    if (accountsEmails.length === 0) {
        console.warn('[EmailService] No accounts team emails configured in ACCOUNTS_TEAM_EMAILS.');
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
