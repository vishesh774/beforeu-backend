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
import UserCredits from '../models/UserCredits';
import UserPlan from '../models/UserPlan';
import Plan from '../models/Plan';
import PlanTransaction from '../models/PlanTransaction';
import { SOSAlert, SOSStatus } from '../models/SOSAlert';
import { socketService } from '../services/socketService';
import { calculateCheckoutTotal, getActiveCheckoutFields } from '../utils/checkoutUtils';
import ServicePartner from '../models/ServicePartner';
import ServiceLocation from '../models/ServiceLocation';
import { isPointInPolygon } from '../utils/pointInPolygon';
import { autoAssignServicePartner, isPartnerAvailableAtTime, syncBookingStatus } from '../services/bookingService';
import { BookingStatus, COMPLETED_BOOKING_STATUSES, ONGOING_BOOKING_STATUSES } from '../constants/bookingStatus';

// @desc    Get all active services (without location requirement)
// @route   GET /api/services/all
// @access  Public
export const getAllServices = asyncHandler(async (_req: Request, res: Response, _next: NextFunction) => {
  // Find all active services
  const services = await Service.find({
    isActive: true
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
  let itemTotal = 0;
  let totalOriginalAmount = 0;

  // Implement credit logic
  // Get user credits
  const userCredits = await UserCredits.findOne({ userId: userIdObj });
  let availableCredits = userCredits?.credits || 0;

  // Check if user has an active plan
  const userPlan = await UserPlan.findOne({ userId: userIdObj, activePlanId: { $ne: null } });
  const hasActivePlan = !!userPlan;

  let creditsUsed = 0;

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
    let variantTotal = variant.finalPrice * quantity;
    const variantOriginalTotal = variant.originalPrice * quantity;
    const itemCreditCost = variant.creditValue * quantity;
    let paidWithCredits = false;

    // Check if user has enough credits and item is included in subscription/plan capable
    // Assuming 'includedInSubscription' flag or just creditValue presence + active plan implies eligibility
    // The requirement says: "If we have a subscription plan available for a customer... need to show the credit value... amount for this should be calculated as 0"
    if (hasActivePlan && variant.creditValue > 0) {
      if (availableCredits >= itemCreditCost) {
        // Use Credits
        creditsUsed += itemCreditCost;
        availableCredits -= itemCreditCost; // Deduct from local tracking
        variantTotal = 0; // Price becomes 0
        paidWithCredits = true;
      } else {
        // Not enough credits, charge full price? Or partial? 
        // Usually full price if not enough credits for the whole item or quantity.
        // Requirement says "credit value must be reduced... show remaining".
        // If not enough credits, we just fall back to regular price.
      }
    }

    itemTotal += variantTotal;
    totalOriginalAmount += variantOriginalTotal;

    orderItems.push({
      serviceId: service._id,
      serviceVariantId: variant._id,
      serviceName: service.name,
      variantName: variant.name,
      quantity,
      finalPrice: paidWithCredits ? 0 : variant.finalPrice, // If paid with credits, price is 0
      originalPrice: variant.originalPrice, // Keep original price for record
      creditValue: variant.creditValue, // Store single unit credit value
      estimatedTimeMinutes: variant.estimatedTimeMinutes,
      customerVisitRequired: variant.customerVisitRequired !== undefined ? variant.customerVisitRequired : false,
      paidWithCredits
    });
  }

  // Calculate taxes and fees using active checkout fields
  const checkoutFields = await getActiveCheckoutFields();
  const calculationResult = await calculateCheckoutTotal(itemTotal, checkoutFields);

  // Format breakdown for storage
  const paymentBreakdown = calculationResult.breakdown.map(item => {
    const field = checkoutFields.find(f => f.fieldName === item.fieldName);
    return {
      fieldName: item.fieldName,
      fieldDisplayName: item.fieldDisplayName,
      chargeType: field?.chargeType || 'fixed',
      value: field?.value || 0,
      amount: item.amount
    };
  });

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

  // Determine status based on total amount
  let initialStatus: any = 'pending';
  let initialPaymentStatus = 'pending';

  // If total is 0 (fully paid by credits or free), auto-confirm
  if (calculationResult.total === 0) {
    initialStatus = 'confirmed';
    initialPaymentStatus = 'paid';
  }

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
    itemTotal,
    totalAmount: calculationResult.total,
    totalOriginalAmount,
    creditsUsed, // Add creditsUsed to booking document
    paymentBreakdown: paymentBreakdown.length > 0 ? paymentBreakdown : undefined,
    status: initialStatus,
    paymentStatus: initialPaymentStatus,
    notes: notes || undefined
  });

  // Create order items
  const createdOrderItems = await OrderItem.insertMany(
    orderItems.map(item => ({
      ...item,
      bookingId: booking._id
    }))
  );

  // Auto-assign service partner if available
  try {
    // Only auto-assign if confirmed (which it is if total is 0, otherwise it waits for payment webhook)
    if (initialStatus === 'confirmed') {
      await autoAssignServicePartner(booking, createdOrderItems);
    }
  } catch (error) {
    // Log error but don't fail the booking
    console.error('[createBooking] Error auto-assigning partner:', error);
  }

  // Deduct credits if used
  if (creditsUsed > 0 && userCredits) {
    userCredits.credits = Math.max(0, userCredits.credits - creditsUsed);
    await userCredits.save();
  }

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
          quantity: item.quantity,
          paidWithCredits: item.paidWithCredits
        })),
        totalAmount: booking.totalAmount,
        status: booking.status,
        date: booking.scheduledDate || booking.createdAt.toISOString(),
        time: booking.scheduledTime || '',
        address: booking.address,
        type: booking.bookingType,
        paymentStatus: booking.paymentStatus
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
  const statusFilter = req.query.status;
  const filter: any = { userId: new mongoose.Types.ObjectId(userId) };

  if (statusFilter) {
    // Handle array of statuses (when multiple status query params are provided)
    const statusArray = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
    const statusValues: string[] = [];

    // Map frontend status values to backend status values
    // Map frontend status values to backend status values
    const statusMap: Record<string, string[]> = {
      'Upcoming': [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.ASSIGNED, BookingStatus.EN_ROUTE, BookingStatus.REACHED, BookingStatus.IN_PROGRESS],
      'Completed': [BookingStatus.COMPLETED],
      'Cancelled': [BookingStatus.CANCELLED]
    };

    statusArray.forEach((status) => {
      const statusStr = typeof status === 'string' ? status : String(status);
      if (statusMap[statusStr]) {
        statusValues.push(...statusMap[statusStr]);
      } else {
        // Also support direct backend status values
        const validStatuses = Object.values(BookingStatus) as string[];
        // Handle legacy 'inprogress' case
        if (statusStr === 'inprogress' && validStatuses.includes(BookingStatus.IN_PROGRESS)) {
          statusValues.push(BookingStatus.IN_PROGRESS);
        } else if (validStatuses.includes(statusStr)) {
          statusValues.push(statusStr);
        }
      }
    });

    if (statusValues.length > 0) {
      // Remove duplicates
      const uniqueStatusValues = [...new Set(statusValues)];
      filter.status = { $in: uniqueStatusValues };
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
        .populate('serviceVariantId', 'name icon');

      // Split multi-item bookings into individual booking entries
      if (items.length > 0) {
        return items.map((item, index) => ({
          id: `${booking.bookingId}-${index + 1}`, // Unique ID for frontend list
          bookingId: booking.bookingId,
          // Only include the specific item for this "split" booking
          items: [{
            serviceId: (item.serviceId as any)?.id || (item.serviceId as any)?._id?.toString() || item.serviceId.toString(),
            serviceVariantId: (item.serviceVariantId as any)?.id || (item.serviceVariantId as any)?._id?.toString() || item.serviceVariantId.toString(),
            variantId: (item.serviceVariantId as any)?.id || (item.serviceVariantId as any)?._id?.toString() || item.serviceVariantId.toString(),
            variantName: item.variantName,
            serviceName: item.serviceName,
            icon: (item.serviceVariantId as any)?.icon || (item.serviceId as any)?.icon || null,
            price: item.finalPrice,
            originalPrice: item.originalPrice,
            creditCost: item.creditValue || 0,
            quantity: item.quantity
          }],
          // Show per-item price as the total amount for this card
          totalAmount: item.finalPrice,
          taxAmount: 0, // Not calculated per item in this view
          itemTotal: item.originalPrice,
          status: item.status,
          date: booking.scheduledDate ? booking.scheduledDate.toISOString() : booking.createdAt.toISOString(),
          time: booking.scheduledTime || '',
          address: {
            id: booking.addressId || '',
            label: booking.address?.label || 'Address',
            fullAddress: booking.address?.fullAddress || '',
            area: booking.address?.area,
            coordinates: booking.address?.coordinates,
            isDefault: false
          },
          type: ['SOS', 'ASAP', 'SCHEDULED'].includes(booking.bookingType) ? (booking.bookingType as any) : 'SCHEDULED',
          paymentStatus: booking.paymentStatus,
          createdAt: booking.createdAt.toISOString(),
          updatedAt: booking.updatedAt.toISOString(),
          creditsUsed: booking.creditsUsed || 0 // Include creditsUsed in list view
        }));
      }

      return []; // Return empty array if no items found
    })
  );

  // Flatten the array of arrays
  const flatBookings = bookingsWithItems.flat();

  const totalPages = Math.ceil(total / limit);

  res.status(200).json({
    success: true,
    data: {
      bookings: flatBookings,
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

  let { bookingId } = req.params;
  const requestedId = bookingId; // Store original requested ID
  let itemIndex = -1;

  console.log('[getUserBookingById] Original Booking ID:', bookingId, 'User ID:', userId);

  // Check for split booking ID format (BOOK-DATE-SEQ-IDX)
  // Standard: BOOK-20251211-001 (3 parts)
  // Split: BOOK-20251211-001-1 (4 parts)
  const parts = bookingId.split('-');
  if (parts.length === 4) {
    const rawIndex = parseInt(parts[3]);
    if (!isNaN(rawIndex)) {
      itemIndex = rawIndex - 1; // Convert 1-based to 0-based
      bookingId = parts.slice(0, 3).join('-'); // Reconstruct real booking ID
      console.log('[getUserBookingById] Parsed Split ID. Real ID:', bookingId, 'Index:', itemIndex);
    }
  }

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

    .populate('serviceVariantId', 'name description icon')
    .populate('assignedServiceLocationId', 'name address contactNumber contactPerson');

  // Filter for specific item if requested
  let displayItems = items;
  let specificItem: any = null;

  if (itemIndex >= 0) {
    if (itemIndex < items.length) {
      displayItems = [items[itemIndex]];
      specificItem = items[itemIndex];
    } else {
      // Index out of bounds - safeguard
      console.warn(`[getUserBookingById] Item index ${itemIndex} out of bounds for booking ${bookingId}`);
    }
  }

  // Generate booking OTP (4-digit, deterministic)
  const bookingOTP = generateBookingOTP(booking.bookingId);


  // Get assigned professional if any (from order items)
  let assignedProfessional = null;
  const itemsWithPartner = await OrderItem.find({ bookingId: booking._id })
    .populate('assignedPartnerId', 'name phone email rating jobsCompleted');

  if (specificItem) {
    // If viewing a specific item, only show the professional assigned to THIS item
    const currentItemWithPartner = itemsWithPartner.find(item => item._id.toString() === specificItem._id.toString());
    if (currentItemWithPartner && currentItemWithPartner.assignedPartnerId) {
      const partner = currentItemWithPartner.assignedPartnerId as any;
      // Determine status for hiding contact info
      const statusToCheck = specificItem ? specificItem.status : booking.status;
      const isCompleted = COMPLETED_BOOKING_STATUSES.includes(statusToCheck as any);

      assignedProfessional = {
        id: partner._id.toString(),
        name: partner.name || '',
        phone: isCompleted ? '' : partner.phone,
        email: isCompleted ? '' : partner.email,
        rating: partner.rating || 4.5,
        jobsCompleted: partner.jobsCompleted || 0
      };
    }
  } else {
    // Fallback for full booking view: show the first assigned professional found
    // (Or logic could be adjusted to show multiple if UI supported it)
    const itemWithPartner = itemsWithPartner.find(item => item.assignedPartnerId);
    if (itemWithPartner && itemWithPartner.assignedPartnerId) {
      const partner = itemWithPartner.assignedPartnerId as any;
      // Determine status for hiding contact info (fallback to global booking status if logic ambiguous, but use item status if available)
      const statusToCheck = specificItem ? specificItem.status : booking.status;
      const isCompleted = COMPLETED_BOOKING_STATUSES.includes(statusToCheck as any);

      assignedProfessional = {
        id: partner._id.toString(),
        name: partner.name || 'Professional',
        phone: isCompleted ? '' : partner.phone,
        email: isCompleted ? '' : partner.email,
        rating: partner.rating || 4.5,
        jobsCompleted: partner.jobsCompleted || 0
      };
    }
  }


  // Determine OTPs to return
  let finalStartOtp = bookingOTP;
  let finalEndOtp: string | undefined = undefined;

  if (specificItem) {
    if (specificItem.startJobOtp) finalStartOtp = specificItem.startJobOtp;
    if (specificItem.endJobOtp) finalEndOtp = specificItem.endJobOtp;
  } else if (items.length > 0) {
    // If no specific item requested but items exist, use first item's OTPs for backward compatibility?
    // Or just keep the booking-level OTP for start.
    if (items[0].startJobOtp) finalStartOtp = items[0].startJobOtp;
    if (items[0].endJobOtp) finalEndOtp = items[0].endJobOtp;
  }

  const bookingData = {
    id: requestedId, // Return the requested ID (virtual or real)
    bookingId: booking.bookingId, // The real database ID
    items: displayItems.map(item => ({
      serviceId: (item.serviceId as any).id || item.serviceId.toString(),
      variantId: (item.serviceVariantId as any).id || item.serviceVariantId.toString(),
      variantName: item.variantName,
      serviceName: item.serviceName,
      price: item.finalPrice,
      originalPrice: item.originalPrice,
      creditCost: item.creditValue,
      icon: (item.serviceVariantId as any)?.icon || (item.serviceId as any)?.icon || null,
      quantity: item.quantity,
      status: item.status, // Include item-level status
      customerVisitRequired: item.customerVisitRequired,
      paidWithCredits: item.paidWithCredits, // Include paidWithCredits flag
      assignedServiceLocation: item.assignedServiceLocationId ? {
        id: (item.assignedServiceLocationId as any)._id,
        name: (item.assignedServiceLocationId as any).name,
        address: (item.assignedServiceLocationId as any).address,
        contactNumber: (item.assignedServiceLocationId as any).contactNumber,
        contactPerson: (item.assignedServiceLocationId as any).contactPerson
      } : null
    })),
    // If specific item, show its price. Otherwise show total.
    totalAmount: specificItem ? specificItem.finalPrice : booking.totalAmount,
    itemTotal: specificItem ? specificItem.originalPrice : (booking.itemTotal || booking.totalAmount),
    creditsUsed: specificItem ? 0 : (booking.creditsUsed || 0), // Include creditsUsed (only for full booking, assume item split doesn't track per-item credits used easily yet for display, or just show global if logical)
    // Actually specificItem.creditValue * quantity is what was used for that item.
    // But let's just expose booking level creditsUsed for now or mapped if possible.
    // For specific item view, if paidWithCredits is true, we know creditValue * quantity was used.
    // detailed logic:
    // creditsUsed: specificItem ? (specificItem.paidWithCredits ? specificItem.creditValue * specificItem.quantity : 0) : (booking.creditsUsed || 0),
    // simpler:
    // creditsUsed: booking.creditsUsed || 0,
    paymentBreakdown: booking.paymentBreakdown || [],
    paymentId: booking.paymentId,
    orderId: booking.orderId,
    paymentDetails: booking.paymentDetails || null,
    paymentStatus: booking.paymentStatus,
    status: specificItem ? specificItem.status : booking.status,
    date: booking.scheduledDate ? booking.scheduledDate.toISOString() : booking.createdAt.toISOString(),
    time: booking.scheduledTime || '',
    address: {
      id: booking.addressId, // Fixed: use addressId string
      label: booking.address.label,
      fullAddress: booking.address.fullAddress,
      area: booking.address.area,
      coordinates: booking.address.coordinates,
      isDefault: false
    },
    type: booking.bookingType,
    rescheduleCount: booking.rescheduleCount,
    otp: finalStartOtp, // Use determined Start OTP
    endOtp: finalEndOtp, // Use determined End OTP
    professional: assignedProfessional,
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

// @desc    Get all bookings (Admin) - Refactored to query OrderItems first for granularity
// @route   GET /api/admin/bookings
// @access  Private/Admin
export const getAllBookings = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const statusFilter = req.query.status as string | undefined;
  const paymentStatusFilter = req.query.paymentStatus as string | undefined;
  const searchQuery = req.query.search as string | undefined;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const customerName = req.query.customerName as string | undefined;
  const customerPhone = req.query.customerPhone as string | undefined;
  const customerEmail = req.query.customerEmail as string | undefined;
  const assignedPartner = req.query.assignedPartner as string | undefined;

  // 1. Build Match Stage for OrderItem (Primary filters)
  const orderItemMatch: any = {};

  if (statusFilter) {
    const statusMap: Record<string, string | string[]> = {
      [BookingStatus.PENDING]: BookingStatus.PENDING,
      [BookingStatus.CONFIRMED]: BookingStatus.CONFIRMED,
      [BookingStatus.IN_PROGRESS]: BookingStatus.IN_PROGRESS,
      'ongoing': ONGOING_BOOKING_STATUSES,
      [BookingStatus.COMPLETED]: BookingStatus.COMPLETED,
      [BookingStatus.CANCELLED]: BookingStatus.CANCELLED,
      [BookingStatus.REFUND_INITIATED]: BookingStatus.REFUND_INITIATED,
      [BookingStatus.REFUNDED]: BookingStatus.REFUNDED,
      [BookingStatus.EN_ROUTE]: BookingStatus.EN_ROUTE,
      [BookingStatus.ASSIGNED]: BookingStatus.ASSIGNED,
      [BookingStatus.REACHED]: BookingStatus.REACHED
    };

    if (statusMap[statusFilter]) {
      const mappedStatus = statusMap[statusFilter];
      if (Array.isArray(mappedStatus)) {
        orderItemMatch.status = { $in: mappedStatus };
      } else {
        orderItemMatch.status = mappedStatus;
      }
    }
  }

  // Partner Filter: Resolve partner names to IDs first
  if (assignedPartner && assignedPartner.trim()) {
    const partnerRegex = { $regex: assignedPartner.trim(), $options: 'i' };
    const matchingPartners = await ServicePartner.find({ name: partnerRegex }).select('_id');
    const partnerIds = matchingPartners.map(p => p._id);
    if (partnerIds.length > 0) {
      orderItemMatch.assignedPartnerId = { $in: partnerIds };
    } else {
      // Force empty result if partner name matches nothing
      orderItemMatch.assignedPartnerId = new mongoose.Types.ObjectId();
    }
  }

  // 2. Prepare Booking & Customer Lookups and Filters
  const pipeline: any[] = [];

  // Match OrderItems first
  pipeline.push({ $match: orderItemMatch });

  // Lookup Booking
  pipeline.push({
    $lookup: {
      from: 'bookings',
      localField: 'bookingId',
      foreignField: '_id',
      as: 'booking'
    }
  });
  pipeline.push({ $unwind: '$booking' });

  // Filter by Booking fields (paymentStatus, dates)
  const bookingMatch: any = {};
  if (paymentStatusFilter) {
    const paymentMap: Record<string, string> = {
      'pending': 'pending',
      'paid': 'paid',
      'refunded': 'refunded'
    };
    if (paymentMap[paymentStatusFilter]) {
      bookingMatch['booking.paymentStatus'] = paymentMap[paymentStatusFilter];
    }
  }

  if (startDate || endDate) {
    const dateFilter: any = {};
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      dateFilter.$gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }

    // Support scheduledDate OR createdAt (for ASAP)
    bookingMatch.$or = [
      { 'booking.scheduledDate': dateFilter },
      {
        $and: [
          { $or: [{ 'booking.scheduledDate': { $exists: false } }, { 'booking.scheduledDate': null }] },
          { 'booking.createdAt': dateFilter }
        ]
      }
    ];
  }

  if (Object.keys(bookingMatch).length > 0) {
    pipeline.push({ $match: bookingMatch });
  }

  // Lookup Customer (User)
  pipeline.push({
    $lookup: {
      from: 'users',
      localField: 'booking.userId',
      foreignField: '_id',
      as: 'customer'
    }
  });
  pipeline.push({ $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } });

  // Filter by Customer fields
  const customerMatch: any = {};
  const searchMatch: any = [];

  // Customer specific filters
  if (customerName && customerName.trim()) {
    customerMatch['customer.name'] = { $regex: customerName.trim(), $options: 'i' };
  }
  if (customerPhone && customerPhone.trim()) {
    customerMatch['customer.phone'] = { $regex: customerPhone.trim(), $options: 'i' };
  }
  if (customerEmail && customerEmail.trim()) {
    customerMatch['customer.email'] = { $regex: customerEmail.trim(), $options: 'i' };
  }

  // General Search (Booking ID or Customer Details)
  if (searchQuery && searchQuery.trim()) {
    const escapedQuery = searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = { $regex: escapedQuery, $options: 'i' };

    searchMatch.push({ 'booking.bookingId': searchRegex });
    searchMatch.push({ 'customer.name': searchRegex });
    searchMatch.push({ 'customer.phone': searchRegex });
    searchMatch.push({ 'customer.email': searchRegex });
  }

  if (Object.keys(customerMatch).length > 0) {
    pipeline.push({ $match: customerMatch });
  }
  if (searchMatch.length > 0) {
    pipeline.push({ $match: { $or: searchMatch } });
  }

  // Lookup details for OrderItems (Service, Variant, Partner)
  // Since we started with OrderItem, these fields are on the root
  pipeline.push({
    $lookup: {
      from: 'services',
      localField: 'serviceId',
      foreignField: '_id',
      as: 'service'
    }
  });
  pipeline.push({ $unwind: { path: '$service', preserveNullAndEmptyArrays: true } });

  pipeline.push({
    $lookup: {
      from: 'servicevariants',
      localField: 'serviceVariantId',
      foreignField: '_id',
      as: 'variant'
    }
  });
  pipeline.push({ $unwind: { path: '$variant', preserveNullAndEmptyArrays: true } });

  pipeline.push({
    $lookup: {
      from: 'servicepartners',
      localField: 'assignedPartnerId',
      foreignField: '_id',
      as: 'partner'
    }
  });
  pipeline.push({ $unwind: { path: '$partner', preserveNullAndEmptyArrays: true } });

  // Sort
  pipeline.push({ $sort: { createdAt: -1 } });

  // Facet for Pagination
  pipeline.push({
    $facet: {
      metadata: [{ $count: 'total' }],
      data: [{ $skip: skip }, { $limit: limit }]
    }
  });

  // Execute Aggregation
  const result = await OrderItem.aggregate(pipeline);

  const metadata = result[0].metadata[0] || { total: 0 };
  const data = result[0].data || [];

  // Transform to response format
  const bookingsResponse = data.map((item: any) => {
    // Map to AdminBooking format, but representing a single item row
    const customer = item.customer || { _id: 'deleted', name: 'Deleted User', email: '', phone: '' };

    return {
      id: item._id, // Use OrderItem ID for uniqueness in table
      bookingId: item.booking.bookingId, // Display ID
      customer: {
        id: customer._id,
        name: customer.name || 'Unknown',
        email: customer.email,
        phone: customer.phone
      },
      items: [{
        id: item._id,
        serviceId: item.service?._id || item.serviceId,
        serviceName: item.serviceName,
        variantId: item.variant?._id || item.serviceVariantId,
        variantName: item.variantName,
        icon: item.variant?.icon || item.service?.icon || null,
        quantity: item.quantity,
        originalPrice: item.originalPrice,
        finalPrice: item.finalPrice,
        creditValue: item.creditValue,
        estimatedTimeMinutes: item.estimatedTimeMinutes,
        assignedPartner: item.partner ? {
          id: item.partner._id,
          name: item.partner.name,
          phone: item.partner.phone
        } : undefined,
        status: item.status,
        startJobOtp: item.startJobOtp,
        endJobOtp: item.endJobOtp,
        paidWithCredits: item.paidWithCredits
      }],
      address: item.booking.address,
      bookingType: item.booking.bookingType,
      scheduledDate: item.booking.scheduledDate,
      scheduledTime: item.booking.scheduledTime,
      totalAmount: item.finalPrice, // Show item price as row total
      itemTotal: item.originalPrice,
      totalOriginalAmount: item.booking.totalOriginalAmount,
      paymentStatus: item.booking.paymentStatus,
      status: item.status, // Item status
      notes: item.booking.notes,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  });

  res.status(200).json({
    success: true,
    data: {
      bookings: bookingsResponse,
      pagination: {
        page,
        limit,
        total: metadata.total,
        pages: Math.ceil(metadata.total / limit)
      }
    }
  });
});

// @desc    Get single booking by ID (Admin)
// @route   GET /api/admin/bookings/:id
// @access  Private/Admin
export const getBookingById = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  // Parse the ID to see if it's a composite ID (e.g. BOOK-20231211-001-1)
  // Format: BOOK-DATE-SEQ-INDEX
  const parts = id.split('-');
  let bookingId = id;
  let itemIndex = -1; // -1 means return all items

  if (parts.length === 4) {
    const rawIndex = parseInt(parts[3]);
    if (!isNaN(rawIndex)) {
      itemIndex = rawIndex - 1; // Convert 1-based to 0-based
      bookingId = parts.slice(0, 3).join('-'); // Reconstruct real booking ID
    }
  }

  const booking = await Booking.findOne({ bookingId }).populate('userId', 'name email phone');

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  const items = await OrderItem.find({ bookingId: booking._id })
    .populate('serviceId', 'name icon')
    .populate('serviceVariantId', 'name icon')
    .populate('assignedPartnerId', 'name phone email')
    .populate('assignedServiceLocationId', 'name address contactNumber');

  // If a specific item index was requested, filter for it
  let displayItems = items;
  let specificItem = null;
  if (itemIndex >= 0 && itemIndex < items.length) {
    displayItems = [items[itemIndex]];
    specificItem = items[itemIndex];
  }

  const bookingData = {
    id: booking._id,
    bookingId: booking.bookingId,
    customer: {
      id: (booking.userId as any)._id,
      name: (booking.userId as any).name,
      email: (booking.userId as any).email,
      phone: (booking.userId as any).phone
    },
    items: displayItems.map(item => ({
      id: item._id,
      serviceId: (item.serviceId as any)._id || item.serviceId,
      serviceName: item.serviceName,
      variantName: item.variantName,
      quantity: item.quantity,
      finalPrice: item.finalPrice,
      originalPrice: item.originalPrice,
      estimatedTimeMinutes: item.estimatedTimeMinutes,
      status: item.status,
      startJobOtp: item.startJobOtp,
      endJobOtp: item.endJobOtp,
      assignedPartner: item.assignedPartnerId ? {
        id: (item.assignedPartnerId as any)._id,
        name: (item.assignedPartnerId as any).name,
        phone: (item.assignedPartnerId as any).phone,
        email: (item.assignedPartnerId as any).email
      } : null,
      customerVisitRequired: item.customerVisitRequired,
      assignedServiceLocation: item.assignedServiceLocationId ? {
        id: (item.assignedServiceLocationId as any)._id,
        name: (item.assignedServiceLocationId as any).name,
        address: (item.assignedServiceLocationId as any).address,
        contactNumber: (item.assignedServiceLocationId as any).contactNumber
      } : null,
      paidWithCredits: item.paidWithCredits || false
    })),
    address: booking.address,
    bookingType: booking.bookingType,
    scheduledDate: booking.scheduledDate,
    scheduledTime: booking.scheduledTime,
    otp: items[0]?.startJobOtp,
    endOtp: items[0]?.endJobOtp,
    // If specific item, show its price. Otherwise show total.
    totalAmount: specificItem ? specificItem.finalPrice : booking.totalAmount,
    itemTotal: specificItem ? specificItem.originalPrice : (booking.itemTotal || booking.totalAmount),
    totalOriginalAmount: booking.totalOriginalAmount,
    paymentBreakdown: booking.paymentBreakdown || [],
    paymentId: booking.paymentId,
    orderId: booking.orderId,
    paymentDetails: booking.paymentDetails || null,
    status: specificItem ? specificItem.status : booking.status,
    paymentStatus: booking.paymentStatus,
    notes: booking.notes,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    actionLog: booking.actionLog,
    cancellationReason: booking.cancellationReason,
    refundAmount: booking.refundAmount,
    rescheduleCount: booking.rescheduleCount
  };

  res.status(200).json({
    success: true,
    data: {
      booking: bookingData
    }
  });
});


