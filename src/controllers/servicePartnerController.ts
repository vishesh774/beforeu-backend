import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import ServicePartner from '../models/ServicePartner';
import User from '../models/User';
import { initializeUserRecords } from '../utils/userHelpers';

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
    filter.$or = [
      { name: { $regex: searchQuery.trim(), $options: 'i' } },
      { phone: { $regex: searchQuery.trim(), $options: 'i' } },
      { email: { $regex: searchQuery.trim(), $options: 'i' } }
    ];
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
  const { name, phone, email, services, serviceRegions, availability, isActive } = req.body;

  // Validate required fields
  if (!name || !phone || !services || !Array.isArray(services) || services.length === 0) {
    return next(new AppError('Name, phone, and at least one service are required', 400));
  }

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

  // Create service partner
  const servicePartner = await ServicePartner.create({
    name,
    phone,
    email,
    services,
    serviceRegions: serviceRegions || [],
    availability: availability || [],
    isActive: isActive !== undefined ? isActive : true
  });

  // Create user account for the service partner
  // Generate a default password (phone number as password for now, can be changed later)
  const defaultPassword = phone.slice(-6); // Last 6 digits of phone as default password
  const partnerUser = await User.create({
    name,
    phone,
    email: email || '',
    password: defaultPassword,
    role: 'ServicePartner',
    isActive: isActive !== undefined ? isActive : true
  });

  // Initialize user-related records (credits and plan)
  await initializeUserRecords(partnerUser._id);

  res.status(201).json({
    success: true,
    message: 'Service partner created successfully',
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

// @desc    Update service partner
// @route   PUT /api/admin/service-partners/:id
// @access  Private/Admin
export const updateServicePartner = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { name, phone, email, services, serviceRegions, availability, isActive } = req.body;

  const servicePartner = await ServicePartner.findById(id);
  if (!servicePartner) {
    return next(new AppError('Service partner not found', 404));
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

  await servicePartner.save();

  // Update user account for the service partner
  const partnerUser = await User.findOne({ phone: servicePartner.phone, role: 'ServicePartner' });
  if (partnerUser) {
    if (name) partnerUser.name = name;
    if (phone) partnerUser.phone = phone;
    if (email !== undefined) partnerUser.email = email || '';
    if (typeof isActive === 'boolean') partnerUser.isActive = isActive;
    await partnerUser.save();
  }

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

