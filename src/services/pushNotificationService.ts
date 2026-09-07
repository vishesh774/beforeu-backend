/**
 * Push Notification Service — FCM delivery to the **partner** app.
 *
 * (The customer app uses Expo push tokens and goes through `expoPushService.ts`; the two are not
 * interchangeable.)
 *
 * Every message here is **data-only** — deliberately no `notification` block. A message containing
 * a `notification` block is handed to the Android system tray and the app's own code never runs
 * when it is backgrounded, which makes a custom full-screen alarm impossible. Data-only hands the
 * message to the app's background handler instead, so it can raise the alarm UI itself.
 *
 * The corollary: a data-only message MUST be sent at `priority: 'high'`, or Doze defers it and the
 * partner sees it whenever the device next wakes — useless for dispatch. Both senders below use
 * high priority for that reason.
 *
 * This only works if the partner app registers a background message handler at module scope in its
 * `index.ts`. Without that, everything here is delivered and silently discarded.
 */

import * as admin from 'firebase-admin';
import ServicePartner from '../models/ServicePartner';

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

function initializeFirebase(): boolean {
    if (firebaseInitialized) return true;

    try {
        // Load credentials from environment variables (recommended for production)
        const projectId = process.env.FIREBASE_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;

        if (!projectId || !clientEmail || !privateKey) {
            console.error('[Firebase] Missing credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env');
            return false;
        }

        admin.initializeApp({
            credential: admin.credential.cert({
                projectId,
                clientEmail,
                // Handle escaped newlines in environment variable
                privateKey: privateKey.replace(/\\n/g, '\n')
            })
        });

        console.log('[Firebase] Initialized with environment variables');
        firebaseInitialized = true;
        return true;
    } catch (error) {
        console.error('[Firebase] Failed to initialize:', error);
        return false;
    }
}

// Notification channel IDs (must match Android app)
const CHANNELS = {
    SOS_ALERTS: 'sos_alerts',
    JOB_ASSIGNMENTS: 'job_assignments'
};

interface SOSNotificationData {
    sosId: string;
    bookingId: string;
    customerName: string;
    customerPhone: string;
    location: {
        address: string;
        latitude?: number;
        longitude?: number;
    };
    emergencyType?: string;
}

interface JobNotificationData {
    bookingId: string;
    serviceName: string;
    variantName: string;
    customerName: string;
    scheduledDate?: string;
    scheduledTime?: string;
    address: string;
}

/**
 * Send SOS alert notification to a service partner
 * Uses BOTH notification + data payloads to ensure delivery in killed state
 * High priority, custom sound, bypasses doze mode
 */
export async function sendSosNotification(
    partnerId: string,
    data: SOSNotificationData
): Promise<boolean> {
    if (!initializeFirebase()) {
        console.error('[Push] Firebase not initialized, cannot send SOS notification');
        return false;
    }

    try {
        // Get partner's push token
        const partner = await ServicePartner.findById(partnerId);
        if (!partner || !partner.pushToken) {
            console.warn(`[Push] No push token for partner ${partnerId}`);
            return false;
        }

        const title = '🚨 SOS EMERGENCY ALERT';
        const body = `${data.customerName} needs immediate help at ${data.location.address}`;

        const message: admin.messaging.Message = {
            token: partner.pushToken,

            // DATA-ONLY payload (no 'notification' block)
            // This is the enterprise best practice for Notifee custom handlers.
            // It prevents double notifications while allowing the background 
            // process to wake up and show the custom blaring SOS UI.
            data: {
                type: 'SOS_ALERT',
                channelId: CHANNELS.SOS_ALERTS,
                sosId: data.sosId,
                uuid: data.sosId, // Matches ID expectation in index.ts
                bookingId: data.bookingId,
                customerName: data.customerName,
                customerPhone: data.customerPhone,
                address: data.location.address,
                latitude: data.location.latitude?.toString() || '',
                longitude: data.location.longitude?.toString() || '',
                emergencyType: data.emergencyType || 'EMERGENCY',
                title,
                body,
                sound: 'ambulance_alarm',
                priority: 'high',
                timestamp: Date.now().toString()
            },

            // Android-specific configuration
            android: {
                // High priority is CRITICAL to wake the app from doze/killed state
                priority: 'high',
                ttl: 60000, // 60 seconds TTL for SOS
                restrictedPackageName: 'com.beforeu.serviceprovider',
            }
        };

        const response = await admin.messaging().send(message);
        console.log(`[Push] SOS notification sent to ${partner.name}: ${response}`);
        return true;
    } catch (error: any) {
        console.error(`[Push] Failed to send SOS notification:`, error);

        // Handle invalid token - remove it
        if (error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token') {
            await ServicePartner.findByIdAndUpdate(partnerId, {
                $unset: { pushToken: 1, pushTokenUpdatedAt: 1 }
            });
            console.log(`[Push] Removed invalid token for partner ${partnerId}`);
        }

        return false;
    }
}

