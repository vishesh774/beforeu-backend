import axios from 'axios';

// WhatsApp Configuration
const getWhatsappConfig = () => ({
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    apiUrl: process.env.WHATSAPP_API_URL || 'https://crmapi.automatebusiness.com/api/meta',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v19.0',
    wabaId: process.env.WHATSAPP_WABA_ID || '847446004815640',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '968158453040132',
    businessId: process.env.WHATSAPP_BUSINESS_ID || '1375880834314713'
});

/**
 * Helper: Format phone number to E.164 format with preference for Indian numbers
 */
const formatPhoneNumber = (phone: string): string => {
    let formattedPhone = phone.replace(/\D/g, ''); // Remove non-digits

    // If 10 digits, assume India and prepend +91
    if (formattedPhone.length === 10) {
        formattedPhone = '91' + formattedPhone;
    } else if (formattedPhone.length === 12 && formattedPhone.startsWith('91')) {
        // If 12 digits starting with 91, prepend +
        formattedPhone = '91' + formattedPhone;
    } else {
        // Otherwise just ensure it has a + if it doesn't (though we stripped it above, so we just prepend +)
        formattedPhone = formattedPhone;
    }
    return formattedPhone;
};

/**
 * Helper: Generic function to send a WhatsApp Template Message
 */
export const sendWhatsAppTemplate = async (
    to: string,
    templateName: string,
    components: any[] = [],
    languageCode: string = 'en_US'
): Promise<boolean> => {
    try {
        const config = getWhatsappConfig();
        const formattedPhone = formatPhoneNumber(to);
        const url = `${config.apiUrl}/${config.apiVersion}/${config.phoneNumberId}/messages`;

        console.log(`[WhatsApp] Configuration: URL=${config.apiUrl}, PhoneID=${config.phoneNumberId}, Token=${config.accessToken ? 'SET' : 'MISSING'}`);
        console.log(`[WhatsApp] Sending template "${templateName}" to ${formattedPhone}...`);

        const payload = {
            messaging_product: 'whatsapp',
            to: formattedPhone,
            recipient_type: 'individual',
            type: 'template',
            template: {
                language: {
                    policy: 'deterministic',
                    code: languageCode
                },
                name: templateName,
                components: components
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${config.accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 200 || response.status === 201) {
            console.log('[WhatsApp] Full Response Data:', JSON.stringify(response.data, null, 2));
            console.log(`[WhatsApp] Message sent successfully. Message ID: ${response.data.messages?.[0]?.id}`);
            return true;
        } else {
            console.error(`[WhatsApp] Failed to send message. Status: ${response.status}`, response.data);
            return false;
        }
    } catch (error: any) {
        console.error(`[WhatsApp] Error sending template "${templateName}":`, error.response?.data || error.message);
        return false;
    }
};

/**
 * Send a WhatsApp Welcome Message to a new user
 */
export const sendWelcomeMessage = async (phone: string, userName: string): Promise<boolean> => {
    // Template 'user_signup' usually doesn't take parameters based on previous request, 
    // but if it does, they would go in components.
    console.log(`[WhatsApp] Sending welcome message to: ${userName}`);
    return sendWhatsAppTemplate(phone, 'user_signup', [], 'en_US');
};

export interface PlanPurchaseParams {
    phone: string;
    userName: string;
    planName: string;
    membersCount: number;
    validity: number;
    sosCount: string | number;
    homeRepairCount: string | number;
    advisoryCount: string | number;
}

/**
 * Send a WhatsApp Plan Purchase Confirmation (plan_purchase template)
 */
export const sendPlanPurchaseMessage = async (params: PlanPurchaseParams): Promise<boolean> => {
    const { phone, userName, planName, membersCount, validity, sosCount, homeRepairCount, advisoryCount } = params;

    const components = [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: userName },
                { type: 'text', text: planName },
                { type: 'text', text: String(membersCount) },
                { type: 'text', text: String(validity) },
                { type: 'text', text: String(sosCount) },
                { type: 'text', text: String(homeRepairCount) },
                { type: 'text', text: String(advisoryCount) }
            ]
        }
    ];

    return sendWhatsAppTemplate(phone, 'plan_purchase', components, 'en');
};

/**
 * Send a WhatsApp Message prompting user to add family members (add_family_member template)
 */
export const sendAddFamilyMemberMessage = async (phone: string, userName: string): Promise<boolean> => {
    console.log(`[WhatsApp] Sending add family member prompt to: ${userName}`);
    return sendWhatsAppTemplate(phone, 'add_family_member', [], 'en');
};

/**
 * Send a WhatsApp Message informing a user they have been added to a family plan (added_as_family template)
 */
export const sendAddedAsFamilyMessage = async (phone: string, userName: string, referrerName: string): Promise<boolean> => {
    const components = [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: userName },
                { type: 'text', text: referrerName }
            ]
        }
    ];

    console.log(`[WhatsApp] Sending added as family notification to: ${userName}`);
    return sendWhatsAppTemplate(phone, 'added_as_family', components, 'en');
};

/**
 * Send internal notification to admin list about a new plan purchase (plan_purchased template)
 */
export const sendInternalPlanPurchaseNotification = async (
    customerName: string,
    customerPhone: string,
    planName: string,
    amountPaid: number | string
): Promise<void> => {
    // Get list from env, split by comma
    const notifyList = (process.env.WHATSAPP_ADMIN_NOTIFY_LIST || '').split(',').map(n => n.trim()).filter(n => n);

    if (notifyList.length === 0) {
        console.log('[WhatsApp] No admin/internal numbers configured for notifications.');
        return;
    }

    console.log(`[WhatsApp] Sending new purchase alert to ${notifyList.length} admins...`);

    const components = [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: customerName },
                { type: 'text', text: customerPhone },
                { type: 'text', text: planName },
                { type: 'text', text: String(amountPaid) }
            ]
        }
    ];

    // Send to all in parallel
    await Promise.all(notifyList.map(phone =>
        sendWhatsAppTemplate(phone, 'plan_purchased', components, 'en')
            .catch(err => console.error(`[WhatsApp] Failed to notify admin ${phone}:`, err))
    ));
};

/**
 * Send daily business report to admins (total_daily_business template)
 */
export const sendDailyBusinessReport = async (
    dateStr: string,
    newPlansSold: number,
    newBookings: number,
    totalRevenue: number | string
): Promise<void> => {
    // Get list from env, split by comma
    const notifyList = (process.env.WHATSAPP_ADMIN_NOTIFY_LIST || '').split(',').map(n => n.trim()).filter(n => n);

    if (notifyList.length === 0) {
        console.log('[WhatsApp] No admin numbers configured for daily report.');
        return;
    }

    console.log(`[WhatsApp] Sending daily report to ${notifyList.length} admins...`);

    const components = [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: dateStr },
                { type: 'text', text: String(newPlansSold) },
                { type: 'text', text: String(newBookings) },
                { type: 'text', text: String(totalRevenue) }
            ]
        }
    ];

    await Promise.all(notifyList.map(phone =>
        sendWhatsAppTemplate(phone, 'total_daily_business', components, 'en')
            .catch(err => console.error(`[WhatsApp] Failed to send report to admin ${phone}:`, err))
    ));
};
