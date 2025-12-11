/**
 * Migration script to clean up users with empty email strings
 * This fixes the E11000 duplicate key error for email field
 * Run with: npx ts-node src/scripts/cleanupEmptyEmails.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import connectDB from '../config/database';

// Load environment variables
dotenv.config();

const cleanupEmptyEmails = async () => {
  try {
    // Connect to database
    console.log('🔌 Connecting to database...');
    await connectDB();

    // Step 1: Ensure the email index is sparse (drop and recreate to be safe)
    console.log('\n🔧 Ensuring email index is sparse...');
    try {
      // Try to drop the existing index (ignore if it doesn't exist)
      try {
        await User.collection.dropIndex('email_1');
        console.log('   ✅ Dropped existing email index');
      } catch (error: any) {
        if (error.message && error.message.includes('index not found')) {
          console.log('   ℹ️  Email index does not exist yet');
        } else {
          console.log(`   ⚠️  Could not drop index: ${error.message}`);
        }
      }
      
      // Create sparse unique index (allows multiple null/undefined values)
      await User.collection.createIndex({ email: 1 }, { unique: true, sparse: true });
      console.log('   ✅ Created/recreated sparse unique index on email');
    } catch (error: any) {
      console.log(`   ⚠️  Error managing index: ${error.message}`);
      console.log('   Continuing with cleanup anyway...');
    }

    // Find all users with empty email strings
    console.log('\n🔍 Searching for users with empty email strings...');
    const usersWithEmptyEmail = await User.find({ email: '' });
    
    console.log(`📊 Found ${usersWithEmptyEmail.length} user(s) with empty email strings`);

    if (usersWithEmptyEmail.length === 0) {
      console.log('✅ No users with empty emails found. Database is clean!');
      await mongoose.connection.close();
      process.exit(0);
    }

    // Check how many users already have null/undefined email
    const usersWithNullEmail = await User.countDocuments({ 
      $or: [
        { email: null },
        { email: { $exists: false } }
      ]
    });
    console.log(`📊 Users with null/undefined email: ${usersWithNullEmail}`);

    // Display users that will be updated
    console.log('\n📋 Users to be updated:');
    usersWithEmptyEmail.forEach((user, index) => {
      console.log(`   ${index + 1}. ${user.name} (Phone: ${user.phone}, Role: ${user.role})`);
    });

    // Check if there are any users with null email already
    const existingNullEmailUsers = await User.find({ 
      $or: [
        { email: null },
        { email: { $exists: false } }
      ]
    }).select('_id name phone');
    
    if (existingNullEmailUsers.length > 0) {
      console.log(`\n⚠️  Found ${existingNullEmailUsers.length} user(s) with null/undefined email:`);
      existingNullEmailUsers.forEach((u, i) => {
        console.log(`   ${i + 1}. ${u.name} (Phone: ${u.phone})`);
      });
      console.log('   These users will be skipped from cleanup.');
    }

    // Update users one by one to handle potential duplicates gracefully
    // Strategy: Use updateOne with $set to null directly (sparse index should allow this)
    console.log('\n🔄 Updating users...');
    let successCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const user of usersWithEmptyEmail) {
      try {
        // Use updateOne with $set to null - sparse index should allow multiple nulls
        // But if there's already a null, we'll get an error, so we'll handle it
        const result = await User.updateOne(
          { _id: user._id },
          { $set: { email: null } }
        );
        
        if (result.modifiedCount > 0) {
          successCount++;
          console.log(`   ✅ Updated: ${user.name}`);
        } else {
          // User might have been updated already or doesn't exist
          console.log(`   ⚠️  No changes for: ${user.name}`);
        }
      } catch (error: any) {
        // If we get a duplicate key error, use native MongoDB driver to bypass Mongoose
        if (error.message.includes('E11000') || error.message.includes('duplicate key')) {
          try {
            // Use native MongoDB collection to directly unset the field
            // This bypasses Mongoose validation and index checks
            const db = mongoose.connection.db;
            if (db) {
              await db.collection('users').updateOne(
                { _id: user._id },
                { $unset: { email: '' } }
              );
              successCount++;
              console.log(`   ✅ Updated (native driver): ${user.name}`);
            } else {
              throw new Error('Database connection not available');
            }
          } catch (nativeError: any) {
            skippedCount++;
            const errorMsg = `Failed to update ${user.name}: ${nativeError.message}`;
            errors.push(errorMsg);
            console.log(`   ⚠️  Skipped: ${user.name} - ${nativeError.message}`);
          }
        } else {
          skippedCount++;
          const errorMsg = `Failed to update ${user.name}: ${error.message}`;
          errors.push(errorMsg);
          console.log(`   ⚠️  Skipped: ${user.name} - ${error.message}`);
        }
      }
    }

    console.log(`\n✅ Successfully updated ${successCount} user(s)`);
    if (skippedCount > 0) {
      console.log(`⚠️  Skipped ${skippedCount} user(s) due to errors`);
    }

    // Verify the update
    const remainingEmptyEmails = await User.find({ email: '' });
    if (remainingEmptyEmails.length === 0) {
      console.log('✅ Verification passed: No users with empty emails remain');
    } else {
      console.log(`⚠️  Warning: ${remainingEmptyEmails.length} user(s) still have empty emails`);
    }

    // Show summary
    console.log('\n📊 Summary:');
    console.log(`   - Users found with empty emails: ${usersWithEmptyEmail.length}`);
    console.log(`   - Users updated: ${successCount}`);
    console.log(`   - Users skipped: ${skippedCount}`);
    console.log(`   - Users remaining with empty emails: ${remainingEmptyEmails.length}`);
    
    if (errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    await mongoose.connection.close();
    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error during migration:', error.message);
    console.error(error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
};

// Run the script
cleanupEmptyEmails();
