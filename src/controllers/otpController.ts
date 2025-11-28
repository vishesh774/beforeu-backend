import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { createAndSendOTP, verifyOTP } from '../services/otpService';
import User from '../models/User';
import { generateToken } from '../utils/generateToken';

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

  // User exists - generate token and return user data
  const token = generateToken({
    userId: user._id.toString(),
    email: user.email
  });

  res.status(200).json({
    success: true,
    message: 'OTP verified successfully',
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        credits: user.credits,
        activePlanId: user.activePlanId,
        familyMembers: user.familyMembers,
        addresses: user.addresses
      },
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

  if (!phone || !name || !email) {
    return next(new AppError('Phone, name, and email are required', 400));
  }

  // Verify that OTP was verified for this phone
  const OTP = (await import('../models/OTP')).default;
  const verifiedOTP = await OTP.findOne({
    phone,
    verified: true,
    createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) } // Within last 30 minutes
  }).sort({ createdAt: -1 });

  if (!verifiedOTP) {
    return next(new AppError('OTP verification required. Please verify your phone number first.', 400));
  }

  // Check if user already exists
  let user = await User.findOne({ phone });

  if (user) {
    // Update existing user
    user.name = name;
    user.email = email;
    await user.save();
  } else {
    // Create new user
    user = await User.create({
      name,
      email,
      phone,
      password: 'temp-password-' + Date.now(), // Temporary password, user can set later
      credits: 0,
      familyMembers: [],
      addresses: []
    });
  }

  // Generate token
  const token = generateToken({
    userId: user._id.toString(),
    email: user.email
  });

  res.status(201).json({
    success: true,
    message: 'Profile completed successfully',
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        credits: user.credits,
        activePlanId: user.activePlanId,
        familyMembers: user.familyMembers,
        addresses: user.addresses
      },
      token
    }
  });
});

