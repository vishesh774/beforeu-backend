import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Service from '../models/Service';
import ServiceVariant from '../models/ServiceVariant';

// @desc    Get all services with pagination and filters
// @route   GET /api/admin/services
// @access  Private/Admin
export const getAllServices = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
  // Pagination parameters
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Filter parameters
  const searchQuery = req.query.search as string | undefined;
  const isActiveFilter = req.query.isActive as string | undefined;
  const tagFilter = req.query.tag as string | undefined;

  // Build filter object
  const filter: any = {};

  // Apply search filter (name or variant names/descriptions)
  if (searchQuery && searchQuery.trim()) {
    // Escape special regex characters in search query
    const escapedQuery = searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = { $regex: escapedQuery, $options: 'i' };
    
    // Find services matching name
    const servicesByName = await Service.find({ name: searchRegex }).select('_id');
    const serviceIdsByName = servicesByName.map(s => s._id);
    
    // Find services with matching variants
    const matchingVariants = await ServiceVariant.find({
      $or: [
        { name: searchRegex },
        { description: searchRegex }
      ]
    }).select('serviceId');
    const serviceIdsFromVariants = matchingVariants.map(v => v.serviceId);
    
    // Combine both sets of service IDs
    const allMatchingServiceIds = [...new Set([...serviceIdsByName, ...serviceIdsFromVariants])];
    
    if (allMatchingServiceIds.length > 0) {
      filter._id = { $in: allMatchingServiceIds };
    } else {
      // No matches found, return empty result
      filter._id = { $in: [] };
    }
  }

  // Apply isActive filter
  if (isActiveFilter !== undefined) {
    filter.isActive = isActiveFilter === 'true';
  }

  // Apply tag filter
  if (tagFilter && tagFilter.trim()) {
    filter.tags = { $in: [tagFilter.trim()] };
  }

  // Get total count for pagination
  const total = await Service.countDocuments(filter);

  // Get paginated services
  const services = await Service.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  // Get variant counts for all services
  const serviceIds = services.map(s => s._id);
  let variantCounts: any[] = [];
  if (serviceIds.length > 0) {
    variantCounts = await ServiceVariant.aggregate([
      { $match: { serviceId: { $in: serviceIds } } },
      { $group: { _id: '$serviceId', count: { $sum: 1 } } }
    ]);
  }
  const variantCountMap: Record<string, number> = {};
  variantCounts.forEach(vc => {
    variantCountMap[vc._id.toString()] = vc.count;
  });

  res.status(200).json({
    success: true,
    data: {
      services: services.map(service => ({
        id: service.id,
        name: service.name,
        icon: service.icon,
        description: service.description,
        highlight: service.highlight,
        isActive: service.isActive,
        variantCount: variantCountMap[service._id.toString()] || 0,
        serviceRegions: service.serviceRegions || [],
        tags: service.tags || [],
        createdAt: service.createdAt,
        updatedAt: service.updatedAt
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

// @desc    Get single service by ID
// @route   GET /api/admin/services/:id
// @access  Private/Admin
export const getService = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const service = await Service.findOne({ id });
  if (!service) {
    return next(new AppError('Service not found', 404));
  }

  // Fetch variants separately
  const variants = await ServiceVariant.find({ serviceId: service._id }).sort({ createdAt: 1 });

  res.status(200).json({
    success: true,
    data: {
      service: {
        id: service.id,
        name: service.name,
        icon: service.icon,
        description: service.description,
        highlight: service.highlight,
        isActive: service.isActive,
        variants: variants.map(v => ({
          id: v.id,
          name: v.name,
          description: v.description,
          icon: v.icon,
          inclusions: v.inclusions || [],
          exclusions: v.exclusions || [],
          originalPrice: v.originalPrice,
          finalPrice: v.finalPrice,
          estimatedTimeMinutes: v.estimatedTimeMinutes,
          includedInSubscription: v.includedInSubscription,
          creditValue: v.creditValue,
          serviceType: v.serviceType,
          availableForPurchase: v.availableForPurchase,
          extraTimeSlabs: v.extraTimeSlabs || 0,
          extraCharges: v.extraCharges || 0,
          tags: v.tags,
          isActive: v.isActive
        })),
        serviceRegions: service.serviceRegions || [],
        tags: service.tags || [],
        createdAt: service.createdAt,
        updatedAt: service.updatedAt
      }
    }
  });
});

// @desc    Create new service
// @route   POST /api/admin/services
// @access  Private/Admin
export const createService = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id, name, icon, description, highlight, isActive, variants, serviceRegions, tags } = req.body;

  // Validate required fields
  if (!id || !name || !icon || variants === undefined) {
    return next(new AppError('ID, name, icon, and variants are required', 400));
  }

  // Description and highlight are optional but must be strings if provided
  if (description !== undefined && typeof description !== 'string') {
    return next(new AppError('Service description must be a string', 400));
  }
  if (description !== undefined && description.length > 200) {
    return next(new AppError('Service description cannot exceed 200 characters', 400));
  }
  if (highlight !== undefined && typeof highlight !== 'string') {
    return next(new AppError('Service highlight must be a string', 400));
  }
  if (highlight !== undefined && highlight.length > 100) {
    return next(new AppError('Service highlight cannot exceed 100 characters', 400));
  }

  // Validate variants
  if (!Array.isArray(variants) || variants.length === 0) {
    return next(new AppError('Service must have at least one variant', 400));
  }

  // Validate each variant
  for (const variant of variants) {
    if (!variant.id || !variant.name || !variant.description) {
      return next(new AppError('Each variant must have id, name, and description', 400));
    }
    if (typeof variant.originalPrice !== 'number' || variant.originalPrice < 0) {
      return next(new AppError('Each variant must have a valid originalPrice (>= 0)', 400));
    }
    if (typeof variant.finalPrice !== 'number' || variant.finalPrice < 0) {
      return next(new AppError('Each variant must have a valid finalPrice (>= 0)', 400));
    }
    if (typeof variant.estimatedTimeMinutes !== 'number' || variant.estimatedTimeMinutes < 1) {
      return next(new AppError('Each variant must have a valid estimatedTimeMinutes (>= 1)', 400));
    }
    if (typeof variant.creditValue !== 'number' || variant.creditValue < 0) {
      return next(new AppError('Each variant must have a valid creditValue (>= 0)', 400));
    }
    if (typeof variant.includedInSubscription !== 'boolean') {
      return next(new AppError('Each variant must have a valid includedInSubscription (boolean)', 400));
    }
    if (variant.serviceType && !['Virtual', 'In-Person'].includes(variant.serviceType)) {
      return next(new AppError('Service type must be either "Virtual" or "In-Person"', 400));
    }
    if (typeof variant.availableForPurchase !== 'undefined' && typeof variant.availableForPurchase !== 'boolean') {
      return next(new AppError('Each variant must have a valid availableForPurchase (boolean)', 400));
    }
    if (typeof variant.isActive !== 'boolean') {
      return next(new AppError('Each variant must have a valid isActive (boolean)', 400));
    }
    // Validate inclusions/exclusions and tags are arrays (optional)
    if (variant.inclusions !== undefined && !Array.isArray(variant.inclusions)) {
      return next(new AppError('Each variant must have inclusions as an array', 400));
    }
    if (variant.exclusions !== undefined && !Array.isArray(variant.exclusions)) {
      return next(new AppError('Each variant must have exclusions as an array', 400));
    }
    if (!Array.isArray(variant.tags)) {
      return next(new AppError('Each variant must have tags as an array', 400));
    }
    // Validate description length
    if (variant.description.length > 300) {
      return next(new AppError('Each variant description cannot exceed 300 characters', 400));
    }
  }

  // Check if service with this ID already exists
  const existingService = await Service.findOne({ id });
  if (existingService) {
    return next(new AppError('Service with this ID already exists', 400));
  }

  // Validate serviceRegions and tags if provided
  if (serviceRegions !== undefined && !Array.isArray(serviceRegions)) {
    return next(new AppError('serviceRegions must be an array', 400));
  }
  if (tags !== undefined && !Array.isArray(tags)) {
    return next(new AppError('tags must be an array', 400));
  }

  // Create service first
  const service = await Service.create({
    id,
    name,
    icon,
    description: description !== undefined ? description : '',
    highlight: highlight !== undefined ? highlight : '',
    isActive: isActive !== undefined ? isActive : true,
    serviceRegions: serviceRegions || [],
    tags: tags || []
  });

  // Create variants separately
  // Remove any remarks field if present (legacy field, replaced by inclusions/exclusions)
  const createdVariants = await ServiceVariant.insertMany(
    variants.map(variant => {
      const { remarks, ...variantData } = variant as any; // Remove remarks if present
      const variantDoc: any = {
        serviceId: service._id,
        id: variantData.id,
        name: variantData.name,
        description: variantData.description,
        inclusions: variantData.inclusions || [],
        exclusions: variantData.exclusions || [],
        originalPrice: variantData.originalPrice,
        finalPrice: variantData.finalPrice,
        estimatedTimeMinutes: variantData.estimatedTimeMinutes,
        includedInSubscription: variantData.includedInSubscription,
        creditValue: variantData.creditValue,
        serviceType: variantData.serviceType || 'In-Person',
        availableForPurchase: variantData.availableForPurchase !== undefined ? variantData.availableForPurchase : true,
        extraTimeSlabs: variantData.extraTimeSlabs !== undefined ? variantData.extraTimeSlabs : 0,
        extraCharges: variantData.extraCharges !== undefined ? variantData.extraCharges : 0,
        tags: variantData.tags || [],
        isActive: variantData.isActive !== undefined ? variantData.isActive : true
      };
      
      // Only include icon if it has a value (not null, undefined, or empty string)
      if (variantData.icon !== null && variantData.icon !== undefined && String(variantData.icon).trim() !== '') {
        variantDoc.icon = String(variantData.icon).trim();
      }
      
      return variantDoc;
    })
  );

  res.status(201).json({
    success: true,
    message: 'Service created successfully',
    data: {
      service: {
        id: service.id,
        name: service.name,
        icon: service.icon,
        description: service.description,
        highlight: service.highlight,
        isActive: service.isActive,
        variants: createdVariants.map(v => ({
          id: v.id,
          name: v.name,
          description: v.description,
          icon: v.icon,
          inclusions: v.inclusions || [],
          exclusions: v.exclusions || [],
          originalPrice: v.originalPrice,
          finalPrice: v.finalPrice,
          estimatedTimeMinutes: v.estimatedTimeMinutes,
          includedInSubscription: v.includedInSubscription,
          creditValue: v.creditValue,
          serviceType: v.serviceType,
          availableForPurchase: v.availableForPurchase,
          tags: v.tags,
          isActive: v.isActive
        })),
        serviceRegions: service.serviceRegions || [],
        tags: service.tags || [],
        createdAt: service.createdAt,
        updatedAt: service.updatedAt
      }
    }
  });
});

// @desc    Update service
// @route   PUT /api/admin/services/:id
// @access  Private/Admin
export const updateService = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { name, icon, description, highlight, isActive, variants, serviceRegions, tags } = req.body;

  const service = await Service.findOne({ id });
  if (!service) {
    return next(new AppError('Service not found', 404));
  }

  // Update fields
  if (name !== undefined) service.name = name;
  if (icon !== undefined) service.icon = icon;
  if (isActive !== undefined) service.isActive = isActive;
  if (description !== undefined) {
    if (typeof description !== 'string' || description.length > 200) {
      return next(new AppError('Service description must be a string up to 200 characters', 400));
    }
    service.description = description;
  }
  if (highlight !== undefined) {
    if (typeof highlight !== 'string' || highlight.length > 100) {
      return next(new AppError('Service highlight must be a string up to 100 characters', 400));
    }
    service.highlight = highlight;
  }
  if (serviceRegions !== undefined) {
    if (!Array.isArray(serviceRegions)) {
      return next(new AppError('serviceRegions must be an array', 400));
    }
    service.serviceRegions = serviceRegions;
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      return next(new AppError('tags must be an array', 400));
    }
    service.tags = tags;
  }
  await service.save();

  // Update variants if provided
  if (variants) {
    // Validate variants
    if (!Array.isArray(variants) || variants.length === 0) {
      return next(new AppError('Service must have at least one variant', 400));
    }

    // Validate each variant
    for (const variant of variants) {
      if (!variant.id || !variant.name || !variant.description) {
        return next(new AppError('Each variant must have id, name, and description', 400));
      }
      if (typeof variant.originalPrice !== 'number' || variant.originalPrice < 0) {
        return next(new AppError('Each variant must have a valid originalPrice (>= 0)', 400));
      }
      if (typeof variant.finalPrice !== 'number' || variant.finalPrice < 0) {
        return next(new AppError('Each variant must have a valid finalPrice (>= 0)', 400));
      }
      if (typeof variant.estimatedTimeMinutes !== 'number' || variant.estimatedTimeMinutes < 1) {
        return next(new AppError('Each variant must have a valid estimatedTimeMinutes (>= 1)', 400));
      }
      if (typeof variant.creditValue !== 'number' || variant.creditValue < 0) {
        return next(new AppError('Each variant must have a valid creditValue (>= 0)', 400));
      }
      if (typeof variant.includedInSubscription !== 'boolean') {
        return next(new AppError('Each variant must have a valid includedInSubscription (boolean)', 400));
      }
      if (typeof variant.isActive !== 'boolean') {
        return next(new AppError('Each variant must have a valid isActive (boolean)', 400));
      }
      // Validate inclusions/exclusions and tags are arrays (optional)
      if (variant.inclusions !== undefined && !Array.isArray(variant.inclusions)) {
        return next(new AppError('Each variant must have inclusions as an array', 400));
      }
      if (variant.exclusions !== undefined && !Array.isArray(variant.exclusions)) {
        return next(new AppError('Each variant must have exclusions as an array', 400));
      }
      if (!Array.isArray(variant.tags)) {
        return next(new AppError('Each variant must have tags as an array', 400));
      }
      // Validate description length
      if (variant.description.length > 300) {
        return next(new AppError('Each variant description cannot exceed 300 characters', 400));
      }
    }

    // Delete existing variants and create new ones (or update if exists)
    const existingVariants = await ServiceVariant.find({ serviceId: service._id });
    const newVariantIds = variants.map(v => v.id);

    // Delete variants that are not in the new list
    const variantsToDelete = existingVariants.filter(v => !newVariantIds.includes(v.id));
    if (variantsToDelete.length > 0) {
      await ServiceVariant.deleteMany({ _id: { $in: variantsToDelete.map(v => v._id) } });
    }

    // Update or create variants
    for (const variant of variants) {
      // Remove any remarks field if present (legacy field, replaced by inclusions/exclusions)
      const { remarks, ...variantData } = variant as any;
      
      const updateData: any = {
        serviceId: service._id,
        id: variantData.id,
        name: variantData.name,
        description: variantData.description,
        inclusions: variantData.inclusions || [],
        exclusions: variantData.exclusions || [],
        originalPrice: variantData.originalPrice,
        finalPrice: variantData.finalPrice,
        estimatedTimeMinutes: variantData.estimatedTimeMinutes,
        includedInSubscription: variantData.includedInSubscription,
        creditValue: variantData.creditValue,
        serviceType: variantData.serviceType || 'In-Person',
        availableForPurchase: variantData.availableForPurchase !== undefined ? variantData.availableForPurchase : true,
        extraTimeSlabs: variantData.extraTimeSlabs !== undefined ? variantData.extraTimeSlabs : 0,
        extraCharges: variantData.extraCharges !== undefined ? variantData.extraCharges : 0,
        tags: variantData.tags || [],
        isActive: variantData.isActive
      };
      
      // Handle optional icon field - only include if it has a value
      // Omit the field entirely if null, undefined, or empty string
      // The schema setter will handle normalization
      if (variantData.icon !== null && variantData.icon !== undefined && String(variantData.icon).trim() !== '') {
        updateData.icon = String(variantData.icon).trim();
      }
      // If icon is null/empty/undefined, we don't include it in updateData
      // This means the field won't be updated (existing value remains) or will be omitted on create
      
      await ServiceVariant.findOneAndUpdate(
        { serviceId: service._id, id: variantData.id },
        updateData,
        { upsert: true, new: true }
      );
    }
  }

  // Fetch updated variants
  const updatedVariants = await ServiceVariant.find({ serviceId: service._id }).sort({ createdAt: 1 });

  res.status(200).json({
    success: true,
    message: 'Service updated successfully',
    data: {
      service: {
        id: service.id,
        name: service.name,
        icon: service.icon,
        description: service.description,
        highlight: service.highlight,
        isActive: service.isActive,
        variants: updatedVariants.map(v => ({
          id: v.id,
          name: v.name,
          description: v.description,
          icon: v.icon,
          inclusions: v.inclusions || [],
          exclusions: v.exclusions || [],
          originalPrice: v.originalPrice,
          finalPrice: v.finalPrice,
          estimatedTimeMinutes: v.estimatedTimeMinutes,
          includedInSubscription: v.includedInSubscription,
          creditValue: v.creditValue,
          serviceType: v.serviceType,
          availableForPurchase: v.availableForPurchase,
          tags: v.tags,
          isActive: v.isActive
        })),
        serviceRegions: service.serviceRegions || [],
        tags: service.tags || [],
        createdAt: service.createdAt,
        updatedAt: service.updatedAt
      }
    }
  });
});

