import { Expo, ExpoPushMessage } from 'expo-server-sdk';


const expo = new Expo();

export interface SendPushNotificationParams {
    pushToken: string;
    title: string;
    body: string;
    data?: Record<string, any>;
    sound?: 'default' | null;
    channelId?: string; // For Android
    priority?: 'default' | 'normal' | 'high'; // For Android
}

export const sendPushNotification = async (params: SendPushNotificationParams) => {
    const { pushToken, title, body, data, sound = 'default', channelId, priority } = params;

    if (!Expo.isExpoPushToken(pushToken)) {
        console.error(`[PushNotification] Invalid Expo push token: ${pushToken}`);
        return;
    }

    const message: ExpoPushMessage = {
        to: pushToken,
        sound: sound,
        title: title,
        body: body,
        data: data,
        channelId: channelId, // Required for Android loud ringing if channel configured on device
        priority: priority || 'normal',
    };

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
                console.log(`[PushNotification] Notification sent successfully: ${ticket.id}`);
            }
        }
    } catch (error) {
        console.error('[PushNotification] Error sending push notification:', error);
    }
};
