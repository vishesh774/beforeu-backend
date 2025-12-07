/**
 * Migration script to update all sequences to start from 1 instead of 0
 * Run with: npx ts-node src/scripts/migrateSequencesToStartFromOne.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import RefundCancellationPolicy from '../models/RefundCancellationPolicy';
import FAQ from '../models/FAQ';
import ServiceDefinitionsVisitRules from '../models/ServiceDefinitionsVisitRules';
import TermsAndConditions from '../models/TermsAndConditions';
import connectDB from '../config/database';

// Load environment variables
dotenv.config();

const migrateSequences = async () => {
  try {
    // Connect to database
    await connectDB();

    console.log('🔄 Migrating sequences to start from 1...\n');

    // Migrate RefundCancellationPolicy
    const policies = await RefundCancellationPolicy.find().sort({ sequence: 1, createdAt: 1 });
    for (let i = 0; i < policies.length; i++) {
      policies[i].sequence = i + 1;
      await policies[i].save();
    }
    console.log(`✅ Updated ${policies.length} RefundCancellationPolicy sequences`);

    // Migrate FAQs
    const faqs = await FAQ.find().sort({ sequence: 1, createdAt: 1 });
    for (let i = 0; i < faqs.length; i++) {
      faqs[i].sequence = i + 1;
      await faqs[i].save();
    }
    console.log(`✅ Updated ${faqs.length} FAQ sequences`);

    // Migrate ServiceDefinitionsVisitRules
    const rules = await ServiceDefinitionsVisitRules.find().sort({ sequence: 1, createdAt: 1 });
    for (let i = 0; i < rules.length; i++) {
      rules[i].sequence = i + 1;
      await rules[i].save();
    }
    console.log(`✅ Updated ${rules.length} ServiceDefinitionsVisitRules sequences`);

    // Migrate TermsAndConditions
    const terms = await TermsAndConditions.find().sort({ sequence: 1, createdAt: 1 });
    for (let i = 0; i < terms.length; i++) {
      terms[i].sequence = i + 1;
      await terms[i].save();
    }
    console.log(`✅ Updated ${terms.length} TermsAndConditions sequences`);

    await mongoose.connection.close();
    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error migrating sequences:', error.message);
    console.error(error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

// Run the migration
migrateSequences();

