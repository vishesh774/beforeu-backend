import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import Address from '../models/Address';
import FamilyMember from '../models/FamilyMember';
import { asyncHandler } from '../middleware/asyncHandler';
import { generateToken } from '../utils/generateToken';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { aggregateUserData, initializeUserRecords } from '../utils/userHelpers';

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
    role: 'customer' // Default role for signups
  });

  // Initialize user-related records (credits and plan)
  await initializeUserRecords(user._id);

  // Aggregate user data
  const userData = await aggregateUserData(user._id);
  if (!userData) {
    return next(new AppError('Failed to create user data', 500));
  }

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
      user: userData,
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

  // Check if user is active
  if (!user.isActive) {
    return next(new AppError('Your account has been deactivated. Please contact support.', 403));
  }

  // Aggregate user data
  const userData = await aggregateUserData(user._id);
  if (!userData) {
    return next(new AppError('Failed to load user data', 500));
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
      user: userData,
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

  // Send response
  res.status(200).json({
    success: true,
    message: 'Admin login successful',
    data: {
      user: userData,
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

  const userData = await aggregateUserData(authReq.user.id);
  
  if (!userData) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      user: userData
    }
  });
});

// @desc    Add a new address for the authenticated user
// @route   POST /api/auth/addresses
// @access  Private
export const addAddress = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { label, fullAddress, area, coordinates, isDefault } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  if (!label || !fullAddress) {
    return next(new AppError('Label and full address are required', 400));
  }

  // Convert userId string to ObjectId
  const userIdObj = new mongoose.Types.ObjectId(userId);

  // Generate unique address ID
  const addressId = `addr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // If this is set as default, unset all other default addresses
  if (isDefault) {
    await Address.updateMany(
      { userId: userIdObj },
      { isDefault: false }
    );
  }

  // Create the address
  const address = await Address.create({
    userId: userIdObj,
    id: addressId,
    label,
    fullAddress,
    area: area || undefined,
    coordinates: coordinates ? {
      lat: coordinates.lat,
      lng: coordinates.lng
    } : undefined,
    isDefault: isDefault || false
  });

  // Aggregate updated user data
  const userData = await aggregateUserData(userIdObj);

  res.status(201).json({
    success: true,
    data: {
      address: {
        id: address.id,
        label: address.label,
        fullAddress: address.fullAddress,
        area: address.area,
        coordinates: address.coordinates,
        isDefault: address.isDefault
      },
      user: userData
    }
  });
});

// @desc    Update an existing address for the authenticated user
// @route   PUT /api/auth/addresses/:id
// @access  Private
export const updateAddress = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { label, fullAddress, area, coordinates, isDefault } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  if (!label || !fullAddress) {
    return next(new AppError('Label and full address are required', 400));
  }

  // Convert userId string to ObjectId
  const userIdObj = new mongoose.Types.ObjectId(userId);

  // Find the address and verify it belongs to the user
  const address = await Address.findOne({ userId: userIdObj, id });
  if (!address) {
    return next(new AppError('Address not found', 404));
  }

  // If this is set as default, unset all other default addresses
  if (isDefault) {
    await Address.updateMany(
      { userId: userIdObj, id: { $ne: id } },
      { isDefault: false }
    );
  }

  // Update the address
  address.label = label;
  address.fullAddress = fullAddress;
  if (area !== undefined) address.area = area;
  if (coordinates) {
    address.coordinates = {
      lat: coordinates.lat,
      lng: coordinates.lng
    };
  }
  address.isDefault = isDefault || false;
  await address.save();

  // Aggregate updated user data
  const userData = await aggregateUserData(userIdObj);

  res.status(200).json({
    success: true,
    data: {
      address: {
        id: address.id,
        label: address.label,
        fullAddress: address.fullAddress,
        area: address.area,
        coordinates: address.coordinates,
        isDefault: address.isDefault
      },
      user: userData
    }
  });
});

// @desc    Delete an address for the authenticated user
// @route   DELETE /api/auth/addresses/:id
// @access  Private
export const deleteAddress = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  // Convert userId string to ObjectId
  const userIdObj = new mongoose.Types.ObjectId(userId);

  // Find the address and verify it belongs to the user
  const address = await Address.findOne({ userId: userIdObj, id });
  if (!address) {
    return next(new AppError('Address not found', 404));
  }

  // Check if user has at least one address remaining
  const addressCount = await Address.countDocuments({ userId: userIdObj });
  if (addressCount <= 1) {
    return next(new AppError('Cannot delete the last address. You must have at least one address.', 400));
  }

  // Delete the address
  await Address.deleteOne({ userId: userIdObj, id });

  // If deleted address was default, set the first remaining address as default
  if (address.isDefault) {
    const remainingAddress = await Address.findOne({ userId: userIdObj });
    if (remainingAddress) {
      remainingAddress.isDefault = true;
      await remainingAddress.save();
    }
  }

  // Aggregate updated user data
  const userData = await aggregateUserData(userIdObj);

  res.status(200).json({
    success: true,
    data: {
      user: userData
    }
  });
});

// @desc    Add a new family member for the authenticated user
// @route   POST /api/auth/family-members
// @access  Private
export const addFamilyMember = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { name, relation, phone, email } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  if (!name || !relation || !phone) {
    return next(new AppError('Name, relation, and phone are required', 400));
  }

  // Convert userId string to ObjectId
  const userIdObj = new mongoose.Types.ObjectId(userId);

  // Generate unique family member ID
  const memberId = `fam-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Create the family member
  const familyMember = await FamilyMember.create({
    userId: userIdObj,
    id: memberId,
    name,
    relation,
    phone,
    email: email || undefined
  });

  // Aggregate updated user data
  const userData = await aggregateUserData(userIdObj);

  res.status(201).json({
    success: true,
    data: {
      familyMember: {
        id: familyMember.id,
        name: familyMember.name,
        relation: familyMember.relation,
        phone: familyMember.phone,
        email: familyMember.email
      },
      user: userData
    }
  });
});

