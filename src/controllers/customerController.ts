import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import User from '../models/User';
import UserCredits from '../models/UserCredits';
import UserPlan from '../models/UserPlan';
import { aggregateUserData } from '../utils/userHelpers';

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

  // Build filter object - only customers
  const filter: any = {
    role: 'customer'
  };

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

