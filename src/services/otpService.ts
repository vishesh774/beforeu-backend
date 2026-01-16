import OTP from '../models/OTP';
// import { generateOTP, getOTPExpiration } from '../utils/generateOTP';
import { generateOTP, getOTPExpiration } from '../utils/generateOTP';

/**
 * Send OTP via SMS
 * This is a placeholder - integrate with actual SMS service
 */
/**
 * Send OTP via SMS
 */
export const sendOTPViaSMS = async (phone: string, otp: string): Promise<boolean> => {
  try {
    console.log('[OTP] Generated OTP:', otp); // Log OTP for development/fallback

    // Skip sending for hardcoded test OTP
    if (otp === '123456') {
      console.log(`[OTP] Skipping SMS send for hardcoded test OTP ${otp} to ${phone}`);
      return true;
    }
    const smsProvider = process.env.SMS_PROVIDER;

    if (smsProvider === 'brevo') {
      return await sendOTPViaBrevo(phone, otp);
    }

    if (smsProvider === 'pinnacle') {
      return await sendOTPViaPinnacle(phone, otp);
    }

    console.warn(`[SMS] Unknown SMS Provider: ${smsProvider}. OTP logged to console.`);
    return false;

  } catch (error) {
    console.error('[SMS] Error sending SMS:', error);
    return false;
  }
};


/**
 * Send OTP via Brevo
 */
const sendOTPViaBrevo = async (phone: string, otp: string): Promise<boolean> => {
  try {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.BREVO_SMS_SENDER || 'BeforeU';

    if (!apiKey) {
      console.warn('Brevo API Key missing. OTP logged to console instead.');
      console.log(`[DEV MODE - Brevo] Sending OTP ${otp} to ${phone}`);
      return true;
    }

    // Brevo requires phone number with country code without '+' if it's purely checking digits, 
    // but the API documentation usually expects E.164. 
    // However, the user input might be just 10 digits.
    // Ensure we have a valid format for Brevo. Assuming Indian numbers if length is 10.
    let formattedPhone = phone;
    if (phone.length === 10) {
      formattedPhone = '91' + phone;
    } else if (phone.startsWith('+')) {
      formattedPhone = phone.substring(1);
    }

    const url = 'https://api.brevo.com/v3/transactionalSMS/sms';

    const body = {
      sender: sender.substring(0, 11), // Max 11 alphanumeric characters
      recipient: formattedPhone,
      content: `Your OTP for login to BeforeU is ${otp}. Valid for 10 mins.`,
      type: 'transactional'
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const responseData = await response.json() as any;

    if (response.ok) {
      console.log('[SMS-Brevo] Sent successfully. Reference:', responseData.reference);
      return true;
    } else {
      console.error('[SMS-Brevo] Failed to send. Status:', response.status, 'Response:', responseData);
      return false;
    }

  } catch (error) {
    console.error('[SMS-Brevo] Error sending SMS:', error);
    return false;
  }
};

/**
 * Send OTP via Pinnacle
 */
const sendOTPViaPinnacle = async (phone: string, otp: string): Promise<boolean> => {
  try {
    const apiKey = process.env.PINNACLE_API_KEY; // 6a57a4-555b60-0601c6-12f1dc-eb579a
    const sender = process.env.PINNACLE_SENDER || 'BFOURU'; // BFOURU
    const entityId = process.env.PINNACLE_ENTITY_ID; // Not used in example URL but good to have if needed later
    const dltTempId = process.env.PINNACLE_DLT_TEMP_ID || '1707176476476794172';

    if (!apiKey) {
      console.warn('Pinnacle API Key missing. OTP logged to console instead.');
      console.log(`[DEV MODE - Pinnacle] Sending OTP ${otp} to ${phone}`);
      return true;
    }

    // Prepare phone number: Ensure it's 10 digits as per example (8888836963)
    let formattedPhone = phone;
    if (phone.startsWith('+91')) {
      formattedPhone = phone.replace('+91', '');
    } else if (phone.startsWith('91') && phone.length === 12) {
      formattedPhone = phone.substring(2);
    }

    // Pinnacle Message format: Your One Time Password is {otp} to complete your account registration. Powered by BeforeU
    // URL Encoded automatically by URLSearchParams
    const message = `Your One Time Password is ${otp} to complete your account registration. Powered by BeforeU`;

    const baseUrl = 'https://api.pinnacle.in/index.php/sms/urlsms';
    const params = new URLSearchParams({
      sender: sender,
      numbers: formattedPhone,
      messagetype: 'TXT',
      message: message,
      response: 'Y',
      apikey: apiKey,
      dlttempid: dltTempId
    });

    const url = `${baseUrl}?${params.toString()}`;

    // Debug log (masking API key)
    const debugParams = new URLSearchParams(params);
    debugParams.set('apikey', '*****');
    console.log(`[SMS-Pinnacle DEBUG] URL: ${baseUrl}?${debugParams.toString()}`);

    const response = await fetch(url.toString(), {
      method: 'GET'
    });

    const responseText = await response.text();

    if (response.ok) {
      console.log('[SMS-Pinnacle] Sent successfully. Response:', responseText);
      return true;
    } else {
      console.error('[SMS-Pinnacle] Failed to send. Status:', response.status, 'Response:', responseText);
      return false;
    }

  } catch (error) {
    console.error('[SMS-Pinnacle] Error sending SMS:', error);
    return false;
  }
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
    // const otpCode = generateOTP();
    // const otpCode = '123456';

    let otpCode: string;

    // 1. Hardcoded OTP for specific number
    if (phone === '8197744060' || phone.endsWith('8197744060')) {
      otpCode = '123456';
    } else {
      otpCode = generateOTP();
    }

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
      console.warn(`[OTP] SMS sending failed for ID ${otpRecord._id}, proceeding with OTP verification enabled for dev purposes.`);
      // Do NOT delete the OTP record so it can still be verified via console log
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

