import { Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import OrderItem from '../models/OrderItem';
import ServicePartner from '../models/ServicePartner';
import Service from '../models/Service';
import ServiceRegion from '../models/ServiceRegion';
import { SOSAlert, SOSStatus } from '../models/SOSAlert';
import { isPointInPolygon } from '../utils/pointInPolygon';

import { BookingStatus, COMPLETED_BOOKING_STATUSES, ONGOING_BOOKING_STATUSES } from '../constants/bookingStatus';
import { syncBookingStatus } from '../services/bookingService';
import { formatTimeToIST } from '../utils/dateUtils';
import { socketService } from '../services/socketService';

// @desc    Get all assigned jobs for the logged-in provider
// @route   GET /api/provider/jobs
// @access  Private (ServicePartner)
export const getProviderJobs = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
        return next(new AppError('Not authenticated', 401));
    }

    // Find partner profile by phone
    const partner = await ServicePartner.findOne({ phone: user.phone });

    // If no partner record, we can still return an empty list of jobs for valid staff/admins
    if (!partner) {
        return res.status(200).json({
            success: true,
            data: { jobs: [] }
        });
    }

    // Find assigned order items
    // Filter by relevant statuses (not cancelled/refunded?) or show all
    const jobs = await OrderItem.find({
        assignedPartnerId: partner._id,
        status: {
            $in: [
                ...ONGOING_BOOKING_STATUSES,
                BookingStatus.COMPLETED
            ]
        }
    })
        .populate({
            path: 'bookingId',
            populate: { path: 'userId', select: 'name phone' }
        })
        .populate('serviceId', 'name icon')
        .populate('serviceVariantId', 'name description')
        .sort({ createdAt: -1 });

    // Transform data for the app
    const transformedJobs = jobs.map(job => {
        const booking = job.bookingId as any;
        if (!booking) return null;

        const isCompleted = COMPLETED_BOOKING_STATUSES.includes(job.status as BookingStatus);

        return {
            id: job._id,
            bookingId: booking._id, // Actual Booking MongoDB _id
            bookingDisplayId: booking.bookingId,
            serviceName: job.serviceName,
            serviceId: (job.serviceId as any)?._id,
            variantName: job.variantName,
            status: job.status,
            date: booking.scheduledDate || job.createdAt,
            time: booking.scheduledTime || formatTimeToIST(job.createdAt),
            address: isCompleted ? '' : (booking.address?.fullAddress || 'Address not found'),
            customerName: isCompleted ? '' : (booking.userId?.name || 'Customer'),
            customerPhone: isCompleted ? '' : (booking.userId?.phone || 'Hidden'),
            price: job.finalPrice,
            quantity: job.quantity,
            customerVisitRequired: job.customerVisitRequired,
            bookingType: booking.bookingType
        };
    }).filter(Boolean);

    res.status(200).json({
        success: true,
        data: {
            jobs: transformedJobs
        }
    });
});

