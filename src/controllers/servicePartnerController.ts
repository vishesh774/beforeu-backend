import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import ServicePartner from '../models/ServicePartner';
import User from '../models/User';
import UserCredits from '../models/UserCredits';
import UserPlan from '../models/UserPlan';
import { normalizePhone } from '../utils/phoneUtils';

// @desc    Get all service partners with pagination and filters
// @route   GET /api/admin/service-partners
// @access  Private/Admin
export const getAllServicePartners = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
  // Pagination parameters
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Filter parameters
  const searchQuery = req.query.search as string | undefined;
  const isActiveFilter = req.query.isActive as string | undefined;
  const serviceFilter = req.query.service as string | undefined;
  const regionFilter = req.query.region as string | undefined;

  // Build filter object
  const filter: any = {};

  // Apply search filter (name, phone, email)
  if (searchQuery && searchQuery.trim()) {
    const trimmedQuery = searchQuery.trim();
    // Escape special characters for regex
    const escapedSearch = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = { $regex: escapedSearch, $options: 'i' };

    const orConditions: any[] = [
      { name: searchRegex },
      { phone: searchRegex },
      { email: searchRegex }
    ];

    // If search looks like a phone number (last 10 digits)
    const digitsOnly = trimmedQuery.replace(/\D/g, '');
    if (digitsOnly.length >= 10) {
      const last10 = digitsOnly.slice(-10);
      orConditions.push({ phone: { $regex: last10 + '$' } });
    }

    filter.$or = orConditions;
  }

  // Apply isActive filter
  if (isActiveFilter !== undefined) {
    filter.isActive = isActiveFilter === 'true';
  }

  // Apply service filter
  if (serviceFilter) {
    filter.services = { $in: [serviceFilter] };
  }

  // Apply region filter
  if (regionFilter) {
    filter.serviceRegions = { $in: [regionFilter] };
  }

  // Get total count for pagination
  const total = await ServicePartner.countDocuments(filter);

  // Get paginated service partners
  const servicePartners = await ServicePartner.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json({
    success: true,
    data: {
      servicePartners: servicePartners.map(partner => ({
        id: partner._id,
        name: partner.name,
        phone: partner.phone,
        email: partner.email,
        services: partner.services,
        serviceRegions: partner.serviceRegions,
        availability: partner.availability,
        isActive: partner.isActive,
        createdAt: partner.createdAt,
        updatedAt: partner.updatedAt
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

// @desc    Get single service partner by ID
// @route   GET /api/admin/service-partners/:id
// @access  Private/Admin
export const getServicePartner = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const servicePartner = await ServicePartner.findById(id);
  if (!servicePartner) {
    return next(new AppError('Service partner not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      servicePartner: {
        id: servicePartner._id,
        name: servicePartner.name,
        phone: servicePartner.phone,
        email: servicePartner.email,
        services: servicePartner.services,
        serviceRegions: servicePartner.serviceRegions,
        availability: servicePartner.availability,
        isActive: servicePartner.isActive,
        createdAt: servicePartner.createdAt,
        updatedAt: servicePartner.updatedAt
      }
    }
  });
});

// @desc    Create new service partner
// @route   POST /api/admin/service-partners
// @access  Private/Admin
export const createServicePartner = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  let { name, phone, email, services, serviceRegions, availability, isActive } = req.body;

  // Validate required fields
  if (!name || !phone || !services || !Array.isArray(services) || services.length === 0) {
    return next(new AppError('Name, phone, and at least one service are required', 400));
  }

  // Normalize phone number
  phone = normalizePhone(phone);

  // Check if partner with this phone already exists
  const existingPartner = await ServicePartner.findOne({ phone });
  if (existingPartner) {
    return next(new AppError('Service partner with this phone number already exists', 400));
  }

  // Check if user with this phone already exists
  const existingUser = await User.findOne({ phone });
  if (existingUser) {
    return next(new AppError('User with this phone number already exists', 400));
  }

  // Check if email is provided and if it already exists (before creating anything)
  if (email && email.trim()) {
    const trimmedEmail = email.trim().toLowerCase();
    const existingEmailUser = await User.findOne({ email: trimmedEmail });
    if (existingEmailUser) {
      return next(new AppError('User with this email already exists', 400));
    }
  }

  // Validate availability if provided
  if (availability && Array.isArray(availability)) {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (const avail of availability) {
      if (!days.includes(avail.day)) {
        return next(new AppError(`Invalid day: ${avail.day}`, 400));
      }
      if (!/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(avail.startTime)) {
        return next(new AppError(`Invalid start time format: ${avail.startTime}`, 400));
      }
      if (!/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(avail.endTime)) {
        return next(new AppError(`Invalid end time format: ${avail.endTime}`, 400));
      }
    }
  }

  // Use MongoDB transaction to ensure atomicity - all or nothing
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Create service partner within transaction
    const servicePartner = await ServicePartner.create([{
      name,
      phone,
      email,
      services,
      serviceRegions: serviceRegions || [],
      availability: availability || [],
      isActive: isActive !== undefined ? isActive : true
    }], { session });

    // Create user account for the service partner within transaction
    // Generate a default password (phone number as password for now, can be changed later)
    const defaultPassword = phone.slice(-6); // Last 6 digits of phone as default password
    const partnerUser = await User.create([{
      name,
      phone,
      email: email && email.trim() ? email.trim().toLowerCase() : undefined, // Use undefined instead of empty string for sparse unique index
      password: defaultPassword,
      role: 'ServicePartner',
      isActive: isActive !== undefined ? isActive : true
    }], { session });

    // Initialize user-related records (credits and plan) within transaction
    const userId = partnerUser[0]._id;
    await Promise.all([
      UserCredits.findOneAndUpdate(
        { userId },
        { credits: 0 },
        { upsert: true, new: true, session }
      ),
      UserPlan.findOneAndUpdate(
        { userId },
        { activePlanId: null },
        { upsert: true, new: true, session }
      )
    ]);

    // Commit transaction if everything succeeds
    await session.commitTransaction();

    // Extract the created documents (create returns array when using session)
    const createdServicePartner = servicePartner[0];

    res.status(201).json({
      success: true,
      message: 'Service partner created successfully',
      data: {
        servicePartner: {
          id: createdServicePartner._id,
          name: createdServicePartner.name,
          phone: createdServicePartner.phone,
          email: createdServicePartner.email,
          services: createdServicePartner.services,
          serviceRegions: createdServicePartner.serviceRegions,
          availability: createdServicePartner.availability,
          isActive: createdServicePartner.isActive,
          createdAt: createdServicePartner.createdAt,
          updatedAt: createdServicePartner.updatedAt
        }
      }
    });
  } catch (error: any) {
    // Abort transaction on any error - this will rollback all changes
    await session.abortTransaction();

    // Handle specific error types
    if (error.code === 11000) {
      // Duplicate key error
      const field = Object.keys(error.keyPattern || {})[0] || 'field';
      return next(new AppError(`${field.charAt(0).toUpperCase() + field.slice(1)} already exists`, 400));
    }

    // Re-throw other errors to be handled by error handler
    throw error;
  } finally {
    // End session
    await session.endSession();
  }
});