// @desc    Get eligible service partners for a booking
// @route   GET /api/admin/bookings/:id/eligible-partners
// @access  Private/Admin
export const getEligibleServicePartners = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params; // bookingId

  const booking = await Booking.findOne({ bookingId: id });
  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Get order items for this booking
  const orderItems = await OrderItem.find({ bookingId: booking._id })
    .populate('serviceId', 'id')
    .populate('serviceVariantId', 'id');

  if (orderItems.length === 0) {
    return next(new AppError('No order items found for this booking', 404));
  }

  // Get service IDs from order items
  const serviceIds = orderItems.map(item => (item.serviceId as any).id);
  const uniqueServiceIds = [...new Set(serviceIds)];

  // Get booking location
  const bookingLocation = booking.address.coordinates;
  if (!bookingLocation) {
    return next(new AppError('Booking location not found', 400));
  }

  // Find service regions that contain the booking location
  const activeRegions = await ServiceRegion.find({ isActive: true });
  const matchingRegionIds: string[] = [];

  for (const region of activeRegions) {
    if (isPointInPolygon(bookingLocation, region.polygon)) {
      matchingRegionIds.push(region._id.toString());
    }
  }

  // Find service partners who:
  // 1. Are active
  // 2. Have at least one matching service
  // 3. Have at least one matching service region (or no region restrictions)
  const partnerFilter: any = {
    isActive: true,
    services: { $in: uniqueServiceIds }
  };

  // If we found matching regions, filter by regions (or partners with no region restrictions)
  if (matchingRegionIds.length > 0) {
    partnerFilter.$or = [
      { serviceRegions: { $in: matchingRegionIds } },
      { serviceRegions: { $size: 0 } } // Partners available in all regions
    ];
  }

  const eligiblePartners = await ServicePartner.find(partnerFilter);

  // Check availability based on schedule
  const scheduledDate = booking.scheduledDate;
  const scheduledTime = booking.scheduledTime;

  // Separate partners into available and unavailable
  const availablePartners: any[] = [];
  const unavailablePartners: any[] = [];

  for (const partner of eligiblePartners) {
    const isAvailable = isPartnerAvailableAtTime(partner, scheduledDate, scheduledTime);
    const partnerData = {
      id: partner._id.toString(),
      name: partner.name,
      phone: partner.phone,
      email: partner.email,
      services: partner.services,
      serviceRegions: partner.serviceRegions,
      availability: partner.availability,
      isAvailable
    };

    if (isAvailable) {
      availablePartners.push(partnerData);
    } else {
      unavailablePartners.push(partnerData);
    }
  }

  // Sort available partners by name
  availablePartners.sort((a, b) => a.name.localeCompare(b.name));
  unavailablePartners.sort((a, b) => a.name.localeCompare(b.name));

  // Combine: available first, then unavailable
  const allPartners = [...availablePartners, ...unavailablePartners];

  res.status(200).json({
    success: true,
    data: {
      partners: allPartners,
      availableCount: availablePartners.length,
      unavailableCount: unavailablePartners.length
    }
  });
});

