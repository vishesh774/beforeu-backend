import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import CheckoutField from '../models/CheckoutField';
import AppConfig from '../models/AppConfig';
import { AdminRequest } from '../middleware/adminAuth';

// @desc    Get app configuration (public endpoint)
// @route   GET /api/config
// @access  Public
// @note    This is a generic config endpoint. checkoutFields is one of the keys.
//          More keys can be added in the future for other app configurations.
export const getAppConfig = asyncHandler(async (_req: Request, res: Response) => {
  // Get only active checkout fields, sorted by order
  const checkoutFields = await CheckoutField.find({ isActive: true })
    .sort({ order: 1 })
    .select('fieldName fieldDisplayName chargeType value order');

  // Transform _id to id for frontend
  const transformedFields = checkoutFields.map(field => ({
    ...field.toObject(),
    id: field._id.toString()
  }));

  // Get AppConfig (singleton)
  const appConfig = await AppConfig.findOne();

  // Generic config response structure - can be extended with more keys in the future
  res.status(200).json({
    success: true,
    data: {
      checkoutFields: transformedFields,
      // Add bookingStartDate
      bookingStartDate: appConfig?.bookingStartDate || null
      // Future keys can be added here
    }
  });
});

// @desc    Update app configuration (Admin)
// @route   PUT /api/admin/config
// @access  Private/Admin
export const updateAppConfig = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { bookingStartDate } = req.body;

  let appConfig = await AppConfig.findOne();

  if (!appConfig) {
    appConfig = new AppConfig();
  }

  if (bookingStartDate !== undefined) {
    appConfig.bookingStartDate = bookingStartDate ? new Date(bookingStartDate) : undefined;
  }

  await appConfig.save();

  res.status(200).json({
    success: true,
    data: {
      bookingStartDate: appConfig.bookingStartDate
    }
  });
});

