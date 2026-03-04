import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import connectDB from '../config/database';

dotenv.config();

const updatePassword = async () => {
    try {
        await connectDB();

        const email = 'testing@beforeu.in';
        const newPassword = 'admin1';

        console.log(`🔍 Finding user with email: ${email}...`);
        const user = await User.findOne({ email });

        if (!user) {
            console.error(`❌ User with email ${email} not found`);

            // Try searching for admin@before.com just in case the typo was intentional
            console.log('🔍 Trying admin@before.com...');
            const user2 = await User.findOne({ email: 'admin@before.com' });

            if (!user2) {
                await mongoose.connection.close();
                process.exit(1);
            }

            user2.password = newPassword;
            await user2.save();
            console.log(`✅ Password updated successfully for admin@before.com`);
        } else {
            user.password = newPassword;
            await user.save();
            console.log(`✅ Password updated successfully for ${email}`);
        }

        console.log(`   New Password: ${newPassword}`);

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error updating password:', error);
        process.exit(1);
    }
};

updatePassword();