// @desc    Assign a service partner to a booking order item
// @route   POST /api/admin/bookings/:id/assign-partner
// @access  Private/Admin
export const assignServicePartner = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params; // bookingId
  const { orderItemId, partnerId } = req.body;

  if (!orderItemId || !partnerId) {
    return next(new AppError('Order item ID and partner ID are required', 400));
  }

  // Verify booking exists
  const booking = await Booking.findOne({ bookingId: id });
  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Verify order item belongs to this booking
  const orderItem = await OrderItem.findOne({
    _id: orderItemId,
    bookingId: booking._id
  });

  if (!orderItem) {
    return next(new AppError('Order item not found or does not belong to this booking', 404));
  }

  // Verify partner exists
  const partner = await ServicePartner.findById(partnerId);
  if (!partner) {
    return next(new AppError('Service partner not found', 404));
  }

  if (!partner.isActive) {
    return next(new AppError('Service partner is not active', 400));
  }

  // Update order item with assigned partner
  orderItem.assignedPartnerId = new mongoose.Types.ObjectId(partnerId);
  if (orderItem.status === 'pending') {
    orderItem.status = 'assigned';
  }
  await orderItem.save();
  await syncBookingStatus(booking._id);

  // Get updated order item with populated partner
  const updatedOrderItem = await OrderItem.findById(orderItem._id)
    .populate('assignedPartnerId', 'name phone email');

  res.status(200).json({
    success: true,
    message: 'Service partner assigned successfully',
    data: {
      orderItem: {
        id: updatedOrderItem!._id.toString(),
        assignedPartner: updatedOrderItem!.assignedPartnerId ? {
          id: (updatedOrderItem!.assignedPartnerId as any)._id.toString(),
          name: (updatedOrderItem!.assignedPartnerId as any).name,
          phone: (updatedOrderItem!.assignedPartnerId as any).phone,
          email: (updatedOrderItem!.assignedPartnerId as any).email
        } : null,
        status: updatedOrderItem!.status
      }
    }
  });
});