// @desc    Toggle service active status
// @route   PATCH /api/admin/services/:id/toggle-status
// @access  Private/Admin
export const toggleServiceStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { variantId } = req.body; // Optional: if provided, toggle specific variant

  const service = await Service.findOne({ id });
  if (!service) {
    return next(new AppError('Service not found', 404));
  }

  if (variantId) {
    // Toggle specific variant status
    const variant = await ServiceVariant.findOne({ serviceId: service._id, id: variantId });
    if (!variant) {
      return next(new AppError('Variant not found', 404));
    }
    variant.isActive = !variant.isActive;
    await variant.save();
  } else {
    // Toggle service-level status (mark as inactive instead of deleting)
    // Ensure description and highlight are set to empty string if undefined
    if (service.description === undefined || service.description === null) {
      service.description = '';
    }
    if (service.highlight === undefined || service.highlight === null) {
      service.highlight = '';
    }
    service.isActive = !service.isActive;
    await service.save();
  }

  // Fetch updated variants
  const variants = await ServiceVariant.find({ serviceId: service._id }).sort({ createdAt: 1 });

  res.status(200).json({
    success: true,
    message: variantId ? 'Variant status toggled successfully' : `Service ${service.isActive ? 'activated' : 'deactivated'} successfully`,
    data: {
      service: {
        id: service.id,
        name: service.name,
        icon: service.icon,
        isActive: service.isActive,
        variants: variants.map(v => ({
          id: v.id,
          name: v.name,
          description: v.description,
          icon: v.icon,
          inclusions: v.inclusions || [],
          exclusions: v.exclusions || [],
          originalPrice: v.originalPrice,
          finalPrice: v.finalPrice,
          estimatedTimeMinutes: v.estimatedTimeMinutes,
          includedInSubscription: v.includedInSubscription,
          creditValue: v.creditValue,
          serviceType: v.serviceType,
          availableForPurchase: v.availableForPurchase,
          tags: v.tags,
          isActive: v.isActive
        })),
        serviceRegions: service.serviceRegions || [],
        tags: service.tags || [],
        createdAt: service.createdAt,
        updatedAt: service.updatedAt
      }
    }
  });
});

