import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import CheckoutField from '../models/CheckoutField';

// @desc    Get checkout configuration (public endpoint)
// @route   GET /api/config
// @access  Public
export const getCheckoutConfig = asyncHandler(async (_req: Request, res: Response) => {
  // Get only active checkout fields, sorted by order
  const checkoutFields = await CheckoutField.find({ isActive: true })
    .sort({ order: 1 })
    .select('fieldName fieldDisplayName chargeType value order');

  // Transform _id to id for frontend
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

