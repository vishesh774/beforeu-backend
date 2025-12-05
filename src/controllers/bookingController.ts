import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import Service from '../models/Service';
import ServiceVariant from '../models/ServiceVariant';
import ServiceRegion from '../models/ServiceRegion';
import Booking from '../models/Booking';
import OrderItem from '../models/OrderItem';
import Address from '../models/Address';
// import UserCredits from '../models/UserCredits';
import User from '../models/User';

// Helper function to check if a point is inside a polygon
function isPointInPolygon(point: { lat: number; lng: number }, polygon: { lat: number; lng: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    
    const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
      (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// @desc    Get services available at a specific location
// @route   GET /api/services/by-location
// @access  Public
export const getServicesByLocation = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);

  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  // Find all active service regions that contain this point
  const activeRegions = await ServiceRegion.find({ isActive: true });
  const matchingRegionIds: string[] = [];

  for (const region of activeRegions) {
    if (isPointInPolygon({ lat, lng }, region.polygon)) {
      matchingRegionIds.push(region._id.toString());
    }
  }

  if (matchingRegionIds.length === 0) {
    return res.status(200).json({
      success: true,
      data: {
        services: []
      }
    });
  }

  // Find all active services that are available in these regions
  const services = await Service.find({
    isActive: true,
    $or: [
      { serviceRegions: { $in: matchingRegionIds } },
      { serviceRegions: { $size: 0 } } // Services available in all regions
    ]
  }).sort({ name: 1 });

  // Get all variants for these services
  const serviceIds = services.map(s => s._id);
  const variants = await ServiceVariant.find({
    serviceId: { $in: serviceIds },
    isActive: true
  }).sort({ name: 1 });

  // Group variants by service
  const servicesWithVariants = services.map(service => {
    const serviceVariants = variants
      .filter(v => v.serviceId.toString() === service._id.toString());

    // Extract sub-service names
    const subServicesNames = serviceVariants.map(v => v.name);

    return {
      id: service.id, // Service ID
      serviceId: service.id, // Service ID (explicit alias for clarity)
      name: service.name, // Service Name
      icon: service.icon, // Service Icon
      description: service.description || '', // Description
      highlight: service.highlight || '', // Highlight
      subServicesNames: subServicesNames, // SubServices Names
      tags: service.tags || [] // Service Tags
    };
  }).filter(service => service.subServicesNames.length > 0); // Only return services with active variants

  res.status(200).json({
    success: true,
    data: {
      services: servicesWithVariants
    }
  });
});

// @desc    Get all sub-services (variants) for a specific service
// @route   GET /api/services/:serviceId/sub-services
// @access  Public
export const getSubServicesByServiceId = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { serviceId } = req.params;

  if (!serviceId) {
    return next(new AppError('Service ID is required', 400));
  }

  // Find the service by ID (custom id field, not MongoDB _id)
  const service = await Service.findOne({ id: serviceId, isActive: true });
  
  if (!service) {
    return next(new AppError('Service not found or inactive', 404));
  }

  // Get all active variants (sub-services) for this service
  const variants = await ServiceVariant.find({
    serviceId: service._id,
    isActive: true
  }).sort({ name: 1 });

  // Map variants to include all details
  const subServices = variants.map(variant => ({
    id: variant.id,
    name: variant.name,
    description: variant.description,
    icon: variant.icon || null,
    inclusions: variant.inclusions || [],
    exclusions: variant.exclusions || [],
    originalPrice: variant.originalPrice,
    finalPrice: variant.finalPrice,
    estimatedTimeMinutes: variant.estimatedTimeMinutes,
    includedInSubscription: variant.includedInSubscription,
    creditCost: variant.creditValue,
    tags: variant.tags || [],
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt
  }));

  res.status(200).json({
    success: true,
    data: {
      service: {
        id: service.id,
        name: service.name,
        icon: service.icon,
        description: service.description,
        highlight: service.highlight,
        tags: service.tags || []
      },
      subServices: subServices
    }
  });
});