// @desc    Update order item status
// @route   PATCH /api/admin/bookings/:bookingId/items/:itemId/status
// @access  Private/Admin
export const updateOrderItemStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { bookingId, itemId } = req.params;
  const { status } = req.body;

  if (!status) {
    return next(new AppError('Status is required', 400));
  }

  // Define status order for validation
  // Status flow: PENDING -> CONFIRMED -> ASSIGNED -> EN_ROUTE -> REACHED -> IN_PROGRESS -> COMPLETED
  // CANCELLED/REFUNDED are terminal states
  const statusOrder = [
    BookingStatus.PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.ASSIGNED,
    BookingStatus.EN_ROUTE,
    BookingStatus.REACHED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED
  ];

  // Verify booking exists
  const booking = await Booking.findOne({ bookingId });
  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Verify order item and get current status
  const orderItem = await OrderItem.findOne({
    _id: itemId,
    bookingId: booking._id
  });

  if (!orderItem) {
    return next(new AppError('Order item not found or does not belong to this booking', 404));
  }

  const currentStatus = orderItem.status as BookingStatus;
  const newStatus = status as BookingStatus;

  // Validation Logic
  // 1. Prevent updates if current status is terminal
  if ([BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.REFUNDED].includes(currentStatus)) {
    return next(new AppError(`Cannot update item in ${currentStatus} state`, 400));
  }

  // 2. Prevent backward transitions in the active flow (simplistic check)
  const currentIndex = statusOrder.indexOf(currentStatus);
  const newIndex = statusOrder.indexOf(newStatus);

  if (currentIndex !== -1 && newIndex !== -1) {
    if (newIndex < currentIndex) {
      return next(new AppError('Cannot revert to a previous status', 400));
    }
  }

  // 3. Special checks for specific transitions if needed
  // e.g., cannot go to CANCELLED if already customized/started? (Business rule dependent)
  if ([BookingStatus.CANCELLED, BookingStatus.REFUND_INITIATED, BookingStatus.REFUNDED].includes(newStatus)) {
    if (currentStatus === BookingStatus.IN_PROGRESS || currentStatus === BookingStatus.COMPLETED) {
      return next(new AppError('Cannot cancel/refund item that is already in progress or completed', 400));
    }
  }

  // Update status
  orderItem.status = newStatus;
  await orderItem.save();

  // Handle Plan Activation for PLAN_PURCHASE bookings
  if (newStatus === BookingStatus.COMPLETED && booking.bookingType === 'PLAN_PURCHASE') {
    try {
      // Find the pending transaction for this booking
      const transaction = await PlanTransaction.findOne({ orderId: booking.bookingId, status: 'pending' });
      const planId = transaction ? transaction.planId : null;

      if (planId) {
        const plan = await Plan.findById(planId);
        if (plan) {
          // 1. Update UserPlan
          await UserPlan.findOneAndUpdate(
            { userId: booking.userId },
            { activePlanId: plan._id.toString() },
            { upsert: true }
          );

          // 2. Update UserCredits
          const userCredits = await UserCredits.findOne({ userId: booking.userId });
          const currentCredits = userCredits?.credits || 0;
          await UserCredits.findOneAndUpdate(
            { userId: booking.userId },
            { credits: currentCredits + plan.totalCredits },
            { upsert: true }
          );

          // 3. Mark transaction as completed
          if (transaction) {
            transaction.status = 'completed';
            await transaction.save();
          }

          console.log(`[updateOrderItemStatus] Plan ${plan.planName} activated for user ${booking.userId}`);
        }
      }
    } catch (activationError) {
      console.error('[updateOrderItemStatus] Error activating plan:', activationError);
      // We still proceed even if activation fails, but log it.
    }
  }

  // Handle SOS Resolution sync
  if (newStatus === BookingStatus.COMPLETED && booking.bookingType === 'SOS') {
    try {
      const sosAlert = await SOSAlert.findOne({ bookingId: booking._id });
      if (sosAlert && sosAlert.status !== 'RESOLVED') {
        sosAlert.status = SOSStatus.RESOLVED;
        sosAlert.resolvedAt = new Date();
        sosAlert.logs.push({
          action: 'RESOLVED',
          timestamp: new Date(),
          details: 'Auto-resolved via booking completion'
        });
        await sosAlert.save();
        socketService.emitToAdmin('sos:resolved', await sosAlert.populate('user', 'name phone email'));
      }
    } catch (sosError) {
      console.error('[updateOrderItemStatus] Error syncing SOS resolution:', sosError);
    }
  }

  // Sync parent booking status
  await syncBookingStatus(booking._id);

  res.status(200).json({
    success: true,
    data: {
      orderItem: {
        id: orderItem._id,
        status: orderItem.status
      },
      message: 'Item status updated successfully'
    }
  });
});

