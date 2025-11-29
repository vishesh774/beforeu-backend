import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import ServiceRegion, { IPoint } from '../models/ServiceRegion';
import { isPointInPolygon } from '../utils/pointInPolygon';

// @desc    Get all service regions with pagination and filters
// @route   GET /api/admin/service-regions
// @access  Private/Admin
export const getAllServiceRegions = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
  // Pagination parameters
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Filter parameters
  const cityFilter = req.query.city as string | undefined;
  const isActiveFilter = req.query.isActive as string | undefined;
  const searchQuery = req.query.search as string | undefined;

  // Build filter object
  const filter: any = {};

  // Apply city filter
  if (cityFilter && cityFilter.trim()) {
    filter.city = { $regex: cityFilter.trim(), $options: 'i' };
  }

  // Apply active/inactive filter
  if (isActiveFilter !== undefined) {
    filter.isActive = isActiveFilter === 'true';
  }

  // Apply search filter (name or city)
  if (searchQuery && searchQuery.trim()) {
    const searchRegex = { $regex: searchQuery.trim(), $options: 'i' };
    filter.$or = [
      { name: searchRegex },
      { city: searchRegex }
    ];
  }

  // Get total count for pagination
  const total = await ServiceRegion.countDocuments(filter);

  // Get paginated regions
  // We need polygon field to get its length, but we'll only return the count
  const regions = await ServiceRegion.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json({
    success: true,
    data: {
      regions: regions.map(region => ({
        id: region._id,
        name: region.name,
        city: region.city,
        isActive: region.isActive,
        pointCount: region.polygon?.length || 0, // Return point count instead of full polygon
        createdAt: region.createdAt,
        updatedAt: region.updatedAt
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

// @desc    Get single service region by ID
// @route   GET /api/admin/service-regions/:id
// @access  Private/Admin
export const getServiceRegion = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const region = await ServiceRegion.findById(id);
  if (!region) {
    return next(new AppError('Service region not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      region: {
        id: region._id,
        name: region.name,
        city: region.city,
        polygon: region.polygon,
        isActive: region.isActive,
        createdAt: region.createdAt,
        updatedAt: region.updatedAt
      }
    }
  });
});

// @desc    Create new service region
// @route   POST /api/admin/service-regions
// @access  Private/Admin
export const createServiceRegion = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { name, city, polygon } = req.body;

  // Validate required fields
  if (!name || !city || !polygon) {
    return next(new AppError('Name, city, and polygon are required', 400));
  }

  // Validate polygon
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return next(new AppError('Polygon must have at least 3 points', 400));
  }

  // Validate each point has lat and lng
  for (const point of polygon) {
    if (typeof point.lat !== 'number' || typeof point.lng !== 'number') {
      return next(new AppError('Each polygon point must have valid lat and lng', 400));
    }
  }

  // Create region
  const region = await ServiceRegion.create({
    name,
    city,
    polygon: polygon as IPoint[],
    isActive: true
  });

  res.status(201).json({
    success: true,
    message: 'Service region created successfully',
    data: {
      region: {
        id: region._id,
        name: region.name,
        city: region.city,
        polygon: region.polygon,
        isActive: region.isActive,
        createdAt: region.createdAt,
        updatedAt: region.updatedAt
      }
    }
  });
});

// @desc    Update service region
// @route   PUT /api/admin/service-regions/:id
// @access  Private/Admin
export const updateServiceRegion = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { name, city, polygon } = req.body;

  const region = await ServiceRegion.findById(id);
  if (!region) {
    return next(new AppError('Service region not found', 404));
  }

  // Update fields
  if (name) region.name = name;
  if (city) region.city = city;
  if (polygon) {
    // Validate polygon
    if (!Array.isArray(polygon) || polygon.length < 3) {
      return next(new AppError('Polygon must have at least 3 points', 400));
    }

    // Validate each point
    for (const point of polygon) {
      if (typeof point.lat !== 'number' || typeof point.lng !== 'number') {
        return next(new AppError('Each polygon point must have valid lat and lng', 400));
      }
    }

    region.polygon = polygon as IPoint[];
  }

  await region.save();

  res.status(200).json({
    success: true,
    message: 'Service region updated successfully',
    data: {
      region: {
        id: region._id,
        name: region.name,
        city: region.city,
        polygon: region.polygon,
        isActive: region.isActive,
        createdAt: region.createdAt,
        updatedAt: region.updatedAt
      }
    }
  });
});

// @desc    Toggle service region active status
// @route   PATCH /api/admin/service-regions/:id/toggle-status
// @access  Private/Admin
export const toggleServiceRegionStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const region = await ServiceRegion.findById(id);
  if (!region) {
    return next(new AppError('Service region not found', 404));
  }

  region.isActive = !region.isActive;
  await region.save();

  res.status(200).json({
    success: true,
    message: `Service region ${region.isActive ? 'activated' : 'deactivated'} successfully`,
    data: {
      region: {
        id: region._id,
        name: region.name,
        city: region.city,
        isActive: region.isActive,
        createdAt: region.createdAt,
        updatedAt: region.updatedAt
      }
    }
  });
});

// @desc    Check if a point is within any active service region
// @route   POST /api/admin/service-regions/check-point
// @access  Private/Admin
export const checkPointInRegion = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { lat, lng } = req.body;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return next(new AppError('Valid lat and lng are required', 400));
  }

  // Get all active regions
  const activeRegions = await ServiceRegion.find({ isActive: true });

  // Check which regions contain this point
  const matchingRegions = activeRegions.filter(region => 
    isPointInPolygon({ lat, lng }, region.polygon)
  ).map(region => ({
    id: region._id,
    name: region.name,
    city: region.city
  }));

  res.status(200).json({
    success: true,
    data: {
      point: { lat, lng },
      isServiceable: matchingRegions.length > 0,
      regions: matchingRegions
    }
  });
});