// @desc    Create a booking from cart
// @route   POST /api/bookings
// @access  Private
export const createBooking = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  const {
    addressId,
    items,
    bookingType,
    scheduledDate,
    scheduledTime,
    notes
  } = req.body;

  // Validation
  if (!addressId || !items || !Array.isArray(items) || items.length === 0) {
    return next(new AppError('Address ID and items are required', 400));
  }

  if (!bookingType || !['ASAP', 'SCHEDULED'].includes(bookingType)) {
    return next(new AppError('Valid booking type is required', 400));
  }

  if (bookingType === 'SCHEDULED' && (!scheduledDate || !scheduledTime)) {
    return next(new AppError('Scheduled date and time are required for scheduled bookings', 400));
  }

  const userIdObj = new mongoose.Types.ObjectId(userId);

  // Get user's address
  const address = await Address.findOne({ userId: userIdObj, id: addressId });
  if (!address) {
    return next(new AppError('Address not found', 404));
  }

  // Calculate totals and validate items
  let totalAmount = 0;
  let totalOriginalAmount = 0;
  let creditsUsed = 0;

  // TODO: Re-enable after testing
  // Get user credits
  // const userCredits = await UserCredits.findOne({ userId: userIdObj });
  // const availableCredits = userCredits?.credits || 0;

  // Validate and process each item
  const orderItems = [];
  for (const item of items) {
    const variant = await ServiceVariant.findOne({ id: item.variantId }).populate('serviceId');
    if (!variant) {
      return next(new AppError(`Service variant ${item.variantId} not found`, 404));
    }

    const service = await Service.findById(variant.serviceId);
    if (!service || !service.isActive) {
      return next(new AppError(`Service ${item.serviceId} is not available`, 400));
    }

    if (!variant.isActive) {
      return next(new AppError(`Service variant ${item.variantId} is not available`, 400));
    }

    const quantity = parseInt(item.quantity) || 1;
    const itemTotal = variant.finalPrice * quantity;
    const itemOriginalTotal = variant.originalPrice * quantity;
    const itemCredits = variant.includedInSubscription ? variant.creditValue * quantity : 0;

    // TODO: Re-enable credit check after testing
    // Check if user has enough credits for subscription items
    // if (variant.includedInSubscription && creditsUsed + itemCredits > availableCredits) {
    //   return next(new AppError('Insufficient credits for this booking', 400));
    // }

    totalAmount += itemTotal;
    totalOriginalAmount += itemOriginalTotal;
    creditsUsed += itemCredits;

    orderItems.push({
      serviceId: service._id,
      serviceVariantId: variant._id,
      serviceName: service.name,
      variantName: variant.name,
      quantity,
      originalPrice: variant.originalPrice,
      finalPrice: variant.finalPrice,
      creditValue: variant.creditValue,
      estimatedTimeMinutes: variant.estimatedTimeMinutes
    });
  }

  // Generate booking ID
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  
  const count = await Booking.countDocuments({
    $or: [
      {
        createdAt: {
          $gte: startOfDay,
          $lt: endOfDay
        }
      },
      {
        bookingId: {
          $regex: new RegExp(`^BOOK-${dateStr}-`)
        }
      }
    ]
  });
  const bookingId = `BOOK-${dateStr}-${String(count + 1).padStart(3, '0')}`;

  // Create booking
  const booking = await Booking.create({
    userId: userIdObj,
    bookingId,
    addressId: address.id,
    address: {
      label: address.label,
      fullAddress: address.fullAddress,
      area: address.area,
      coordinates: address.coordinates
    },
    bookingType,
    scheduledDate: bookingType === 'SCHEDULED' ? new Date(scheduledDate) : undefined,
    scheduledTime: bookingType === 'SCHEDULED' ? scheduledTime : undefined,
    totalAmount,
    totalOriginalAmount,
    creditsUsed,
    status: 'pending',
    paymentStatus: 'pending',
    notes: notes || undefined
  });

  // Create order items
  await OrderItem.insertMany(
    orderItems.map(item => ({
      ...item,
      bookingId: booking._id
    }))
  );

  // TODO: Re-enable credit deduction after testing
  // Deduct credits if used
  // if (creditsUsed > 0 && userCredits) {
  //   userCredits.credits = Math.max(0, userCredits.credits - creditsUsed);
  //   await userCredits.save();
  // }

  // Get order items with details
  const orderItemsWithDetails = await OrderItem.find({ bookingId: booking._id })
    .populate('serviceId', 'name icon')
    .populate('serviceVariantId', 'name description');

  res.status(201).json({
    success: true,
    data: {
      booking: {
        id: booking.bookingId,
        bookingId: booking.bookingId,
        items: orderItemsWithDetails.map(item => ({
          serviceId: (item.serviceId as any).id || item.serviceId.toString(),
          variantId: (item.serviceVariantId as any).id || item.serviceVariantId.toString(),
          variantName: item.variantName,
          serviceName: item.serviceName,
          price: item.finalPrice,
          originalPrice: item.originalPrice,
          creditCost: item.creditValue,
          quantity: item.quantity
        })),
        totalAmount: booking.totalAmount,
        status: booking.status,
        date: booking.scheduledDate || booking.createdAt.toISOString(),
        time: booking.scheduledTime || '',
        address: booking.address,
        type: booking.bookingType
      }
    }
  });
});

