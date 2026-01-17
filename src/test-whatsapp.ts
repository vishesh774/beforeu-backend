import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { sendWelcomeMessage } from './services/whatsappService';

const phone = '8197744060';
const name = 'Test User';

console.log(`Sending test WhatsApp message to ${phone}...`);
console.log('Environment Check:');
console.log('WHATSAPP_ACCESS_TOKEN:', process.env.WHATSAPP_ACCESS_TOKEN ? '***PRESENT***' : 'MISSING');
console.log('WHATSAPP_API_URL:', process.env.WHATSAPP_API_URL);

sendWelcomeMessage(phone, name)
    .then((success) => {
        console.log('Test execution completed. Success:', success);
        process.exit(success ? 0 : 1);
    })
    .catch((err) => {
        console.error('Test execution failed:', err);
        process.exit(1);
    });