/**
 * Send job assignment notification to a service partner
 * Uses BOTH notification + data payloads for killed app delivery
 * Normal priority, standard notification
 */
export async function sendJobNotification(
    partnerId: string,
    data: JobNotificationData
): Promise<boolean> {
    if (!initializeFirebase()) {
        console.error('[Push] Firebase not initialized, cannot send job notification');
        return false;
    }

    try {
        // Get partner's push token
        const partner = await ServicePartner.findById(partnerId);
        if (!partner || !partner.pushToken) {
            console.warn(`[Push] No push token for partner ${partnerId}`);
            return false;
        }

        const scheduleInfo = data.scheduledDate && data.scheduledTime
            ? `Scheduled: ${data.scheduledDate} at ${data.scheduledTime}`
            : 'ASAP';

        const title = 'New Job Assigned';
        const body = `${data.variantName} for ${data.customerName}. ${scheduleInfo}`;

        const message: admin.messaging.Message = {
            token: partner.pushToken,

            // DATA-ONLY payload (no 'notification' block)
            // Consistent with the SOS approach: ensures Notifee has full control
            // and prevents duplicate notifications in the tray.
            data: {
                type: 'JOB_ASSIGNMENT',
                channelId: CHANNELS.JOB_ASSIGNMENTS,
                bookingId: data.bookingId,
                serviceName: data.serviceName,
                variantName: data.variantName,
                customerName: data.customerName,
                address: data.address,
                scheduledDate: data.scheduledDate || '',
                scheduledTime: data.scheduledTime || '',
                title,
                body,
                sound: 'default',
                // Read by the client to pick alarm vs standard treatment — distinct from the FCM
                // transport priority above, which is high for both so delivery is prompt.
                priority: 'normal',
                timestamp: Date.now().toString()
            },

            // Android-specific configuration
            android: {
                // High, not normal: this is a data-only message, and Doze defers normal-priority
                // data messages indefinitely. A job assignment the partner sees an hour late is a
                // missed job, so it qualifies as time-sensitive and user-visible.
                priority: 'high',
                ttl: 3600000, // 1 hour TTL for regular jobs
                restrictedPackageName: 'com.beforeu.serviceprovider',
            }
        };

        const response = await admin.messaging().send(message);
        console.log(`[Push] Job notification sent to ${partner.name}: ${response}`);
        return true;
    } catch (error: any) {
        console.error(`[Push] Failed to send job notification:`, error);

        // Handle invalid token - remove it
        if (error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token') {
            await ServicePartner.findByIdAndUpdate(partnerId, {
                $unset: { pushToken: 1, pushTokenUpdatedAt: 1 }
            });
            console.log(`[Push] Removed invalid token for partner ${partnerId}`);
        }

        return false;
    }
}

/**
 * Send notification to multiple partners (batch)
 */
export async function sendBatchNotification(
    partnerIds: string[],
    type: 'SOS' | 'JOB',
    data: SOSNotificationData | JobNotificationData
): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const partnerId of partnerIds) {
        const sent = type === 'SOS'
            ? await sendSosNotification(partnerId, data as SOSNotificationData)
            : await sendJobNotification(partnerId, data as JobNotificationData);

        if (sent) {
            success++;
        } else {
            failed++;
        }
    }

    return { success, failed };
}

export default {
    sendSosNotification,
    sendJobNotification,
    sendBatchNotification
};
