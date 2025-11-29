import { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import { asyncHandler } from '../middleware/asyncHandler';
import { generateToken } from '../utils/generateToken';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';

interface SignupRequest extends Request {
  body: {
    name: string;
    email: string;
    phone: string;
    password: string;
  };
}

// @desc    Register a new user
// @route   POST /api/auth/signup
// @access  Public
export const signup = asyncHandler(async (req: SignupRequest, res: Response, next: NextFunction) => {
  const { name, email, phone, password } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new AppError('User already exists with this email', 400));
  }

  // Check if phone number is already registered
  const existingPhone = await User.findOne({ phone });
  if (existingPhone) {
    return next(new AppError('User already exists with this phone number', 400));
  }

  // Create user with default role as 'customer'
  const user = await User.create({
    name,
    email,
    phone,
    password,
    role: 'customer', // Default role for signups
    credits: 0,
    familyMembers: [],
    addresses: []
  });

  // Generate token
  const token = generateToken({
    userId: user._id.toString(),
    email: user.email
  });

  // Send response
  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
        activePlanId: user.activePlanId,
        familyMembers: user.familyMembers,
        addresses: user.addresses
      },
      token
    }
  });
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  // Find user and include password
  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    return next(new AppError('Invalid credentials', 401));
  }

  // Check password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    return next(new AppError('Invalid credentials', 401));
  }

  // Generate token
  const token = generateToken({
    userId: user._id.toString(),
    email: user.email
  });

  // Send response
  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
        activePlanId: user.activePlanId,
        familyMembers: user.familyMembers,
        addresses: user.addresses
      },
      token
    }
  });
});

// @desc    Admin login (for Admin, Supervisor, Incharge roles only)
// @route   POST /api/auth/admin/login
// @access  Public
export const adminLogin = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  // Find user and include password
  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    return next(new AppError('Invalid credentials', 401));
  }

  // Check if user has admin role
  const adminRoles: Array<'Admin' | 'Supervisor' | 'Incharge'> = ['Admin', 'Supervisor', 'Incharge'];
  if (!adminRoles.includes(user.role as 'Admin' | 'Supervisor' | 'Incharge')) {
    return next(new AppError('Access denied. Admin privileges required.', 403));
  }

  // Check password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    return next(new AppError('Invalid credentials', 401));
  }

  // Generate token
  const token = generateToken({
    userId: user._id.toString(),
    email: user.email || undefined
  });

  // Send response
  res.status(200).json({
    success: true,
    message: 'Admin login successful',
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
        activePlanId: user.activePlanId,
        familyMembers: user.familyMembers,
        addresses: user.addresses
      },
      token
    }
  });
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
export const getMe = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthRequest;
  
  if (!authReq.user) {
    return next(new AppError('User not authenticated', 401));
  }

  const user = await User.findById(authReq.user.id);
  
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
        activePlanId: user.activePlanId,
        familyMembers: user.familyMembers,
        addresses: user.addresses
      }
    }
  });
});

