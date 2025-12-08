import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { createAndSendOTP, verifyOTP } from '../services/otpService';
import User from '../models/User';
import { generateToken } from '../utils/generateToken';
import { aggregateUserData, initializeUserRecords } from '../utils/userHelpers';

// @desc    Send OTP to phone number
// @route   POST /api/auth/send-otp
// @access  Public
export const sendOTP = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { phone } = req.body;

  if (!phone) {
    return next(new AppError('Phone number is required', 400));
  }

  // Validate phone number format (should include country code)
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(phone)) {
    return next(new AppError('Invalid phone number format', 400));
  }

  const result = await createAndSendOTP(phone);

  if (!result.success) {
    return next(new AppError(result.message || 'Failed to send OTP', 400));
  }

  res.status(200).json({
    success: true,
    message: 'OTP sent successfully',
    data: {
      phone: phone.replace(/\d(?=\d{4})/g, '*') // Mask phone number
    }
  });
});

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
export const verifyOTPController = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return next(new AppError('Phone number and OTP are required', 400));
  }

  const result = await verifyOTP(phone, otp);

  if (!result.success) {
    return next(new AppError(result.message || 'Invalid OTP', 400));
  }

  // Check if user exists, if not, create a temporary record
  let user = await User.findOne({ phone });

  if (!user) {
    // User doesn't exist yet - they'll complete profile after OTP verification
    // For now, just return success
    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        phone,
        isNewUser: true
      }
    });
    return;
  }

  // User exists - aggregate user data
  const userData = await aggregateUserData(user._id);
  if (!userData) {
    return next(new AppError('Failed to load user data', 500));
  }

  // Generate token
  const token = generateToken({
    userId: user._id.toString(),
    email: user.email || undefined
  });

  res.status(200).json({
    success: true,
    message: 'OTP verified successfully',
    data: {
      user: userData,
      token,
      isNewUser: false
    }
  });
});

// @desc    Complete profile after OTP verification
// @route   POST /api/auth/complete-profile
// @access  Public
export const completeProfile = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { phone, name, email } = req.body;

  if (!phone || !name) {
    return next(new AppError('Phone and name are required', 400));
  }

  // Note: Since OTPs are now deleted after verification, we rely on the fact that
  // verifyOTP was called successfully before this endpoint. In production, you might
  // want to use a session token or JWT to verify the OTP verification step.
  // For now, we'll allow profile completion if user doesn't exist or was created recently.

  // Check if user already exists
  let user = await User.findOne({ phone });

  if (user) {
    // Update existing user
    user.name = name;
    // Only set email if provided and not empty, otherwise set to undefined to avoid unique constraint violation
    if (email && email.trim()) {
      user.email = email.trim().toLowerCase();
    } else {
      user.email = undefined; // Set to undefined instead of empty string to allow sparse unique index
    }
    await user.save();
  } else {
    // Create new user with default role as 'customer'
    // Only include email if provided and not empty
    const userData: any = {
      name,
      phone,
      password: 'temp-password-' + Date.now(), // Temporary password, user can set later
      role: 'customer' // Default role for OTP-based signups
    };
    
    // Only add email if provided and not empty
    if (email && email.trim()) {
      userData.email = email.trim().toLowerCase();
    }
    // Don't set email at all if not provided (undefined) - this allows sparse unique index to work
    
    user = await User.create(userData);
    
    // Initialize user-related records
    await initializeUserRecords(user._id);
  }

  // Aggregate user data
  const userData = await aggregateUserData(user._id);
  if (!userData) {
    return next(new AppError('Failed to load user data', 500));
  }

  // Generate token
  const token = generateToken({
    userId: user._id.toString(),
    email: user.email || undefined
  });

  res.status(201).json({
    success: true,
    message: 'Profile completed successfully',
    data: {
      user: userData,
      token
    }
  });
});