// @desc    Get single job details
// @route   GET /api/provider/jobs/:id
// @access  Private (ServicePartner)
export const getJobDetails = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const user = req.user;

    const partner = await ServicePartner.findOne({ phone: user?.phone });
    if (!partner) {
        return next(new AppError('No partner profile associated with your account', 404));
    }

    let job = await OrderItem.findById(id)
        .populate({
            path: 'bookingId',
            populate: { path: 'userId', select: 'name phone' }
        })
        .populate('serviceId', 'name icon')
        .populate('serviceVariantId', 'name description');

    if (!job) {
        // Fallback: Check if the provided ID is a Booking ID
        job = await OrderItem.findOne({ bookingId: id })
            .populate({
                path: 'bookingId',
                populate: { path: 'userId', select: 'name phone' }
            })
            .populate('serviceId', 'name icon')
            .populate('serviceVariantId', 'name description');
    }

    if (!job) {
        // Fallback 2: Check if the provided ID is an SOS Alert ID
        const alert = await SOSAlert.findById(id);
        if (alert && alert.bookingId) {
            job = await OrderItem.findOne({ bookingId: alert.bookingId })
                .populate({
                    path: 'bookingId',
                    populate: { path: 'userId', select: 'name phone' }
                })
                .populate('serviceId', 'name icon')
                .populate('serviceVariantId', 'name description');
        }
    }

    if (!job) {
        return next(new AppError('Job not found', 404));
    }

    const booking = job.bookingId as any;
    const isSOS = booking?.bookingType === 'SOS';

    // Access control:
    // 1. If assigned to this partner, always allow
    // 2. If it is an SOS job, allow if partner has SOS service access
    // 3. Otherwise, deny access
    const isAssignedToMe = job.assignedPartnerId?.toString() === partner._id.toString();

    let hasAccess = isAssignedToMe;

    if (!hasAccess && isSOS) {
        const sosService = await Service.findOne({ name: { $regex: /^SOS/i } });
        if (sosService) {
            const sosServiceId = sosService._id.toString();
            const sosServiceSlug = (sosService as any).id;
            hasAccess = partner.services.includes(sosServiceId) ||
                (sosServiceSlug && partner.services.includes(sosServiceSlug));
        }
    }

    if (!hasAccess) {
        return next(new AppError('You are not authorized to view this job', 403));
    }

    const customer = booking.userId;

    const isCompleted = COMPLETED_BOOKING_STATUSES.includes(job.status as BookingStatus);

    // Calculate extra charges summary
    const extraCharges = job.extraCharges || [];
    const pendingCharges = extraCharges.filter(c => c.status === 'pending');
    const paidCharges = extraCharges.filter(c => c.status === 'paid');

    res.status(200).json({
        success: true,
        data: {
            job: {
                id: job._id,
                bookingDisplayId: booking.bookingId,
                serviceName: job.serviceName,
                serviceId: (job.serviceId as any)?._id,
                variantName: job.variantName,
                status: job.status,
                date: booking.scheduledDate,
                time: booking.scheduledTime,
                address: isCompleted ? '' : (booking.address?.fullAddress || 'Address not found'),
                customerName: isCompleted ? '' : (customer?.name || 'Customer'),
                customerPhone: isCompleted ? '' : (customer?.phone || ''),
                price: job.finalPrice,
                quantity: job.quantity,
                notes: booking.notes,
                customerVisitRequired: job.customerVisitRequired,
                bookingType: booking.bookingType,
                startOtpRequired: booking.bookingType !== 'SOS',
                endOtpRequired: true,
                // Extra charges
                extraCharges: extraCharges.map(charge => ({
                    id: charge.id,
                    amount: charge.amount,
                    description: charge.description,
                    status: charge.status,
                    paymentMethod: charge.paymentMethod,
                    addedAt: charge.addedAt,
                    paidAt: charge.paidAt
                })),
                extraChargesSummary: {
                    total: extraCharges.length,
                    pendingCount: pendingCharges.length,
                    paidCount: paidCharges.length,
                    totalPendingAmount: pendingCharges.reduce((sum, c) => sum + c.amount, 0),
                    totalPaidAmount: paidCharges.reduce((sum, c) => sum + c.amount, 0)
                },
                // Flag to indicate if job can be completed (no pending extra charges)
                canComplete: pendingCharges.length === 0
            }
        }
    });
});

// @desc    Update job status (En Route, Reached)
// @route   PUT /api/provider/jobs/:id/status
// @access  Private (ServicePartner)
export const updateJobStatus = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { status } = req.body;
    const user = req.user;

    // Allowed transitions
    const allowedStatuses = [BookingStatus.EN_ROUTE, BookingStatus.REACHED];

    if (!allowedStatuses.includes(status)) {
        return next(new AppError('Invalid status update. Use start/end endpoints for other statuses.', 400));
    }

    const partner = await ServicePartner.findOne({ phone: user?.phone });
    if (!partner) return next(new AppError('Partner not found', 404));

    const job = await OrderItem.findOne({
        _id: id,
        assignedPartnerId: partner._id
    });

    if (!job) return next(new AppError('Job not found', 404));

    job.status = status;
    await job.save();

    // Sync parent booking status
    await syncBookingStatus(job.bookingId, { id: user?.id, name: user?.name || '' });

    res.status(200).json({
        success: true,
        data: { job }
    });
});

