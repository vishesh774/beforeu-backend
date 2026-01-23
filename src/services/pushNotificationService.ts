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
    const { pushToken, title, body, data, sound = 'default', channelId, priority } = params;

    console.log(`[PushNotification] Attempting to send: "${title}" to token: ${pushToken.substring(0, 15)}... Type: ${data?.type || 'N/A'}`);

    if (!Expo.isExpoPushToken(pushToken)) {
        console.error(`[PushNotification] Invalid Expo push token: ${pushToken}`);
        return;
    }

    const message: ExpoPushMessage = {
        to: pushToken,
        sound: sound,
        title: title,
        body: body,
        data: {
            ...data,
            _displayInForeground: true, // Hint to show even if app is foregrounded without handler
        },
        channelId: channelId,
        priority: priority === 'high' ? 'high' : 'default',
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
                console.log(`[PushNotification] Notification "${title}" sent successfully. Ticket ID: ${ticket.id}`);
            }
        }
    } catch (error) {
        console.error('[PushNotification] Error sending push notification:', error);
    }
};
