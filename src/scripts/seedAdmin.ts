/**
 * Seed script to create a default admin user
 * Run with: npx ts-node src/scripts/seedAdmin.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import connectDB from '../config/database';

// Load environment variables
dotenv.config();

const createAdminUser = async () => {
  try {
    // Connect to database
    await connectDB();

    // Check if admin user already exists (check by email: admin@beforeu.com)
    const adminEmail = 'admin@beforeu.com';
    const existingAdmin = await User.findOne({ email: adminEmail });
    
    if (existingAdmin) {
      console.log('✅ Admin user already exists');
      console.log(`   Email: ${existingAdmin.email}`);
      console.log(`   Role: ${existingAdmin.role}`);
      
      // Update role if needed
      if (existingAdmin.role !== 'Admin') {
        existingAdmin.role = 'Admin';
        await existingAdmin.save();
        console.log('   ✅ Role updated to Admin');
      }
      
      // Update password to 'admin' if needed
      existingAdmin.password = 'admin';
      await existingAdmin.save();
      console.log('   ✅ Password reset to "admin"');
      
      await mongoose.connection.close();
      process.exit(0);
    }

    // Create admin user
    const adminUser = await User.create({
      name: 'Admin User',
      email: adminEmail,
      phone: '+911234567890', // Dummy phone number
      password: 'admin1', // Will be hashed by pre-save hook
      role: 'Admin',
      credits: 0,
      familyMembers: [],
      addresses: []
    });

    console.log('✅ Admin user created successfully!');
    console.log(`   Email: ${adminUser.email}`);
    console.log(`   Password: admin`);
    console.log(`   Role: ${adminUser.role}`);
    console.log(`   ID: ${adminUser._id}`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error creating admin user:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
};

// Run the script
createAdminUser();