// @desc    Reschedule a booking
// @route   POST /api/admin/bookings/:id/reschedule
// @access  Private/Admin
export const rescheduleBooking = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params; // bookingId
  // performedBy from body or fallback to current user
  const { scheduledDate, scheduledTime, performedBy } = req.body;
  const currentUserName = (req.user as any)?.name || 'Admin';

  const booking = await Booking.findOne({ bookingId: id });

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Check status - can only reschedule if not IN_PROGRESS or beyond
  // Logic: Can reschedule if PENDING or CONFIRMED or ASSIGNED or EN_ROUTE or REACHED?
  // User req: "before the status is marked as InProgress"
  const restrictedStatuses = [
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.REFUNDED,
    BookingStatus.REFUND_INITIATED
  ];

  if (restrictedStatuses.includes(booking.status as BookingStatus)) {
    return next(new AppError(`Cannot reschedule booking in ${booking.status} status`, 400));
  }

  const oldDate = booking.scheduledDate ? new Date(booking.scheduledDate).toLocaleDateString() : 'ASAP';
  const oldTime = booking.scheduledTime || 'ASAP';

  booking.scheduledDate = new Date(scheduledDate);
  booking.scheduledTime = scheduledTime;
  // If it was ASAP, switch to SCHEDULED
  booking.bookingType = 'SCHEDULED';
  booking.rescheduleCount = (booking.rescheduleCount || 0) + 1;

  booking.actionLog.push({
    action: 'RESCHEDULE',
    performedBy: performedBy || currentUserName,
    timestamp: new Date(),
    details: `Rescheduled from ${oldDate} ${oldTime} to ${new Date(scheduledDate).toLocaleDateString()} ${scheduledTime}`
  });

  await booking.save();

  res.status(200).json({
    success: true,
    data: { booking }
  });
});

