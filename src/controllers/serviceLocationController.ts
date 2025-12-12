import { Response } from 'express';
import ServiceLocation from '../models/ServiceLocation';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

// @desc    Create a new service location
// @route   POST /api/admin/service-locations
// @access  Private/Admin
export const createServiceLocation = async (req: AuthRequest, res: Response) => {
    try {
        const serviceLocation = await ServiceLocation.create(req.body);
        res.status(201).json({
            success: true,
            data: serviceLocation
        });
    } catch (error: any) {
        // Check for duplicate key error if we had unique constraints (none strict on name currently)
        res.status(400).json({
            success: false,
            error: error.message || 'Failed to create service location'
        });
    }
};

// @desc    Get all service locations
// @route   GET /api/admin/service-locations
// @access  Private/Admin
export const getAllServiceLocations = async (req: AuthRequest, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;

        const { isActive, city, search } = req.query;
        const query: any = {};

        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        if (city) {
            query['address.city'] = { $regex: city, $options: 'i' };
        }

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { tags: { $regex: search, $options: 'i' } }
            ];
        }

        const total = await ServiceLocation.countDocuments(query);

        const serviceLocations = await ServiceLocation.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            success: true,
            data: {
                serviceLocations,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch service locations'
        });
    }
};

// @desc    Get single service location
// @route   GET /api/admin/service-locations/:id
// @access  Private/Admin
export const getServiceLocationById = async (req: AuthRequest, res: Response, next: any) => {
    try {
        const serviceLocation = await ServiceLocation.findById(req.params.id)
            .populate('services.serviceId', 'name')
            .populate('services.subServiceIds', 'name');;

        if (!serviceLocation) {
            return next(new AppError('Service location not found', 404));
        }

        res.status(200).json({
            success: true,
            data: serviceLocation
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch service location'
        });
    }
};

// @desc    Update service location
// @route   PUT /api/admin/service-locations/:id
// @access  Private/Admin
export const updateServiceLocation = async (req: AuthRequest, res: Response, next: any) => {
    try {
        const serviceLocation = await ServiceLocation.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!serviceLocation) {
            return next(new AppError('Service location not found', 404));
        }

        res.status(200).json({
            success: true,
            data: serviceLocation
        });
    } catch (error: any) {
        res.status(400).json({
            success: false,
            error: error.message || 'Failed to update service location'
        });
    }
};

// @desc    Toggle service location status
// @route   PATCH /api/admin/service-locations/:id/toggle-status
// @access  Private/Admin
export const toggleServiceLocationStatus = async (req: AuthRequest, res: Response, next: any) => {
    try {
        const serviceLocation = await ServiceLocation.findById(req.params.id);

        if (!serviceLocation) {
            return next(new AppError('Service location not found', 404));
        }

        serviceLocation.isActive = !serviceLocation.isActive;
        await serviceLocation.save();

        res.status(200).json({
            success: true,
            data: serviceLocation
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to toggle status'
        });
    }
};