// @desc    Update service partner
// @route   PUT /api/admin/service-partners/:id
// @access  Private/Admin
export const updateServicePartner = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  let { name, phone, email, services, serviceRegions, availability, isActive } = req.body;

  const servicePartner = await ServicePartner.findById(id);
  if (!servicePartner) {
    return next(new AppError('Service partner not found', 404));
  }

  // Normalize phone number if provided
  if (phone) {
    phone = normalizePhone(phone);
  }

  // Update fields
  if (name) servicePartner.name = name;
  if (phone) {
    // Check if phone is already taken by another partner
    const existingPartner = await ServicePartner.findOne({ phone, _id: { $ne: id } });
    if (existingPartner) {
      return next(new AppError('Service partner with this phone number already exists', 400));
    }
    // Check if phone is already taken by a user (unless it's the same service partner's user)
    const existingUser = await User.findOne({ phone, role: 'ServicePartner' });
    if (existingUser) {
      // Check if this user belongs to a different service partner
      const partnerForUser = await ServicePartner.findOne({ phone: existingUser.phone });
      if (partnerForUser && partnerForUser._id.toString() !== id) {
        return next(new AppError('User with this phone number already exists', 400));
      }
    } else {
      // Check if any user (non-service partner) has this phone
      const anyUser = await User.findOne({ phone, role: { $ne: 'ServicePartner' } });
      if (anyUser) {
        return next(new AppError('User with this phone number already exists', 400));
      }
    }
    servicePartner.phone = phone;
  }
  // Validate email if being changed (before starting transaction)
  if (email !== undefined && email && email.trim()) {
    const trimmedEmail = email.trim().toLowerCase();
    const partnerUser = await User.findOne({ phone: servicePartner.phone, role: 'ServicePartner' });
    // Check if email is already taken by another user (excluding current partner's user)
    const existingEmailUser = await User.findOne({
      email: trimmedEmail,
      _id: partnerUser ? { $ne: partnerUser._id } : { $exists: true }
    });
    if (existingEmailUser) {
      return next(new AppError('User with this email already exists', 400));
    }
  }

  if (email !== undefined) servicePartner.email = email;
  if (services) {
    if (!Array.isArray(services) || services.length === 0) {
      return next(new AppError('At least one service must be selected', 400));
    }
    servicePartner.services = services;
  }
  if (serviceRegions !== undefined) {
    servicePartner.serviceRegions = serviceRegions;
  }
  if (availability) {
    // Validate availability
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (const avail of availability) {
      if (!days.includes(avail.day)) {
        return next(new AppError(`Invalid day: ${avail.day}`, 400));
      }
      if (!/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(avail.startTime)) {
        return next(new AppError(`Invalid start time format: ${avail.startTime}`, 400));
      }
      if (!/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(avail.endTime)) {
        return next(new AppError(`Invalid end time format: ${avail.endTime}`, 400));
      }
    }
    servicePartner.availability = availability;
  }
  if (typeof isActive === 'boolean') servicePartner.isActive = isActive;

  // Use MongoDB transaction to ensure atomicity
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await servicePartner.save({ session });

    // Update user account for the service partner within transaction
    const partnerUser = await User.findOne({ phone: servicePartner.phone, role: 'ServicePartner' });
    if (partnerUser) {
      if (name) partnerUser.name = name;
      if (phone) partnerUser.phone = phone;
      if (email !== undefined) partnerUser.email = email && email.trim() ? email.trim().toLowerCase() : undefined; // Use undefined instead of empty string for sparse unique index
      if (typeof isActive === 'boolean') partnerUser.isActive = isActive;
      await partnerUser.save({ session });
    }

    // Commit transaction if everything succeeds
    await session.commitTransaction();
  } catch (error: any) {
    // Abort transaction on any error - this will rollback all changes
    await session.abortTransaction();

    // Handle specific error types
    if (error.code === 11000) {
      // Duplicate key error
      const field = Object.keys(error.keyPattern || {})[0] || 'field';
      return next(new AppError(`${field.charAt(0).toUpperCase() + field.slice(1)} already exists`, 400));
    }

    // Re-throw other errors to be handled by error handler
    throw error;
  } finally {
    // End session
    await session.endSession();
  }

  // Send response after successful transaction
  res.status(200).json({
    success: true,
    message: 'Service partner updated successfully',
    data: {
      servicePartner: {
        id: servicePartner._id,
        name: servicePartner.name,
        phone: servicePartner.phone,
        email: servicePartner.email,
        services: servicePartner.services,
        serviceRegions: servicePartner.serviceRegions,
        availability: servicePartner.availability,
        isActive: servicePartner.isActive,
        createdAt: servicePartner.createdAt,
        updatedAt: servicePartner.updatedAt
      }
    }
  });
});

// @desc    Toggle service partner active status
// @route   PATCH /api/admin/service-partners/:id/toggle-status
// @access  Private/Admin
export const toggleServicePartnerStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const servicePartner = await ServicePartner.findById(id);
  if (!servicePartner) {
    return next(new AppError('Service partner not found', 404));
  }

  servicePartner.isActive = !servicePartner.isActive;
  await servicePartner.save();

  res.status(200).json({
    success: true,
    message: `Service partner ${servicePartner.isActive ? 'activated' : 'deactivated'} successfully`,
    data: {
      servicePartner: {
        id: servicePartner._id,
        name: servicePartner.name,
        phone: servicePartner.phone,
        email: servicePartner.email,
        services: servicePartner.services,
        serviceRegions: servicePartner.serviceRegions,
        availability: servicePartner.availability,
        isActive: servicePartner.isActive,
        createdAt: servicePartner.createdAt,
        updatedAt: servicePartner.updatedAt
      }
    }
  });
});