// @desc    Start job (Verify OTP)
// @route   POST /api/provider/jobs/:id/start
// @access  Private (ServicePartner)
export const startJob = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { otp } = req.body;
    const user = req.user;

    if (!otp) return next(new AppError('OTP is required', 400));

    const partner = await ServicePartner.findOne({ phone: user?.phone });
    if (!partner) return next(new AppError('Partner not found', 404));

    const job = await OrderItem.findOne({
        _id: id,
        assignedPartnerId: partner._id
    });

    if (!job) return next(new AppError('Job not found', 404));

    if (job.status !== BookingStatus.REACHED && job.status !== BookingStatus.ASSIGNED) {
        // Allow starting if assigned or en_route too? ideally flow is strict.
        // Let's be lenient or check strict flow: Assigned -> EnRoute -> Reached -> InProgress
    }

    // Verify OTP (Skip if SOS)
    const isSOS = (job.bookingId as any)?.bookingType === 'SOS';
    if (!isSOS && job.startJobOtp !== otp) {
        return next(new AppError('Invalid Start OTP', 400));
    }

    job.status = BookingStatus.IN_PROGRESS;
    await job.save();

    // Sync parent booking status
    await syncBookingStatus(job.bookingId, { id: user?.id, name: user?.name || '' });

    res.status(200).json({
        success: true,
        message: 'Job started successfully',
        data: { job }
    });
});

// @desc    End job (Verify OTP)
// @route   POST /api/provider/jobs/:id/end
// @access  Private (ServicePartner)
export const endJob = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { otp } = req.body;
    const user = req.user;

    if (!otp) return next(new AppError('OTP is required', 400));

    const partner = await ServicePartner.findOne({ phone: user?.phone });
    if (!partner) return next(new AppError('Partner not found', 404));

    const job = await OrderItem.findOne({
        _id: id,
        assignedPartnerId: partner._id
    });

    if (!job) return next(new AppError('Job not found', 404));

    // Block completion if there are pending extra charges
    const pendingCharges = (job.extraCharges || []).filter(c => c.status === 'pending');
    if (pendingCharges.length > 0) {
        const pendingAmount = pendingCharges.reduce((sum, c) => sum + c.amount, 0);
        return next(new AppError(
            `Cannot complete job. Please collect ${pendingCharges.length} pending extra charge payment(s) totaling ₹${pendingAmount} before completing.`,
            400
        ));
    }

    // Verify OTP
    if (job.endJobOtp !== otp) {
        return next(new AppError('Invalid End OTP', 400));
    }

    job.status = BookingStatus.COMPLETED;
    job.completedAt = new Date();
    await job.save();

    // Sync parent booking status
    await syncBookingStatus(job.bookingId, { id: user?.id, name: user?.name || '' });

    res.status(200).json({
        success: true,
        message: 'Job completed successfully',
        data: { job }
    });
});


// @desc    Get provider profile
// @route   GET /api/provider/profile
// @access  Private (ServicePartner)
export const getProfile = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
        return next(new AppError('Not authenticated', 401));
    }

    const partner = await ServicePartner.findOne({ phone: user.phone });

    res.status(200).json({
        success: true,
        data: {
            partner: {
                id: partner?._id || user.id,
                name: partner?.name || user.name || 'Staff member',
                phone: partner?.phone || user.phone,
                email: partner?.email || user.email,
                role: user.role,
                isActive: partner?.isActive ?? true,
                services: partner?.services || [],
                serviceRegions: partner?.serviceRegions || [],
                availability: partner?.availability || []
            }
        }
    });
});

