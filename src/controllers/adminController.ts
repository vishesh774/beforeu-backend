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
  // Pagination parameters
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Filter parameters
  const roleFilter = req.query.role as string | undefined;
  const isActiveFilter = req.query.isActive as string | undefined;
  const searchQuery = req.query.search as string | undefined;

  // Build filter object (Generic: All non-customer users)
  const filter: any = {
    role: { $ne: 'customer' }
  };

  // Apply role filter
  // Apply role filter (Exclude customers by default)
  if (roleFilter) {
    filter.role = roleFilter;
  }

  // Apply active/inactive filter
  if (isActiveFilter !== undefined) {
    filter.isActive = isActiveFilter === 'true';
  }

  // Apply search filter (name, email, phone)
  if (searchQuery && searchQuery.trim()) {
    const trimmedQuery = searchQuery.trim();
    // Escape special characters for regex
    const escapedSearch = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = { $regex: escapedSearch, $options: 'i' };

    const orConditions: any[] = [
      { name: searchRegex },
      { email: searchRegex },
      { phone: searchRegex }
    ];

    // If search looks like a phone number (last 10 digits)
    const digitsOnly = trimmedQuery.replace(/\D/g, '');
    if (digitsOnly.length >= 10) {
      const last10 = digitsOnly.slice(-10);
      orConditions.push({ phone: { $regex: last10 + '$' } });
    }

    filter.$or = orConditions;
  }

  // Get total count for pagination
  const total = await User.countDocuments(filter);

  // Get paginated users
  const users = await User.find(filter)
    .select('-password')
    .populate('roleId', 'name')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json({
    success: true,
    data: {
      users: users.map((user: any) => ({
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.roleId?.name || user.role,
        roleId: user.roleId?._id || user.roleId,
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
  /* removed adminRoles redeclaration */

  const user = await User.findById(id).select('-password').populate('roleId', 'name');

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Check if user is an admin user (not a customer)
  if (user.role === 'customer') {
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
        role: (user as any).roleId?.name || user.role,
        roleId: (user as any).roleId?._id || (user as any).roleId,
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
  const { name, email, phone, password, role, roleId } = req.body;

  // Validate required fields
  if (!name || !email || !phone || !password || !role) {
    return next(new AppError('Name, email, phone, password, and role are required', 400));
  }

  // Validate role (Generic check: Must not be customer)
  if (role === 'customer') {
    return next(new AppError('Cannot create customer users through this endpoint', 400));
  }

  // Validate roleId if provided
  if (roleId) {
    // Import Role dynamically if needed or assume it's imported at top (I will add import)
    const RoleModel = require('../models/Role').default;
    const validRole = await RoleModel.findById(roleId);
    if (!validRole) {
      return next(new AppError('Invalid Role ID provided', 400));
    }
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
    roleId: roleId || undefined,
    isActive: true
  });

  // Initialize user-related records (credits and plan)
  await initializeUserRecords(user._id);

  // If role is ServicePartner, ensure a ServicePartner profile exists
  if (role === 'ServicePartner') {
    const ServicePartnerModel = require('../models/ServicePartner').default;
    const existingPartner = await ServicePartnerModel.findOne({ phone });
    if (!existingPartner) {
      await ServicePartnerModel.create({
        name,
        phone,
        email: email && email.trim() ? email.trim().toLowerCase() : undefined,
        services: [], // Needs to be updated later by admin
        isActive: true
      });
    }
  }

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
        roleId: user.roleId,
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
  const { name, email, phone, role, password, crmId, roleId } = req.body;

  const user = await User.findById(id);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Check if user is an admin user (not a customer)
  if (user.role === 'customer') {
    return next(new AppError('Cannot update customer users through this endpoint', 400));
  }

  // Update fields
  if (name) user.name = name;
  if (crmId) user.crmId = crmId;
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
    if (role === 'customer') {
      return next(new AppError('Invalid role. Use the customer management endpoint.', 400));
    }
    user.role = role;
  }

  if (roleId !== undefined) {
    if (roleId === null || roleId === '') {
      user.roleId = undefined;
    } else {
      const RoleModel = require('../models/Role').default;
      const validRole = await RoleModel.findById(roleId);
      if (!validRole) {
        return next(new AppError('Invalid Role ID provided', 400));
      }
      user.roleId = roleId;
    }
  }

  if (password) {
    user.password = password; // Will be hashed by pre-save hook
  }

  await user.save();

  // If role is now ServicePartner, ensure profile exists
  if (user.role === 'ServicePartner') {
    const ServicePartnerModel = require('../models/ServicePartner').default;
    const existingPartner = await ServicePartnerModel.findOne({ phone: user.phone });
    if (!existingPartner) {
      await ServicePartnerModel.create({
        name: user.name,
        phone: user.phone,
        email: user.email,
        services: [],
        isActive: user.isActive
      });
    } else {
      // Sync basic details if profile exists
      existingPartner.name = user.name;
      existingPartner.phone = user.phone;
      existingPartner.email = user.email;
      existingPartner.isActive = user.isActive;
      await existingPartner.save();
    }
  }

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
        roleId: user.roleId,
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
  if (user.role === 'customer') {
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

