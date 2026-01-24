/**
 * Push Notification Service
 * Handles sending push notifications via Firebase Cloud Messaging (FCM)
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
 * High priority, full-screen intent, alarm sound
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

        const message: admin.messaging.Message = {
            token: partner.pushToken,
            // Data-only message for full control in killed state
            data: {
                type: 'SOS_ALERT',
                channelId: CHANNELS.SOS_ALERTS,
                sosId: data.sosId,
                bookingId: data.bookingId,
                customerName: data.customerName,
                customerPhone: data.customerPhone,
                address: data.location.address,
                latitude: data.location.latitude?.toString() || '',
                longitude: data.location.longitude?.toString() || '',
                emergencyType: data.emergencyType || 'EMERGENCY',
                title: '🚨 SOS EMERGENCY ALERT',
                body: `${data.customerName} needs immediate help at ${data.location.address}`,
                sound: 'ambulance_alarm',
                priority: 'high',
                fullScreen: 'true',
                timestamp: Date.now().toString()
            },
            android: {
                priority: 'high',
                ttl: 60000, // 60 seconds TTL for SOS
                directBootOk: true // Allow delivery in direct boot mode
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

        const message: admin.messaging.Message = {
            token: partner.pushToken,
            // Data-only message for consistency
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
                title: 'New Job Assigned',
                body: `${data.variantName} for ${data.customerName}. ${scheduleInfo}`,
                sound: 'default',
                priority: 'normal',
                timestamp: Date.now().toString()
            },
            android: {
                priority: 'normal',
                ttl: 3600000 // 1 hour TTL for regular jobs
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
        let sent = false;
        if (type === 'SOS') {
            sent = await sendSosNotification(partnerId, data as SOSNotificationData);
        } else {
            sent = await sendJobNotification(partnerId, data as JobNotificationData);
        }

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
