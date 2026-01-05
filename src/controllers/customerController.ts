import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import User from '../models/User';
import UserCredits from '../models/UserCredits';
import UserPlan from '../models/UserPlan';
import { aggregateUserData, initializeUserRecords } from '../utils/userHelpers';

// @desc    Get all customers with pagination and filters
// @route   GET /api/admin/customers
// @access  Private/Admin
export const getAllCustomers = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
  // Pagination parameters
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Filter parameters
  const isActiveFilter = req.query.isActive as string | undefined;
  const searchQuery = req.query.search as string | undefined;

  // Build filter object - only customers by default
  const filter: any = {};

  if (req.query.role === 'all') {
    // No role filter
  } else {
    filter.role = 'customer';
  }

  // Apply active/inactive filter
  if (isActiveFilter !== undefined) {
    filter.isActive = isActiveFilter === 'true';
  }

  // Apply search filter (name, email, phone)
  if (searchQuery && searchQuery.trim()) {
    const trimmedSearch = searchQuery.trim();
    // Escape special characters for regex
    const escapedSearch = trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = { $regex: escapedSearch, $options: 'i' };

    const orConditions: any[] = [
      { name: searchRegex },
      { email: searchRegex },
      { phone: searchRegex }
    ];

    // If search looks like a phone number (last 10 digits)
    const digitsOnly = trimmedSearch.replace(/\D/g, '');
    if (digitsOnly.length >= 10) {
      const last10 = digitsOnly.slice(-10);
      orConditions.push({ phone: { $regex: last10 + '$' } });
    }

    filter.$or = orConditions;
  }

  // Get total count for pagination
  const total = await User.countDocuments(filter);

  // Get paginated customers
  const customers = await User.find(filter)
    .select('-password')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  // Get credits and plans for all customers in parallel
  const customerIds = customers.map(c => c._id);
  const [creditsMap, plansMap] = await Promise.all([
    UserCredits.find({ userId: { $in: customerIds } }).then(credits => {
      const map: Record<string, number> = {};
      credits.forEach(c => { map[c.userId.toString()] = c.credits; });
      return map;
    }),
    UserPlan.find({ userId: { $in: customerIds } }).then(plans => {
      const map: Record<string, string | undefined> = {};
      plans.forEach(p => { map[p.userId.toString()] = p.activePlanId || undefined; });
      return map;
    })
  ]);

  res.status(200).json({
    success: true,
    data: {
      customers: customers.map(customer => ({
        id: customer._id.toString(),
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        isActive: customer.isActive,
        credits: creditsMap[customer._id.toString()] || 0,
        activePlanId: plansMap[customer._id.toString()],
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt
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

// @desc    Get single customer by ID
// @route   GET /api/admin/customers/:id
// @access  Private/Admin
export const getCustomer = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const customer = await User.findById(id);

  if (!customer) {
    return next(new AppError('Customer not found', 404));
  }

  // Check if user is a customer
  if (customer.role !== 'customer') {
    return next(new AppError('User is not a customer', 404));
  }

  // Aggregate customer data
  const customerData = await aggregateUserData(customer._id);
  if (!customerData) {
    return next(new AppError('Failed to load customer data', 500));
  }

  res.status(200).json({
    success: true,
    data: {
      customer: customerData
    }
  });
});

// @desc    Toggle customer active status (disable/enable)
// @route   PATCH /api/admin/customers/:id/toggle-status
// @access  Private/Admin
export const toggleCustomerStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const customer = await User.findById(id);

  if (!customer) {
    return next(new AppError('Customer not found', 404));
  }

  // Check if user is a customer
  if (customer.role !== 'customer') {
    return next(new AppError('User is not a customer', 404));
  }

  // Toggle active status
  customer.isActive = !customer.isActive;
  await customer.save();

  // Aggregate customer data
  const customerData = await aggregateUserData(customer._id);
  if (!customerData) {
    return next(new AppError('Failed to load customer data', 500));
  }

  res.status(200).json({
    success: true,
    message: `Customer ${customer.isActive ? 'activated' : 'deactivated'} successfully`,
    data: {
      customer: customerData
    }
  });
});

// @desc    Add a new customer
// @route   POST /api/admin/customers
// @access  Private/Admin
export const addCustomer = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { name, phone, email } = req.body;

  if (!name || !phone) {
    return next(new AppError('Name and phone number are required', 400));
  }

  // Format phone number: ensure country code is present (default +91)
  // Strict validation: Must extract exactly 10 digits
  let cleanPhone = phone.replace(/[^0-9+]/g, ''); // Keep + for check

  // Normalize to 10 digits
  if (cleanPhone.startsWith('+91')) {
    cleanPhone = cleanPhone.slice(3);
  } else if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
    cleanPhone = cleanPhone.slice(2);
  }

  // Final check: must be exactly 10 digits
  if (!/^\d{10}$/.test(cleanPhone)) {
    return next(new AppError('Phone number must be exactly 10 digits', 400));
  }

  let formattedPhone = '+91' + cleanPhone;

  // Check if phone already exists
  const existingPhone = await User.findOne({ phone: formattedPhone });
  if (existingPhone) {
    return next(new AppError(`Customer with phone ${formattedPhone} already exists`, 400));
  }

  // Check if email already exists (if provided)
  if (email) {
    const existingEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
      return next(new AppError(`Customer with email ${email} already exists`, 400));
    }
  }

  // Create user
  // Password is required by model, but for admin-created customers who login via OTP,
  // we can set a random strong password that they won't know/need.
  const randomPassword = Math.random().toString(36).slice(-8) + 'Aa1@';

  const user = await User.create({
    name,
    phone: formattedPhone,
    email: email ? email.toLowerCase() : undefined,
    password: randomPassword,
    role: 'customer',
    isActive: true
  });

  // Initialize credits and plan records
  await initializeUserRecords(user._id);

  // Aggregate customer data
  const userData = await aggregateUserData(user._id);
  if (!userData) {
    return next(new AppError('Failed to create customer data', 500));
  }

  res.status(201).json({
    success: true,
    message: 'Customer added successfully',
    data: {
      customer: userData
    }
  });
});
