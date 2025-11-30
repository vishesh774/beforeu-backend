import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { AdminRequest } from '../middleware/adminAuth';
import User from '../models/User';
import { initializeUserRecords } from '../utils/userHelpers';

// @desc    Get all admin users (excluding customers) with pagination and filters
// @route   GET /api/admin/users
// @access  Private/Admin
export const getAllUsers = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
  const adminRoles: Array<'Admin' | 'Supervisor' | 'Incharge'> = ['Admin', 'Supervisor', 'Incharge'];
  
  // Pagination parameters
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Filter parameters
  const roleFilter = req.query.role as string | undefined;
  const isActiveFilter = req.query.isActive as string | undefined;
  const searchQuery = req.query.search as string | undefined;

  // Build filter object
  const filter: any = {
    role: { $in: adminRoles }
  };

  // Apply role filter
  if (roleFilter && adminRoles.includes(roleFilter as 'Admin' | 'Supervisor' | 'Incharge')) {
    filter.role = roleFilter;
  }

  // Apply active/inactive filter
  if (isActiveFilter !== undefined) {
    filter.isActive = isActiveFilter === 'true';
  }

  // Apply search filter (name, email, phone)
  if (searchQuery && searchQuery.trim()) {
    const searchRegex = { $regex: searchQuery.trim(), $options: 'i' };
    filter.$or = [
      { name: searchRegex },
      { email: searchRegex },
      { phone: searchRegex }
    ];
  }

  // Get total count for pagination
  const total = await User.countDocuments(filter);

  // Get paginated users
  const users = await User.find(filter)
    .select('-password')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json({
    success: true,
    data: {
      users: users.map(user => ({
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

// @desc    Get single admin user by ID
// @route   GET /api/admin/users/:id
// @access  Private/Admin
export const getUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const adminRoles: Array<'Admin' | 'Supervisor' | 'Incharge'> = ['Admin', 'Supervisor', 'Incharge'];

  const user = await User.findById(id).select('-password');
  
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Check if user is an admin user (not a customer)
  if (!adminRoles.includes(user.role as 'Admin' | 'Supervisor' | 'Incharge')) {
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
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    }
  });
});

// @desc    Create new admin user
// @route   POST /api/admin/users
// @access  Private/Admin
export const createUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { name, email, phone, password, role } = req.body;

  // Validate required fields
  if (!name || !email || !phone || !password || !role) {
    return next(new AppError('Name, email, phone, password, and role are required', 400));
  }

  // Validate role
  const adminRoles: Array<'Admin' | 'Supervisor' | 'Incharge'> = ['Admin', 'Supervisor', 'Incharge'];
  if (!adminRoles.includes(role)) {
    return next(new AppError('Invalid role. Must be Admin, Supervisor, or Incharge', 400));
  }

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

  // Create user
  const user = await User.create({
    name,
    email,
    phone,
    password,
    role,
    isActive: true
  });

  // Initialize user-related records (credits and plan)
  await initializeUserRecords(user._id);

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    }
  });
});

// @desc    Update user
// @route   PUT /api/admin/users/:id
// @access  Private/Admin
export const updateUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { name, email, phone, role, password } = req.body;

  const user = await User.findById(id);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Check if user is an admin user (not a customer)
  const adminRoles: Array<'Admin' | 'Supervisor' | 'Incharge'> = ['Admin', 'Supervisor', 'Incharge'];
  if (!adminRoles.includes(user.role as 'Admin' | 'Supervisor' | 'Incharge')) {
    return next(new AppError('Cannot update customer users through this endpoint', 400));
  }

  // Update fields
  if (name) user.name = name;
  if (email) {
    // Check if email is already taken by another user
    const existingUser = await User.findOne({ email, _id: { $ne: id } });
    if (existingUser) {
      return next(new AppError('Email already in use by another user', 400));
    }
    user.email = email;
  }
  if (phone) {
    // Check if phone is already taken by another user
    const existingUser = await User.findOne({ phone, _id: { $ne: id } });
    if (existingUser) {
      return next(new AppError('Phone number already in use by another user', 400));
    }
    user.phone = phone;
  }
  if (role) {
    if (!adminRoles.includes(role)) {
      return next(new AppError('Invalid role. Must be Admin, Supervisor, or Incharge', 400));
    }
    user.role = role;
  }
  if (password) {
    user.password = password; // Will be hashed by pre-save hook
  }

  await user.save();

  res.status(200).json({
    success: true,
    message: 'User updated successfully',
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    }
  });
});

// @desc    Deactivate user
// @route   PATCH /api/admin/users/:id/deactivate
// @access  Private/Admin
export const deactivateUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const adminReq = req as AdminRequest;

  // Prevent self-deactivation
  if (adminReq.adminUser && adminReq.adminUser.id === id) {
    return next(new AppError('You cannot deactivate your own account', 400));
  }

  const user = await User.findById(id);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Check if user is an admin user (not a customer)
  const adminRoles: Array<'Admin' | 'Supervisor' | 'Incharge'> = ['Admin', 'Supervisor', 'Incharge'];
  if (!adminRoles.includes(user.role as 'Admin' | 'Supervisor' | 'Incharge')) {
    return next(new AppError('Cannot deactivate customer users through this endpoint', 400));
  }

  user.isActive = false;
  await user.save();

  res.status(200).json({
    success: true,
    message: 'User deactivated successfully',
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    }
  });
});