// @desc    Get SOS alerts in the partner's service regions
// @route   GET /api/provider/sos
// @access  Private (ServicePartner)
export const getPartnerSOSAlerts = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(new AppError('Not authenticated', 401));

    const partner = await ServicePartner.findOne({ phone: user.phone });
    if (!partner) return next(new AppError('Partner profile not found', 404));

    // Check if partner is assigned to the SOS service
    const sosService = await Service.findOne({ name: { $regex: /^SOS/i } });
    if (!sosService) {
        return res.status(200).json({ success: true, data: { alerts: [] } });
    }

    const sosServiceId = sosService._id.toString();
    const sosServiceSlug = (sosService as any).id;
    const hasSosAccess = partner.services.includes(sosServiceId) ||
        (sosServiceSlug && partner.services.includes(sosServiceSlug));

    if (!hasSosAccess) {
        return res.status(403).json({
            success: false,
            message: 'You do not have access to the SOS service',
            data: { alerts: [] }
        });
    }

    // Find all active SOS alerts
    const activeStatuses = [
        SOSStatus.TRIGGERED,
        SOSStatus.ACKNOWLEDGED,
        SOSStatus.PARTNER_ASSIGNED,
        SOSStatus.EN_ROUTE,
        SOSStatus.REACHED,
        SOSStatus.IN_PROGRESS
    ];

    const allActiveAlerts = await SOSAlert.find({ status: { $in: activeStatuses } })
        .populate('user', 'name phone email')
        .populate('familyMemberId', 'name relationship phone')
        .sort({ createdAt: -1 });

    // Filter alerts by partner's service regions
    const partnerRegionIds = partner.serviceRegions || [];
    const hasNoRegionRestriction = partnerRegionIds.length === 0;

    let filteredAlerts;
    if (hasNoRegionRestriction) {
        // Partner with no region restrictions sees all SOS
        filteredAlerts = allActiveAlerts;
    } else {
        // Load all active regions and check which alerts fall within partner's regions
        const activeRegions = await ServiceRegion.find({
            _id: { $in: partnerRegionIds },
            isActive: true
        });

        filteredAlerts = allActiveAlerts.filter(alert => {
            if (!alert.location?.latitude || !alert.location?.longitude) return false;
            const point = { lat: alert.location.latitude, lng: alert.location.longitude };
            return activeRegions.some(region => isPointInPolygon(point, region.polygon));
        });
    }

    // Transform and add assignment info
    const transformedAlerts = await Promise.all(filteredAlerts.map(async (alert) => {
        // Find the booking and order item to determine assignment
        let assignedPartnerId: string | null = null;
        let assignedPartnerName: string | null = null;
        let isAssignedToMe = false;
        let jobId: string | null = null;

        if (alert.bookingId) {
            const orderItem = await OrderItem.findOne({ bookingId: alert.bookingId })
                .populate('assignedPartnerId', 'name phone');
            if (orderItem) {
                jobId = orderItem._id.toString();
                if (orderItem.assignedPartnerId) {
                    const assigned = orderItem.assignedPartnerId as any;
                    assignedPartnerId = assigned._id?.toString() || null;
                    assignedPartnerName = assigned.name || null;
                    isAssignedToMe = assignedPartnerId === partner._id.toString();
                }
            }
        }

        return {
            id: alert._id,
            sosId: alert.sosId,
            status: alert.status,
            location: alert.location,
            customer: alert.user ? {
                name: (alert.user as any).name,
                phone: (alert.user as any).phone,
            } : null,
            familyMember: alert.familyMemberId ? {
                name: (alert.familyMemberId as any).name,
                relationship: (alert.familyMemberId as any).relationship,
                phone: (alert.familyMemberId as any).phone,
            } : null,
            bookingId: alert.bookingId,
            jobId,
            assignedPartnerId,
            assignedPartnerName,
            isAssignedToMe,
            isReadOnly: !isAssignedToMe,
            createdAt: alert.createdAt,
            updatedAt: alert.updatedAt,
        };
    }));

    res.status(200).json({
        success: true,
        data: { alerts: transformedAlerts }
    });
});

// @desc    Get unassigned SOS alerts in the partner's service regions (for popup)
// @route   GET /api/provider/sos/unassigned
// @access  Private (ServicePartner)
export const getUnassignedSOSAlerts = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(new AppError('Not authenticated', 401));

    const partner = await ServicePartner.findOne({ phone: user.phone });
    if (!partner) return next(new AppError('Partner profile not found', 404));

    // Check if partner has SOS service
    const sosService = await Service.findOne({ name: { $regex: /^SOS/i } });
    if (!sosService) return res.status(200).json({ success: true, data: { alerts: [] } });

    const sosServiceId = sosService._id.toString();
    const sosServiceSlug = (sosService as any).id;
    const hasSosAccess = partner.services.includes(sosServiceId) ||
        (sosServiceSlug && partner.services.includes(sosServiceSlug));

    if (!hasSosAccess) {
        return res.status(403).json({
            success: false,
            message: 'You do not have access to the SOS service',
            data: { alerts: [] }
        });
    }

    // Find all SOS alerts that are not terminal (RESOLVED or CANCELLED)
    const potentialAlerts = await SOSAlert.find({
        status: { $nin: [SOSStatus.RESOLVED, SOSStatus.CANCELLED] }
    })
        .populate('user', 'name phone email')
        .populate('familyMemberId', 'name relationship phone')
        .sort({ createdAt: -1 });

    // Filter: only alerts where the order item has NO assigned partner
    const unassignedAlerts = [];
    for (const alert of potentialAlerts) {
        if (!alert.bookingId) {
            // No booking yet — treat as unassigned
            unassignedAlerts.push(alert);
            continue;
        }
        const orderItem = await OrderItem.findOne({ bookingId: alert.bookingId });
        if (!orderItem || !orderItem.assignedPartnerId) {
            unassignedAlerts.push(alert);
        }
    }

    // Filter by partner's regions
    const partnerRegionIds = partner.serviceRegions || [];
    const hasNoRegionRestriction = partnerRegionIds.length === 0;

    let filteredAlerts;
    if (hasNoRegionRestriction) {
        filteredAlerts = unassignedAlerts;
    } else {
        const activeRegions = await ServiceRegion.find({
            _id: { $in: partnerRegionIds },
            isActive: true
        });

        filteredAlerts = unassignedAlerts.filter(alert => {
            if (!alert.location?.latitude || !alert.location?.longitude) return false;
            const point = { lat: alert.location.latitude, lng: alert.location.longitude };
            return activeRegions.some(region => isPointInPolygon(point, region.polygon));
        });
    }

    const transformedAlerts = await Promise.all(filteredAlerts.map(async (alert) => {
        let jobId: string | null = null;
        if (alert.bookingId) {
            const orderItem = await OrderItem.findOne({ bookingId: alert.bookingId });
            if (orderItem) {
                jobId = orderItem._id.toString();
            }
        }

        return {
            id: alert._id,
            sosId: alert.sosId,
            status: alert.status,
            location: alert.location,
            customer: alert.user ? {
                name: (alert.user as any).name,
                phone: (alert.user as any).phone,
            } : null,
            familyMember: alert.familyMemberId ? {
                name: (alert.familyMemberId as any).name,
                relationship: (alert.familyMemberId as any).relationship,
                phone: (alert.familyMemberId as any).phone,
            } : null,
            bookingId: alert.bookingId,
            jobId,
            isAssignedToMe: false,
            isReadOnly: true,
            createdAt: alert.createdAt,
        };
    }));

    res.status(200).json({
        success: true,
        data: { alerts: transformedAlerts }
    });
});

