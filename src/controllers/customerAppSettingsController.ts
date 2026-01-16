import { Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import CustomerAppSettings from '../models/CustomerAppSettings';
import { AdminRequest } from '../middleware/adminAuth';

// @desc    Get customer app settings
// @route   GET /api/admin/customer-app-settings
// @access  Private/Admin
export const getCustomerAppSettings = asyncHandler(async (_req: AdminRequest, res: Response) => {
    let settings = await CustomerAppSettings.findOne();

    if (!settings) {
        settings = await CustomerAppSettings.create({
            maxFreeSosCount: 0
        });
    }

    res.status(200).json({
        success: true,
        data: settings
    });
});

// @desc    Update customer app settings
// @route   PUT /api/admin/customer-app-settings
// @access  Private/Admin
export const updateCustomerAppSettings = asyncHandler(async (req: AdminRequest, res: Response) => {
    const { maxFreeSosCount } = req.body;

    let settings = await CustomerAppSettings.findOne();

    if (!settings) {
        settings = new CustomerAppSettings();
    }

    if (maxFreeSosCount !== undefined) settings.maxFreeSosCount = maxFreeSosCount;

    await settings.save();

    res.status(200).json({
        success: true,
        data: settings
    });
});