// @desc    Get user's bookings
// @route   GET /api/bookings
// @access  Private
export const getUserBookings = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  // Pagination parameters
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  // Status filter - map frontend status to backend status
  const statusFilter = req.query.status as string | undefined;
  const filter: any = { userId: new mongoose.Types.ObjectId(userId) };

  if (statusFilter) {
    // Map frontend status values to backend status values
    const statusMap: Record<string, string[]> = {
      'Upcoming': ['pending', 'confirmed', 'in_progress'],
      'Completed': ['completed'],
      'Cancelled': ['cancelled']
    };

    if (statusMap[statusFilter]) {
      filter.status = { $in: statusMap[statusFilter] };
    } else {
      // Also support direct backend status values
      const backendStatuses = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'];
      if (backendStatuses.includes(statusFilter)) {
        filter.status = statusFilter;
      }
    }
  }

  // Get total count for pagination
  const total = await Booking.countDocuments(filter);

  // Fetch bookings with pagination
  const bookings = await Booking.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const bookingsWithItems = await Promise.all(
    bookings.map(async (booking) => {
      const items = await OrderItem.find({ bookingId: booking._id })
        .populate('serviceId', 'name icon')
        .populate('serviceVariantId', 'name');

      return {
        id: booking.bookingId,
        bookingId: booking.bookingId,
        items: items.map(item => ({
          serviceId: (item.serviceId as any)?.id || (item.serviceId as any)?._id?.toString() || item.serviceId.toString(),
          serviceVariantId: (item.serviceVariantId as any)?.id || (item.serviceVariantId as any)?._id?.toString() || item.serviceVariantId.toString(),
          variantId: (item.serviceVariantId as any)?.id || (item.serviceVariantId as any)?._id?.toString() || item.serviceVariantId.toString(),
          variantName: item.variantName,
          serviceName: item.serviceName,
          price: item.finalPrice,
          originalPrice: item.originalPrice,
          creditCost: item.creditValue || 0,
          quantity: item.quantity
        })),
        totalAmount: booking.totalAmount,
        taxAmount: booking.totalAmount - (booking.totalOriginalAmount - booking.creditsUsed), // Approximate tax
        itemTotal: booking.totalOriginalAmount - booking.creditsUsed,
        status: booking.status === 'pending' ? 'Upcoming' : 
                booking.status === 'completed' ? 'Completed' : 
                booking.status === 'cancelled' ? 'Cancelled' : 
                booking.status === 'confirmed' ? 'Upcoming' :
                booking.status === 'in_progress' ? 'Upcoming' : 'Upcoming',
        date: booking.scheduledDate ? booking.scheduledDate.toISOString() : booking.createdAt.toISOString(),
        time: booking.scheduledTime || '',
        address: {
          id: booking.addressId || '',
          label: booking.address?.label || 'Address',
          fullAddress: booking.address?.fullAddress || '',
          area: booking.address?.area,
          coordinates: booking.address?.coordinates,
          isDefault: false // Address from booking doesn't track default status
        },
        type: booking.bookingType === 'ASAP' ? 'ASAP' : 'SCHEDULED',
        paymentStatus: booking.paymentStatus,
        createdAt: booking.createdAt.toISOString(),
        updatedAt: booking.updatedAt.toISOString()
      };
    })
  );

  const totalPages = Math.ceil(total / limit);

  res.status(200).json({
    success: true,
    data: {
      bookings: bookingsWithItems,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    }
  });
});

/**
 * Generate a 4-digit booking OTP deterministically based on booking ID
 * This ensures the same booking always has the same OTP
 */
