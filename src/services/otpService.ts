import OTP from '../models/OTP';
import { generateOTP, getOTPExpiration } from '../utils/generateOTP';

/**
 * Send OTP via SMS
 * This is a placeholder - integrate with actual SMS service
 */
export const sendOTPViaSMS = async (phone: string, otp: string): Promise<boolean> => {
  // TODO: Integrate with SMS service (MSG91, Twilio, etc.)
  // For now, just log it
  console.log(`Sending OTP ${otp} to ${phone}`);
  
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // In production, this would call the SMS service API
  // Example with MSG91:
  // const response = await fetch('https://api.msg91.com/api/v5/otp', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'authkey': process.env.MSG91_AUTH_KEY
  //   },
  //   body: JSON.stringify({
  //     template_id: process.env.MSG91_TEMPLATE_ID,
  //     mobile: phone.replace('+', ''),
  //     otp: otp
  //   })
  // });
  
  return true;
};

/**
 * Create and send OTP
 */
export const createAndSendOTP = async (phone: string): Promise<{ success: boolean; message?: string }> => {
  try {
    // Check for recent OTP (prevent spam)
    const recentOTP = await OTP.findOne({
      phone,
      createdAt: { $gte: new Date(Date.now() - 60000) } // Last 1 minute
    });

    if (recentOTP) {
      return {
        success: false,
        message: 'Please wait before requesting a new OTP'
      };
    }

    // Generate OTP
    const otpCode = generateOTP();
    const expiresAt = getOTPExpiration(10); // 10 minutes expiry

    // Invalidate previous unverified OTPs for this phone
    await OTP.updateMany(
      { phone, verified: false },
      { verified: true } // Mark as verified to invalidate
    );

    // Save OTP to database
    const otpRecord = await OTP.create({
      phone,
      otp: otpCode,
      expiresAt,
      attempts: 0,
      verified: false
    });

    // Send OTP via SMS
    const sent = await sendOTPViaSMS(phone, otpCode);

    if (!sent) {
      await OTP.findByIdAndDelete(otpRecord._id);
      return {
        success: false,
        message: 'Failed to send OTP. Please try again.'
      };
    }

    return {
      success: true,
      message: 'OTP sent successfully'
    };
  } catch (error) {
    console.error('Error creating OTP:', error);
    return {
      success: false,
      message: 'Failed to send OTP. Please try again.'
    };
  }
};

/**
 * Verify OTP
 */
export const verifyOTP = async (phone: string, otp: string): Promise<{ success: boolean; message?: string }> => {
  try {
    const otpRecord = await OTP.findOne({
      phone,
      verified: false,
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 }); // Get most recent OTP

    if (!otpRecord) {
      return {
        success: false,
        message: 'Invalid or expired OTP'
      };
    }

    // Check attempts
    if (otpRecord.attempts >= 5) {
      return {
        success: false,
        message: 'Maximum verification attempts exceeded. Please request a new OTP.'
      };
    }

    // Increment attempts
    otpRecord.attempts += 1;
    await otpRecord.save();

    // Verify OTP
    if (otpRecord.otp !== otp) {
      return {
        success: false,
        message: 'Invalid OTP'
      };
    }

    // Mark as verified and delete the OTP record
    await OTP.findByIdAndDelete(otpRecord._id);

    return {
      success: true,
      message: 'OTP verified successfully'
    };
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return {
      success: false,
      message: 'Failed to verify OTP. Please try again.'
    };
  }
};

