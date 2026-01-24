import { Expo, ExpoPushMessage } from 'expo-server-sdk';


const expo = new Expo();

export interface SendPushNotificationParams {
    pushToken: string;
    title: string;
    body: string;
    data?: Record<string, any>;
    sound?: string | null;
    channelId?: string; // For Android
    priority?: 'default' | 'normal' | 'high'; // For Android
}

export const sendPushNotification = async (params: SendPushNotificationParams) => {
    const { pushToken, title, body, data, sound = 'default', channelId } = params;

    console.log(`[PushNotification] Attempting to send: "${title}" to token: ${pushToken.substring(0, 15)}... Type: ${data?.type || 'N/A'}`);

    if (!Expo.isExpoPushToken(pushToken)) {
        console.error(`[PushNotification] Invalid Expo push token: ${pushToken}`);
        return;
    }

    const isSOS = data?.type === 'SOS_ASSIGNED';

    const message: ExpoPushMessage = {
        to: pushToken,
        data: {
            ...data,
            title: title, // Move title inside data
            body: body,   // Move body inside data
            _displayInForeground: true,
        },
        priority: 'high',
        mutableContent: true,
    };

    // ONLY for non-SOS, we send standard title/body to let OS handle it normally
    if (!isSOS) {
        message.title = title;
        message.body = body;
        message.sound = sound as any;
        message.channelId = channelId;
    } else {
        // For SOS, we want it to be data-only, but some versions of Expo might still need a hint
        // We do NOT set title/body here to ensure it's data-only on Android
    }

    try {
        const tickets = await expo.sendPushNotificationsAsync([message]);

        // Process tickets to check for errors
        for (const ticket of tickets) {
            if (ticket.status === 'error') {
                console.error(`[PushNotification] Error sending notification: ${ticket.message}`);
                if ((ticket as any).details && (ticket as any).details.error === 'DeviceNotRegistered') {
                    // Token is invalid, should ideally remove from DB
                    console.warn(`[PushNotification] Device not registered (token invalid): ${pushToken}`);
                }
            } else {
                console.log(`[PushNotification] Notification "${title}" sent successfully. Ticket ID: ${ticket.id}`);
            }
        }
    } catch (error) {
        console.error('[PushNotification] Error sending push notification:', error);
    }
};