function generateBookingOTP(bookingId: string): string {
  // Simple hash function to generate consistent 4-digit OTP
  let hash = 0;
  for (let i = 0; i < bookingId.length; i++) {
    const char = bookingId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to positive 4-digit number
  const otp = Math.abs(hash) % 10000;
  return String(otp).padStart(4, '0');
}

// @desc    Get single booking by ID (Customer)
// @route   GET /api/bookings/:bookingId
// @access  Private
export const getUserBookingById = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  console.log('[getUserBookingById] Route hit, params:', req.params);
  const userId = req.user?.id;
  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  const { bookingId } = req.params;
  console.log('[getUserBookingById] Booking ID:', bookingId, 'User ID:', userId);
  if (!bookingId) {
    return next(new AppError('Booking ID is required', 400));
  }

  const userIdObj = new mongoose.Types.ObjectId(userId);

  // Find booking and ensure it belongs to the user
  const booking = await Booking.findOne({ 
    bookingId,
    userId: userIdObj 
  });

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Get order items
  const items = await OrderItem.find({ bookingId: booking._id })
    .populate('serviceId', 'name icon')
    .populate('serviceVariantId', 'name description');

  // Generate booking OTP (4-digit, deterministic)
  const bookingOTP = generateBookingOTP(booking.bookingId);

  // Get assigned professional if any (from order items)
  let assignedProfessional = null;
  const itemsWithPartner = await OrderItem.find({ bookingId: booking._id })
    .populate('assignedPartnerId', 'name phone email rating jobsCompleted');
  
  // Check if any item has an assigned partner
  const itemWithPartner = itemsWithPartner.find(item => item.assignedPartnerId);
  if (itemWithPartner && itemWithPartner.assignedPartnerId) {
    const partner = itemWithPartner.assignedPartnerId as any;
    assignedProfessional = {
      id: partner._id.toString(),
      name: partner.name || 'Professional',
      phone: partner.phone,
      email: partner.email,
      rating: partner.rating || 4.5,
      jobsCompleted: partner.jobsCompleted || 0
    };
  }

  // Transform status to match frontend expectations
  const statusMap: Record<string, string> = {
    'pending': 'Upcoming',
    'confirmed': 'Upcoming',
    'in_progress': 'Upcoming',
    'completed': 'Completed',
    'cancelled': 'Cancelled'
  };

  const bookingData = {
    id: booking.bookingId,
    bookingId: booking.bookingId,
    items: items.map(item => ({
      serviceId: (item.serviceId as any).id || item.serviceId.toString(),
      variantId: (item.serviceVariantId as any).id || item.serviceVariantId.toString(),
      variantName: item.variantName,
      serviceName: item.serviceName,
      price: item.finalPrice,
      originalPrice: item.originalPrice,
      creditCost: item.creditValue,
      quantity: item.quantity
    })),
    totalAmount: booking.totalAmount,
    status: statusMap[booking.status] || 'Upcoming',
    date: booking.scheduledDate ? booking.scheduledDate.toISOString() : booking.createdAt.toISOString(),
    time: booking.scheduledTime || '',
    address: {
      id: booking.addressId,
      label: booking.address.label,
      fullAddress: booking.address.fullAddress,
      area: booking.address.area,
      coordinates: booking.address.coordinates,
      isDefault: false // Not stored in booking, default to false
    },
    type: booking.bookingType,
    otp: bookingOTP, // Include OTP in response
    professional: assignedProfessional, // Include assigned professional if any
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt
  };

  res.status(200).json({
    success: true,
    data: {
      booking: bookingData
    }
  });
});

