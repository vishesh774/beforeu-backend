
import dotenv from 'dotenv';
// Load env before anything else
dotenv.config();

import { sendDailyBusinessReport } from './services/whatsappService';

const run = async () => {
    console.log('--- Triggering Manual Daily Report Test ---');

    // Sample Data
    const dateStr = "16 Jan, 2026";
    const newPlans = 5;
    const newBookings = 12;
    const revenue = "15000";

    console.log(`Sending report for ${dateStr}...`);

    try {
        await sendDailyBusinessReport(dateStr, newPlans, newBookings, revenue);
        console.log('--- Done ---');
    } catch (error) {
        console.error('Error triggering report:', error);
    }

    process.exit(0);
};

run();
