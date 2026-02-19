/**
 * Migration script to add invoice numbers to past plan purchases and bookings.
 * Only processes bookings with paid money (totalAmount > 0) and completed plan transactions.
 * Run with: npx ts-node src/scripts/migrateInvoiceNumbers.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from '../models/Booking';
import PlanTransaction from '../models/PlanTransaction';
import InvoiceCounter from '../models/InvoiceCounter';
import { generateNextInvoiceNumber } from '../utils/invoiceUtils';
import connectDB from '../config/database';

// Load environment variables
dotenv.config();

const migrateInvoices = async () => {
    try {
        // Connect to database
        await connectDB();

        console.log('🔄 Starting invoice number migration...\n');

        // 1. Clear existing counters to ensure we start from BUC/YY-YY/001 for each financial year
        // Only do this if we are re-generating everything. Since we verified 0 existing invoices, this is safe.
        await InvoiceCounter.deleteMany({});
        console.log('🗑️  Cleared existing invoice counters.\n');

        // 2. Fetch all completed PlanTransactions without invoice numbers
        const transactions = await PlanTransaction.find({
            status: 'completed',
            $or: [
                { invoiceNumber: { $exists: false } },
                { invoiceNumber: '' },
                { invoiceNumber: null }
            ]
        }).sort({ createdAt: 1 });

        console.log(`📋 Found ${transactions.length} completed plan transactions to process.`);

        // 3. Fetch all paid Bookings without invoice numbers
        const bookings = await Booking.find({
            totalAmount: { $gt: 0 },
            $or: [
                { invoiceNumber: { $exists: false } },
                { invoiceNumber: '' },
                { invoiceNumber: null }
            ]
        }).sort({ createdAt: 1 });

        console.log(`📋 Found ${bookings.length} paid bookings to process.`);

        // 4. Combine and sort all records by createdAt to maintain strict chronological order
        const allRecords = [
            ...transactions.map(t => ({ type: 'plan', doc: t, date: t.createdAt })),
            ...bookings.map(b => ({ type: 'booking', doc: b, date: b.createdAt }))
        ].sort((a, b) => a.date.getTime() - b.date.getTime());

        console.log(`🚀 Total records to migrate: ${allRecords.length}\n`);

        let processedCount = 0;

        for (const item of allRecords) {
            const invoiceNumber = await generateNextInvoiceNumber(item.date);

            if (item.type === 'plan') {
                await PlanTransaction.updateOne(
                    { _id: item.doc._id },
                    { $set: { invoiceNumber } }
                );
            } else {
                await Booking.updateOne(
                    { _id: item.doc._id },
                    { $set: { invoiceNumber } }
                );
            }

            processedCount++;
            if (processedCount % 10 === 0 || processedCount === allRecords.length) {
                console.log(`✅ Processed ${processedCount}/${allRecords.length} records...`);
            }
        }

        await mongoose.connection.close();
        console.log('\n✨ Migration completed successfully!');
        console.log(`🏁 Total invoices generated: ${processedCount}`);
        process.exit(0);
    } catch (error: any) {
        console.error('❌ Error during invoice migration:', error.message);
        console.error(error);
        await mongoose.connection.close();
        process.exit(1);
    }
};

// Run the migration
migrateInvoices();
