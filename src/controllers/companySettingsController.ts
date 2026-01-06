import { Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import CompanySettings from '../models/CompanySettings';
import { AdminRequest } from '../middleware/adminAuth';

// @desc    Get company settings
// @route   GET /api/admin/company-settings
// @access  Private/Admin
export const getCompanySettings = asyncHandler(async (_req: AdminRequest, res: Response) => {
    let settings = await CompanySettings.findOne();

    if (!settings) {
        settings = await CompanySettings.create({
            name: "BeforeU",
            address: "",
            phone: "",
            email: "",
            gstNumber: "",
            logoUrl: "",
            invoicePrefix: "BU"
        });
    }

    res.status(200).json({
        success: true,
        data: settings
    });
});

// @desc    Update company settings
// @route   PUT /api/admin/company-settings
// @access  Private/Admin
export const updateCompanySettings = asyncHandler(async (req: AdminRequest, res: Response) => {
    const { name, address, phone, email, gstNumber, logoUrl, invoicePrefix, eula, privacyPolicy } = req.body;

    let settings = await CompanySettings.findOne();

    if (!settings) {
        settings = new CompanySettings();
    }

    if (name !== undefined) settings.name = name;
    if (address !== undefined) settings.address = address;
    if (phone !== undefined) settings.phone = phone;
    if (email !== undefined) settings.email = email;
    if (gstNumber !== undefined) settings.gstNumber = gstNumber;
    if (logoUrl !== undefined) settings.logoUrl = logoUrl;
    if (invoicePrefix !== undefined) settings.invoicePrefix = invoicePrefix;
    if (eula !== undefined) settings.eula = eula;
    if (privacyPolicy !== undefined) settings.privacyPolicy = privacyPolicy;

    await settings.save();

    res.status(200).json({
        success: true,
        data: settings
    });
});
