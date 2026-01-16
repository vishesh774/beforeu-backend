import axios from 'axios';

// WhatsApp Configuration
const WHATSAPP_CONFIG = {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    apiUrl: process.env.WHATSAPP_API_URL || 'https://crmapi.automatebusiness.com/api/meta',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v19.0',
    wabaId: process.env.WHATSAPP_WABA_ID || '847446004815640',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '968158453040132',
    businessId: process.env.WHATSAPP_BUSINESS_ID || '1375880834314713'
};

/**
 * Send a WhatsApp Welcome Message to a new user
 * @param phone User's phone number (with country code, e.g., 919876543210)
 * @param userName User's name
 */
export const sendWelcomeMessage = async (phone: string, userName: string): Promise<boolean> => {
    try {
        // Ensure phone number has no special characters or plus sign
        const formattedPhone = phone.replace(/\D/g, '');

        // Construct the API URL for sending messages
        const url = `${WHATSAPP_CONFIG.apiUrl}/${WHATSAPP_CONFIG.apiVersion}/${WHATSAPP_CONFIG.phoneNumberId}/messages`;

        // Welcome Template Name
        // Using 'hello_world' as a default test template. 
        // To send a personalized welcome (e.g., "Hi John"), you need to create a template in WhatsApp Manager
        // with a variable (e.g., "Hi {{1}}") and then uncomment the components section below.
        const templateName = 'hello_world';
        const languageCode = 'en_US';

        console.log(`[WhatsApp] Preparing to send welcome message to ${userName} (${formattedPhone})...`);

        const payload = {
            messaging_product: 'whatsapp',
            to: formattedPhone,
            recipient_type: 'individual',
            type: 'template',
            template: {
                name: templateName,
                language: {
                    policy: 'deterministic',
                    code: languageCode
                },
                // Example of passing components for a template with variables:
                /*
                components: [
                  {
                    type: 'body',
                    parameters: [
                      {
                        type: 'text',
                        text: userName
                      }
                    ]
                  }
                ]
                */
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_CONFIG.accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 200 || response.status === 201) {
            console.log(`[WhatsApp] Welcome message sent successfully. Message ID: ${response.data.messages?.[0]?.id}`);
            return true;
        } else {
            console.error(`[WhatsApp] Failed to send message. Status: ${response.status}`, response.data);
            return false;
        }

    } catch (error: any) {
        console.error('[WhatsApp] Error sending welcome message:', error.response?.data || error.message);
        return false;
    }
};
