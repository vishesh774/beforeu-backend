import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Plan from '../models/Plan';

// @desc    Get all plans
// @route   GET /api/admin/plans
// @access  Private/Admin
export const getAllPlans = asyncHandler(async (req: Request, res: Response) => {
  const { planStatus } = req.query;
  
  const filter: any = {};
  if (planStatus !== undefined) {
    filter.planStatus = planStatus;
  }

  const plans = await Plan.find(filter)
    .sort({ createdAt: -1 });

  // Transform _id to id for frontend
  const transformedPlans = plans.map(plan => ({
    ...plan.toObject(),
    id: plan._id.toString()
  }));

  res.status(200).json({
    success: true,
    data: {
      plans: transformedPlans
    }
  });
});

// @desc    Get single plan
// @route   GET /api/admin/plans/:id
// @access  Private/Admin
export const getPlan = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const plan = await Plan.findById(id);

  if (!plan) {
    return next(new AppError('Plan not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      plan: {
        ...plan.toObject(),
        id: plan._id.toString()
      }
    }
  });
});

// @desc    Create plan
// @route   POST /api/admin/plans
// @access  Private/Admin
export const createPlan = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { planName, planTitle, planSubTitle, planStatus, allowSOS, totalCredits, services, originalPrice, finalPrice, totalMembers, extraDiscount } = req.body;

  if (!planName || !planName.trim()) {
    return next(new AppError('Plan name is required', 400));
  }

  if (!planTitle || !planTitle.trim()) {
    return next(new AppError('Plan title is required', 400));
  }

  if (!planSubTitle || !planSubTitle.trim()) {
    return next(new AppError('Plan subtitle is required', 400));
  }

  if (originalPrice === undefined || originalPrice === null || originalPrice < 0) {
    return next(new AppError('Valid original price is required', 400));
  }

  if (finalPrice === undefined || finalPrice === null || finalPrice < 0) {
    return next(new AppError('Valid final price is required', 400));
  }

  if (totalMembers === undefined || totalMembers === null || totalMembers < 1) {
    return next(new AppError('Total members must be at least 1', 400));
  }

  if (totalCredits === undefined || totalCredits === null || totalCredits < 0) {
    return next(new AppError('Total credits must be a valid number and cannot be negative', 400));
  }

  if (!Array.isArray(services)) {
    return next(new AppError('Services must be an array', 400));
  }

  // Validate services array
  const validServices = services.filter((service: any) => 
    service.serviceId && 
    service.subServiceId &&
    service.subServiceName &&
    (service.totalCountLimit === undefined || (typeof service.totalCountLimit === 'number' && service.totalCountLimit >= 0))
  );

  // Check for duplicate subServiceIds
  const subServiceIds = validServices.map((s: any) => s.subServiceId);
  if (new Set(subServiceIds).size !== subServiceIds.length) {
    return next(new AppError('Each sub-service can only be added once to a plan', 400));
  }

  const plan = await Plan.create({
    planName: planName.trim(),
    planTitle: planTitle.trim(),
    planSubTitle: planSubTitle.trim(),
    planStatus: planStatus || 'active',
    allowSOS: allowSOS !== undefined ? allowSOS : false,
    totalCredits: totalCredits !== undefined ? totalCredits : 0,
    services: validServices,
    originalPrice,
    finalPrice,
    totalMembers,
    extraDiscount: extraDiscount !== undefined && extraDiscount !== null ? extraDiscount : undefined
  });

  res.status(201).json({
    success: true,
    data: {
      plan: {
        ...plan.toObject(),
        id: plan._id.toString()
      }
    }
  });
});

// @desc    Update plan
// @route   PUT /api/admin/plans/:id
// @access  Private/Admin
export const updatePlan = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;
  const { planName, planTitle, planSubTitle, planStatus, allowSOS, totalCredits, services, originalPrice, finalPrice, totalMembers, extraDiscount } = req.body;

  const plan = await Plan.findById(id);

  if (!plan) {
    return next(new AppError('Plan not found', 404));
  }

  // Update fields if provided
  if (planName !== undefined) {
    if (!planName.trim()) {
      return next(new AppError('Plan name cannot be empty', 400));
    }
    plan.planName = planName.trim();
  }

  if (planTitle !== undefined) {
    if (!planTitle.trim()) {
      return next(new AppError('Plan title cannot be empty', 400));
    }
    plan.planTitle = planTitle.trim();
  }

  if (planSubTitle !== undefined) {
    if (!planSubTitle.trim()) {
      return next(new AppError('Plan subtitle cannot be empty', 400));
    }
    plan.planSubTitle = planSubTitle.trim();
  }

  if (planStatus !== undefined) {
    if (!['active', 'inactive'].includes(planStatus)) {
      return next(new AppError('Plan status must be either "active" or "inactive"', 400));
    }
    plan.planStatus = planStatus;
  }

  if (allowSOS !== undefined) {
    plan.allowSOS = allowSOS;
  }

  if (totalCredits !== undefined) {
    if (totalCredits < 0) {
      return next(new AppError('Total credits cannot be negative', 400));
    }
    plan.totalCredits = totalCredits;
  }

  if (originalPrice !== undefined) {
    if (originalPrice < 0) {
      return next(new AppError('Original price cannot be negative', 400));
    }
    plan.originalPrice = originalPrice;
  }

  if (finalPrice !== undefined) {
    if (finalPrice < 0) {
      return next(new AppError('Final price cannot be negative', 400));
    }
    plan.finalPrice = finalPrice;
  }

  if (totalMembers !== undefined) {
    if (totalMembers < 1) {
      return next(new AppError('Total members must be at least 1', 400));
    }
    plan.totalMembers = totalMembers;
  }

  if (extraDiscount !== undefined) {
    if (extraDiscount === null) {
      plan.extraDiscount = undefined;
    } else if (extraDiscount < 0 || extraDiscount > 100) {
      return next(new AppError('Extra discount must be between 0 and 100', 400));
    } else {
      plan.extraDiscount = extraDiscount;
    }
  }

  if (services !== undefined) {
    if (!Array.isArray(services)) {
      return next(new AppError('Services must be an array', 400));
    }

    // Validate services array
    const validServices = services.filter((service: any) => 
      service.serviceId && 
      service.subServiceId &&
      service.subServiceName &&
      (service.totalCountLimit === undefined || (typeof service.totalCountLimit === 'number' && service.totalCountLimit >= 0))
    );

    // Check for duplicate subServiceIds
    const subServiceIds = validServices.map((s: any) => s.subServiceId);
    if (new Set(subServiceIds).size !== subServiceIds.length) {
      return next(new AppError('Each sub-service can only be added once to a plan', 400));
    }

    plan.services = validServices;
  }

  await plan.save();

  res.status(200).json({
    success: true,
    data: {
      plan: {
        ...plan.toObject(),
        id: plan._id.toString()
      }
    }
  });
});

// @desc    Delete plan
// @route   DELETE /api/admin/plans/:id
// @access  Private/Admin
export const deletePlan = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const plan = await Plan.findById(id);

  if (!plan) {
    return next(new AppError('Plan not found', 404));
  }

  await plan.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Plan deleted successfully'
  });
});