// @desc    Get all bookings (Admin)
// @route   GET /api/admin/bookings
// @access  Private/Admin
export const getAllBookings = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const statusFilter = req.query.status as string | undefined;
  const searchQuery = req.query.search as string | undefined;

  const filter: any = {};

  if (statusFilter) {
    const statusMap: Record<string, string> = {
      'pending': 'pending',
      'confirmed': 'confirmed',
      'in_progress': 'in_progress',
      'completed': 'completed',
      'cancelled': 'cancelled'
    };
    if (statusMap[statusFilter]) {
      filter.status = statusMap[statusFilter];
    }
  }

  // Search by booking ID or customer name
  if (searchQuery && searchQuery.trim()) {
    const escapedQuery = searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = { $regex: escapedQuery, $options: 'i' };
    
    // Find users matching search
    const matchingUsers = await User.find({
      $or: [
        { name: searchRegex },
        { phone: searchRegex },
        { email: searchRegex }
      ]
    }).select('_id');
    const userIds = matchingUsers.map(u => u._id);
    
    // Find bookings matching booking ID or user IDs
    filter.$or = [
      { bookingId: searchRegex },
      ...(userIds.length > 0 ? [{ userId: { $in: userIds } }] : [])
    ];
  }

  const total = await Booking.countDocuments(filter);
  const bookings = await Booking.find(filter)
    .populate('userId', 'name email phone')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const bookingsWithItems = await Promise.all(
    bookings.map(async (booking) => {
      const items = await OrderItem.find({ bookingId: booking._id })
        .populate('serviceId', 'name icon')
        .populate('serviceVariantId', 'name')
        .populate('assignedPartnerId', 'name phone');

      return {
        id: booking.bookingId,
        bookingId: booking.bookingId,
        customer: {
          id: (booking.userId as any)._id.toString(),
          name: (booking.userId as any).name,
          email: (booking.userId as any).email,
          phone: (booking.userId as any).phone
        },
        items: items.map(item => ({
          id: item._id.toString(),
          serviceId: (item.serviceId as any).id || item.serviceId.toString(),
          serviceName: item.serviceName,
          variantId: (item.serviceVariantId as any).id || item.serviceVariantId.toString(),
          variantName: item.variantName,
          quantity: item.quantity,
          originalPrice: item.originalPrice,
          finalPrice: item.finalPrice,
          creditValue: item.creditValue,
          estimatedTimeMinutes: item.estimatedTimeMinutes,
          assignedPartner: item.assignedPartnerId ? {
            id: (item.assignedPartnerId as any)._id.toString(),
            name: (item.assignedPartnerId as any).name,
            phone: (item.assignedPartnerId as any).phone
          } : null,
          status: item.status
        })),
        address: booking.address,
        bookingType: booking.bookingType,
        scheduledDate: booking.scheduledDate,
        scheduledTime: booking.scheduledTime,
        totalAmount: booking.totalAmount,
        totalOriginalAmount: booking.totalOriginalAmount,
        creditsUsed: booking.creditsUsed,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        notes: booking.notes,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt
      };
    })
  );

  res.status(200).json({
    success: true,
    data: {
      bookings: bookingsWithItems,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

// @desc    Get single booking by ID (Admin)
// @route   GET /api/admin/bookings/:id
// @access  Private/Admin
export const getBookingById = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const booking = await Booking.findOne({ bookingId: id })
    .populate('userId', 'name email phone');

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  const items = await OrderItem.find({ bookingId: booking._id })
    .populate('serviceId', 'name icon')
    .populate('serviceVariantId', 'name description inclusions exclusions tags')
    .populate('assignedPartnerId', 'name phone email');

  const bookingData = {
    id: booking.bookingId,
    bookingId: booking.bookingId,
    customer: {
      id: (booking.userId as any)._id.toString(),
      name: (booking.userId as any).name,
      email: (booking.userId as any).email,
      phone: (booking.userId as any).phone
    },
    items: items.map(item => ({
      id: item._id.toString(),
      serviceId: (item.serviceId as any).id || item.serviceId.toString(),
      serviceName: item.serviceName,
      variantId: (item.serviceVariantId as any).id || item.serviceVariantId.toString(),
      variantName: item.variantName,
      description: (item.serviceVariantId as any).description,
      inclusions: (item.serviceVariantId as any).inclusions || [],
      exclusions: (item.serviceVariantId as any).exclusions || [],
      tags: (item.serviceVariantId as any).tags || [],
      quantity: item.quantity,
      originalPrice: item.originalPrice,
      finalPrice: item.finalPrice,
      creditValue: item.creditValue,
      estimatedTimeMinutes: item.estimatedTimeMinutes,
      assignedPartner: item.assignedPartnerId ? {
        id: (item.assignedPartnerId as any)._id.toString(),
        name: (item.assignedPartnerId as any).name,
        phone: (item.assignedPartnerId as any).phone,
        email: (item.assignedPartnerId as any).email
      } : null,
      status: item.status
    })),
    address: booking.address,
    bookingType: booking.bookingType,
    scheduledDate: booking.scheduledDate,
    scheduledTime: booking.scheduledTime,
    totalAmount: booking.totalAmount,
    totalOriginalAmount: booking.totalOriginalAmount,
    creditsUsed: booking.creditsUsed,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    notes: booking.notes,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt
  };

  res.status(200).json({
    success: true,
    data: {
      booking: bookingData
    }
  });
});