// @desc    Cancel a booking
// @route   POST /api/admin/bookings/:id/cancel
// @access  Private/Admin
export const cancelBooking = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params; // bookingId
  const { reason, performedBy } = req.body;
  const currentUserName = (req.user as any)?.name || 'Admin';

  const booking = await Booking.findOne({ bookingId: id });

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Check status - "only until status is marked as Arrived"
  // Assuming 'REACHED' means Arrived.
  // Allowed: PENDING, CONFIRMED, ASSIGNED, EN_ROUTE
  // Not Allowed: REACHED, IN_PROGRESS, COMPLETED, CANCELLED, REFUNDED

  const restrictedStatuses = [
    BookingStatus.REACHED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.REFUNDED,
    BookingStatus.REFUND_INITIATED
  ];

  if (restrictedStatuses.includes(booking.status as BookingStatus)) {
    return next(new AppError(`Cannot cancel booking in ${booking.status} status`, 400));
  }

  booking.status = BookingStatus.CANCELLED;
  booking.cancellationReason = reason;
  booking.refundAmount = booking.totalAmount; // Full refund

  // If paid, mark as refund initiated or refunded depending on flow. 
  // For now, let's mark logic:
  // If paid, we DO NOT automatically mark as refunded. Refund is a separate action.
  // The user explicitly requested: "Order Item cancellation and payment refund are 2 different functions."
  /* 
  if (booking.paymentStatus === 'paid') {
     // Removed automatic refund status update
  } 
  */

  booking.actionLog.push({
    action: 'CANCEL',
    performedBy: performedBy || currentUserName,
    timestamp: new Date(),
    details: `Cancelled. Reason: ${reason}`
  });

  await booking.save();

  // Also cancel related OrderItems
  await OrderItem.updateMany(
    { bookingId: booking._id },
    { $set: { status: BookingStatus.CANCELLED } }
  );

  res.status(200).json({
    success: true,
    data: { booking }
  });
});

