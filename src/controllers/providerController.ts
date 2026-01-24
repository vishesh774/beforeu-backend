import { Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import OrderItem from '../models/OrderItem';
import ServicePartner from '../models/ServicePartner';

import { BookingStatus, COMPLETED_BOOKING_STATUSES, ONGOING_BOOKING_STATUSES } from '../constants/bookingStatus';
import { syncBookingStatus } from '../services/bookingService';
import { formatTimeToIST } from '../utils/dateUtils';

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

    const job = await OrderItem.findOne({
        _id: id,
        assignedPartnerId: partner._id
    })
        .populate({
            path: 'bookingId',
            populate: { path: 'userId', select: 'name phone' }
        })
        .populate('serviceId', 'name icon')
        .populate('serviceVariantId', 'name description');

    if (!job) {
        return next(new AppError('Job not found or not assigned to you', 404));
    }

    const booking = job.bookingId as any;
    const customer = booking.userId;

    const isCompleted = COMPLETED_BOOKING_STATUSES.includes(job.status as BookingStatus);

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
                endOtpRequired: true
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

    // Verify OTP
    if (job.endJobOtp !== otp) {
        return next(new AppError('Invalid End OTP', 400));
    }

    job.status = BookingStatus.COMPLETED;
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
                availability: partner?.availability || []
            }
        }
    });
});
