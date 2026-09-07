/**
 * Push delivery for the **customer** app.
 *
 * The customer app registers through `expo-notifications`, so it holds an Expo push token
 * (`ExponentPushToken[...]`), which must go to Expo's push service. It is NOT an FCM token and
 * cannot be sent through firebase-admin — that path (`pushNotificationService.ts`) is for the
 * partner app, which holds raw FCM tokens.
 *
 * Degrades quietly like the other integrations: logs and returns a count rather than throwing, so
 * a push failure can never break an emergency flow.
 */

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Expo accepts at most 100 messages per request. */
const EXPO_BATCH_SIZE = 100;

export interface ExpoPushMessage {
    to: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    /** 'high' wakes the device promptly — use it for SOS, not for marketing. */
    priority?: 'default' | 'high';
    sound?: 'default' | null;
    channelId?: string;
}

export const isExpoPushToken = (token?: string | null): boolean =>
    !!token && (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['));

/**
 * Send a batch of push messages. Returns how many Expo accepted.
 * Invalid tokens are dropped before sending rather than failing the whole batch.
 */
export const sendExpoPushNotifications = async (
    messages: ExpoPushMessage[]
): Promise<{ sent: number; failed: number }> => {
    const valid = messages.filter(m => isExpoPushToken(m.to));
    const invalid = messages.length - valid.length;

    if (invalid > 0) {
        console.warn(`[ExpoPush] Skipping ${invalid} message(s) with a non-Expo token`);
    }

    if (valid.length === 0) {
        return { sent: 0, failed: invalid };
    }

    let sent = 0;
    let failed = invalid;

    for (let i = 0; i < valid.length; i += EXPO_BATCH_SIZE) {
        const batch = valid.slice(i, i + EXPO_BATCH_SIZE);

        try {
            const response = await fetch(EXPO_PUSH_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Accept-Encoding': 'gzip, deflate'
                },
                body: JSON.stringify(batch)
            });

            if (!response.ok) {
                console.error(`[ExpoPush] HTTP ${response.status} from Expo`);
                failed += batch.length;
                continue;
            }

            const payload = await response.json() as { data?: Array<{ status: string; message?: string }> };
            const tickets = payload.data || [];

            tickets.forEach(ticket => {
                if (ticket.status === 'ok') {
                    sent++;
                } else {
                    failed++;
                    console.warn(`[ExpoPush] Ticket error: ${ticket.message || 'unknown'}`);
                }
            });

            // A malformed response shouldn't silently under-count.
            if (tickets.length === 0) {
                failed += batch.length;
            }
        } catch (error) {
            console.error('[ExpoPush] Send failed:', error);
            failed += batch.length;
        }
    }

    return { sent, failed };
};

/**
 * High-priority SOS alert to a customer's family members.
 */
export const sendSOSPushToFamily = async (
    tokens: string[],
    params: { senderName: string; emergencyType: string; location: string; sosId: string }
): Promise<{ sent: number; failed: number }> => {
    const messages: ExpoPushMessage[] = tokens.map(token => ({
        to: token,
        title: '🚨 Emergency Alert',
        body: `${params.senderName} has raised an SOS (${params.emergencyType}) at ${params.location}`,
        data: {
            type: 'SOS_FAMILY_ALERT',
            sosId: params.sosId,
            emergencyType: params.emergencyType
        },
        priority: 'high',
        sound: 'default',
        channelId: 'sos-alerts'
    }));

    return sendExpoPushNotifications(messages);
};
