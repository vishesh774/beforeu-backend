import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { AdminRequest } from '../middleware/adminAuth';
import CheckoutField from '../models/CheckoutField';

// @desc    Get all checkout fields
// @route   GET /api/admin/checkout-config
// @access  Private/Admin
export const getAllCheckoutFields = asyncHandler(async (_req: Request, res: Response) => {
  const checkoutFields = await CheckoutField.find()
    .sort({ order: 1, createdAt: -1 });

  const transformedFields = checkoutFields.map(field => ({
    ...field.toObject(),
    id: field._id.toString()
  }));

  res.status(200).json({
    success: true,
    data: {
      checkoutFields: transformedFields
    }
  });
});

// @desc    Get single checkout field
// @route   GET /api/admin/checkout-config/:id
// @access  Private/Admin
export const getCheckoutField = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const checkoutField = await CheckoutField.findById(id);

  if (!checkoutField) {
    return next(new AppError('Checkout field not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      checkoutField: {
        ...checkoutField.toObject(),
        id: checkoutField._id.toString()
      }
    }
  });
});

// @desc    Create checkout field
// @route   POST /api/admin/checkout-config
// @access  Private/Admin
export const createCheckoutField = asyncHandler(async (req: AdminRequest, res: Response, next: any) => {
  const { fieldName, fieldDisplayName, chargeType, value, isActive, order } = req.body;

  // Validation
  if (!fieldName || !fieldName.trim()) {
    return next(new AppError('Field name is required', 400));
  }

  if (!fieldDisplayName || !fieldDisplayName.trim()) {
    return next(new AppError('Field display name is required', 400));
  }

  if (!chargeType || !['fixed', 'percentage'].includes(chargeType)) {
    return next(new AppError('Charge type must be either "fixed" or "percentage"', 400));
  }

  if (value === undefined || value === null || value < 0) {
    return next(new AppError('Valid value is required and cannot be negative', 400));
  }

  // Validate percentage value
  if (chargeType === 'percentage' && value > 100) {
    return next(new AppError('Percentage value cannot exceed 100', 400));
  }

  // Check if fieldName already exists
  const existingField = await CheckoutField.findOne({ fieldName: fieldName.toLowerCase().trim() });
  if (existingField) {
    return next(new AppError('Field name already exists', 400));
  }

  const checkoutField = await CheckoutField.create({
    fieldName: fieldName.toLowerCase().trim(),
    fieldDisplayName: fieldDisplayName.trim(),
    chargeType,
    value,
    isActive: isActive !== undefined ? isActive : true,
    order: order !== undefined ? order : 0
  });

  res.status(201).json({
    success: true,
    data: {
      checkoutField: {
        ...checkoutField.toObject(),
        id: checkoutField._id.toString()
      }
    }
  });
});

// @desc    Update checkout field
// @route   PUT /api/admin/checkout-config/:id
// @access  Private/Admin
export const updateCheckoutField = asyncHandler(async (req: AdminRequest, res: Response, next: any) => {
  const { id } = req.params;
  const { fieldName, fieldDisplayName, chargeType, value, isActive, order } = req.body;

  const checkoutField = await CheckoutField.findById(id);

  if (!checkoutField) {
    return next(new AppError('Checkout field not found', 404));
  }

  // Validation
  if (fieldName !== undefined) {
    if (!fieldName.trim()) {
      return next(new AppError('Field name cannot be empty', 400));
    }
    // Check if fieldName already exists (excluding current field)
    const existingField = await CheckoutField.findOne({
      fieldName: fieldName.toLowerCase().trim(),
      _id: { $ne: id }
    });
    if (existingField) {
      return next(new AppError('Field name already exists', 400));
    }
    checkoutField.fieldName = fieldName.toLowerCase().trim();
  }

  if (fieldDisplayName !== undefined) {
    if (!fieldDisplayName.trim()) {
      return next(new AppError('Field display name cannot be empty', 400));
    }
    checkoutField.fieldDisplayName = fieldDisplayName.trim();
  }

  if (chargeType !== undefined) {
    if (!['fixed', 'percentage'].includes(chargeType)) {
      return next(new AppError('Charge type must be either "fixed" or "percentage"', 400));
    }
    checkoutField.chargeType = chargeType;
  }

  if (value !== undefined) {
    if (value < 0) {
      return next(new AppError('Value cannot be negative', 400));
    }
    // Validate percentage value
    if ((chargeType || checkoutField.chargeType) === 'percentage' && value > 100) {
      return next(new AppError('Percentage value cannot exceed 100', 400));
    }
    checkoutField.value = value;
  }

  if (isActive !== undefined) {
    checkoutField.isActive = isActive;
  }

  if (order !== undefined) {
    if (order < 0) {
      return next(new AppError('Order cannot be negative', 400));
    }
    checkoutField.order = order;
  }

  await checkoutField.save();

  res.status(200).json({
    success: true,
    data: {
      checkoutField: {
        ...checkoutField.toObject(),
        id: checkoutField._id.toString()
      }
    }
  });
});

// @desc    Delete checkout field
// @route   DELETE /api/admin/checkout-config/:id
// @access  Private/Admin
export const deleteCheckoutField = asyncHandler(async (req: AdminRequest, res: Response, next: any) => {
  const { id } = req.params;

  const checkoutField = await CheckoutField.findById(id);

  if (!checkoutField) {
    return next(new AppError('Checkout field not found', 404));
  }

  await CheckoutField.deleteOne({ _id: id });

  res.status(200).json({
    success: true,
    message: 'Checkout field deleted successfully'
  });
});

// @desc    Toggle checkout field active status
// @route   PATCH /api/admin/checkout-config/:id/toggle-status
// @access  Private/Admin
export const toggleCheckoutFieldStatus = asyncHandler(async (req: AdminRequest, res: Response, next: any) => {
  const { id } = req.params;

  const checkoutField = await CheckoutField.findById(id);

  if (!checkoutField) {
    return next(new AppError('Checkout field not found', 404));
  }

  checkoutField.isActive = !checkoutField.isActive;
  await checkoutField.save();

  res.status(200).json({
    success: true,
    data: {
      checkoutField: {
        ...checkoutField.toObject(),
        id: checkoutField._id.toString()
      }
    }
  });
});

