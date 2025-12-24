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

    // Check for provider configuration
    const smsProvider = process.env.SMS_PROVIDER || 'smartping';

    if (smsProvider === 'brevo') {
      return await sendOTPViaBrevo(phone, otp);
    }


    // 1. Get Credentials from Env
    const username = process.env.SMS_USERNAME;
    const password = process.env.SMS_PASSWORD;
    const senderId = process.env.SMS_SENDER_ID;
    const templateId = process.env.SMS_OTP_TEMPLATE_ID;
    const entityId = process.env.SMS_ENTITY_ID; // Principal Entity ID (for DLT)
    const baseUrl = process.env.SMS_PROVIDER_URL || 'https://bulksmsapi.vispl.in/';

    // 2. Validate Configuration
    if (!username || !password || !senderId || !templateId) {
      console.warn('SMS Configuration missing. OTP logged to console instead.');
      console.log(`[DEV MODE] Sending OTP ${otp} to ${phone}`);
      return true; // Return true in dev mode to allow flow to continue
    }

    // 3. Prepare Message
    // NOTE: This message MUST match your DLT approved template exactly.
    // Ensure the placeholder {#var#} or equivalent matches your template.
    // Example Template: "Your OTP for login to BeforeU is {#var#}. Valid for 10 mins. Do not share this with anyone."
    let messageTemplate = process.env.SMS_OTP_MESSAGE_TEMPLATE || 'Your One Time Password is {otp} to complete your login process. Powered by BeforeU';
    const message = messageTemplate.replace('{otp}', otp);

    // 4. Construct URL with parameters
    // VISPL API format: https://bulksmsapi.vispl.in/?username=...&password=...&messageType=text&mobile=...&senderId=...&ContentID=...&EntityID=...&message=...
    const params = new URLSearchParams({
      username: username,
      password: password,
      messageType: 'text',
      mobile: phone,
      senderId: senderId,
      ContentID: templateId,
      message: message,
    });

    if (entityId) {
      params.append('EntityID', entityId);
    }

    const url = `${baseUrl}?${params.toString()}`;

    // Debug log - safe for production logs if password suppressed
    const debugParams = new URLSearchParams(params);
    debugParams.set('password', '*****');
    console.log(`[SMS DEBUG] URL: ${baseUrl}?${debugParams.toString()}`);

    console.log(`[SMS] Sending OTP to ${phone.slice(-4)} via SmartPing`);

    // 5. Send Request
    const response = await fetch(url.toString(), {
      method: 'GET'
    });

    const responseText = await response.text();

    // 6. Check Response
    // SmartPing usually returns "JobId=..." or "Success" or status code 200.
    if (response.ok && (responseText.toLowerCase().includes('jobid') || responseText.toLowerCase().includes('success'))) {
      console.log('[SMS] Sent successfully. Response:', responseText);
      return true;
    } else {
      console.error('[SMS] Failed to send. Status:', response.status, 'Response:', responseText);
      return false;
    }

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

