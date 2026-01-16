import ScheduledNotification from '../models/ScheduledNotification';
import { sendWhatsAppTemplate, sendDailyBusinessReport } from './whatsappService';
import Booking from '../models/Booking';
import PlanTransaction from '../models/PlanTransaction';

/**
 * Schedule a WhatsApp notification
 */
export const scheduleWhatsAppMessage = async (
    phone: string,
    template: string,
    components: any[] = [],
    delayHours: number = 0,
    languageCode: string = 'en'
): Promise<void> => {
    try {
        const scheduledAt = new Date();
        scheduledAt.setHours(scheduledAt.getHours() + delayHours);

        await ScheduledNotification.create({
            type: 'whatsapp',
            template,
            payload: {
                phone,
                components,
                languageCode
            },
            scheduledAt,
            status: 'pending'
        });

        console.log(`[Scheduler] Message scheduled: ${template} for ${phone} at ${scheduledAt.toISOString()}`);
    } catch (error) {
        console.error('[Scheduler] Failed to schedule message:', error);
    }
};

/**
 * Check and send Daily Business Report (at 08:00 AM IST)
 */
const checkAndSendDailyReport = async () => {
    try {
        const now = new Date();

        // Convert to IST time string for date checking
        const istDateStr = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
        const istDate = new Date(istDateStr);
        const currentHour = istDate.getHours();

        // Run only if it's past 8 AM
        if (currentHour < 8) return;

        // Identifier for today's report
        const todayStr = istDate.toISOString().split('T')[0]; // YYYY-MM-DD
        const reportId = `daily_report_${todayStr}`;

        // Check if already sent
        const existing = await ScheduledNotification.findOne({ template: reportId });
        if (existing) return;

        console.log(`[Scheduler] Generating Daily Report for ${todayStr}...`);

        // Calculate stats for Yesterday
        // "Yesterday" relative to the current IST date
        const yesterday = new Date(istDate);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0); // Start of yesterday

        const yesterdayEnd = new Date(yesterday);
        yesterdayEnd.setHours(23, 59, 59, 999); // End of yesterday

        const endOfYest = new Date();
        endOfYest.setUTCHours(18, 30, 0, 0); // Previous midnight IST (approx today 00:00 IST)
        if (endOfYest > now) endOfYest.setDate(endOfYest.getDate() - 1); // Ensure it's in past

        const startOfYest = new Date(endOfYest);
        startOfYest.setDate(startOfYest.getDate() - 1); // 24h before

        // Aggregate Plans
        const newPlans = await PlanTransaction.countDocuments({
            createdAt: { $gte: startOfYest, $lt: endOfYest },
            status: 'completed'
        });

        // Aggregate Bookings (exclude PLAN_PURCHASE)
        const newBookings = await Booking.countDocuments({
            createdAt: { $gte: startOfYest, $lt: endOfYest },
            bookingType: { $ne: 'PLAN_PURCHASE' }
        });

        // Revenue (from Plans)
        const revenueAgg = await PlanTransaction.aggregate([
            {
                $match: {
                    createdAt: { $gte: startOfYest, $lt: endOfYest },
                    status: 'completed'
                }
            },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const totalRevenue = revenueAgg[0]?.total || 0;

        const businessDate = new Date();
        businessDate.setDate(businessDate.getDate() - 1);
        const yString = businessDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

        // Send Report
        await sendDailyBusinessReport(
            yString,
            newPlans,
            newBookings,
            totalRevenue
        );

        // Mark as sent
        await ScheduledNotification.create({
            type: 'system_daily_report',
            template: reportId,
            payload: {},
            scheduledAt: now,
            status: 'sent'
        });

    } catch (err) {
        console.error('[Scheduler] Error checking daily report:', err);
    }
};

/**
 * Process pending scheduled notifications
 * This function should be called periodically (e.g., via cron or interval)
 */
export const processScheduledNotifications = async () => {
    try {
        const now = new Date();

        // Find pending notifications due for sending
        const pending = await ScheduledNotification.find({
            status: 'pending',
            scheduledAt: { $lte: now }
        }).limit(50); // Process in batches

        if (pending.length > 0) {
            console.log(`[Scheduler] Processing ${pending.length} due notifications...`);

            for (const note of pending) {
                try {
                    let success = false;
                    if (note.type === 'whatsapp') {
                        const { phone, components, languageCode } = note.payload;
                        // Use helper directly
                        success = await sendWhatsAppTemplate(
                            phone,
                            note.template,
                            components || [],
                            languageCode || 'en'
                        );
                    } else if (note.type === 'system_daily_report') {
                        success = true;
                    }

                    if (success) {
                        note.status = 'sent';
                        await note.save();
                        console.log(`[Scheduler] Sent notification ${note._id}`);
                    } else {
                        note.status = 'failed';
                        note.errorMessage = 'Send function returned false';
                        await note.save();
                        console.error(`[Scheduler] Failed to send notification ${note._id}`);
                    }
                } catch (err: any) {
                    note.status = 'failed';
                    note.errorMessage = err.message;
                    await note.save();
                    console.error(`[Scheduler] Error processing notification ${note._id}:`, err);
                }
            }
        }
    } catch (error) {
        console.error('[Scheduler] Error in processScheduledNotifications:', error);
    }

    // Check for Daily Report
    await checkAndSendDailyReport();
};

/**
 * Initialize the scheduler interval
 */
export const initScheduler = () => {
    console.log('[Scheduler] Initializing background job...');
    // Run every 2 hours
    setInterval(processScheduledNotifications, 2 * 60 * 60 * 1000);

    // Also run immediately on startup to catch missed ones
    processScheduledNotifications(); // Run asynchronously
};