// @desc    Accept/self-assign an SOS alert
// @route   POST /api/provider/sos/:id/accept
// @access  Private (ServicePartner)
export const acceptSOSAlert = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const user = req.user;
    if (!user) return next(new AppError('Not authenticated', 401));

    const partner = await ServicePartner.findOne({ phone: user.phone });
    if (!partner) return next(new AppError('Partner profile not found', 404));

    // Verify partner has SOS service
    const sosService = await Service.findOne({ name: { $regex: /^SOS/i } });
    if (!sosService) return next(new AppError('SOS service not found', 404));

    const sosServiceId = sosService._id.toString();
    const sosServiceSlug = (sosService as any).id;
    const hasSosAccess = partner.services.includes(sosServiceId) ||
        (sosServiceSlug && partner.services.includes(sosServiceSlug));

    if (!hasSosAccess) {
        return next(new AppError('You are not authorized for SOS service', 403));
    }

    // Find the SOS alert
    const alert = await SOSAlert.findById(id);
    if (!alert) return next(new AppError('SOS alert not found', 404));

    // Must be in TRIGGERED or ACKNOWLEDGED status
    if (![SOSStatus.TRIGGERED, SOSStatus.ACKNOWLEDGED].includes(alert.status)) {
        return next(new AppError('This SOS has already been assigned or resolved', 400));
    }

    // Check if already assigned
    if (alert.bookingId) {
        const orderItem = await OrderItem.findOne({ bookingId: alert.bookingId });
        if (orderItem?.assignedPartnerId) {
            return next(new AppError('This SOS has already been accepted by another partner', 400));
        }

        // Assign partner to the order item
        if (orderItem) {
            orderItem.assignedPartnerId = partner._id;
            orderItem.status = BookingStatus.ASSIGNED;
            await orderItem.save();
        }
    }

    // Update SOS alert status
    alert.status = SOSStatus.PARTNER_ASSIGNED;
    alert.logs.push({
        action: 'PARTNER_SELF_ASSIGNED',
        timestamp: new Date(),
        performedBy: partner._id as any,
        details: `Partner ${partner.name} self-assigned via app`
    });
    await alert.save();

    // Update partner's lastAssignedAt
    partner.lastAssignedAt = new Date();
    await partner.save();

    // Sync booking status
    if (alert.bookingId) {
        await syncBookingStatus(alert.bookingId, { id: partner._id, name: partner.name });
    }

    // Emit to admins
    const populatedAlert = await alert.populate('user', 'name phone email');
    socketService.emitToAdmin('sos:acknowledged', populatedAlert);

    res.status(200).json({
        success: true,
        message: 'SOS accepted successfully. You are now assigned to this emergency.',
        data: {
            sosId: alert.sosId,
            status: alert.status
        }
    });
});