// @desc    Assign a service location to a booking item
// @route   POST /api/admin/bookings/:bookingId/items/:itemId/assign-location
// @access  Private/Admin
export const assignServiceLocation = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { bookingId, itemId } = req.params;
  const { locationId } = req.body;
  const currentUserName = (req.user as any)?.name || 'Admin';

  if (!locationId) {
    return next(new AppError('Location ID is required', 400));
  }

  // 1. Verify Booking
  const booking = await Booking.findOne({ bookingId });
  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // 2. Verify Order Item
  const orderItem = await OrderItem.findOne({
    _id: itemId,
    bookingId: booking._id
  });

  if (!orderItem) {
    return next(new AppError('Order item not found for this booking', 404));
  }

  // 3. Verify Customer Visit Required
  if (!orderItem.customerVisitRequired) {
    return next(new AppError('This service does not require a customer visit', 400));
  }

  // 4. Verify Service Location exists
  const location = await ServiceLocation.findById(locationId);
  if (!location) {
    return next(new AppError('Service location not found', 404));
  }

  // 5. Assign Location & Log
  orderItem.assignedServiceLocationId = new mongoose.Types.ObjectId(locationId);
  await orderItem.save();

  booking.actionLog.push({
    action: 'ASSIGN_LOCATION',
    performedBy: currentUserName,
    timestamp: new Date(),
    details: `Assigned location: ${location.name} to item: ${orderItem.variantName}`
  });
  await booking.save();

  res.status(200).json({
    success: true,
    data: {
      orderItem,
      message: 'Service location assigned successfully'
    }
  });
});
