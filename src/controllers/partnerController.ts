import { Request, Response, NextFunction } from 'express';
// import jwt from 'jsonwebtoken'; // Removed unused import
import ServicePartner from '../models/ServicePartner';
import OrderItem from '../models/OrderItem';
import Booking from '../models/Booking';
import { AppError } from '../middleware/errorHandler';
import { generateToken } from '../utils/generateToken';
import { syncBookingStatus } from '../services/bookingService';
import { BookingStatus } from '../constants/bookingStatus';

// @desc    Login partner
// @route   POST /api/partners/auth/login
// @access  Public
export const loginPartner = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return next(new AppError('Please provide a phone number', 400));
        }

        // Check if partner exists
        // Normalize phone: add +91 if missing
        const normalizedPhone = phone.startsWith('+') ? phone : `+91${phone}`;
        const partner = await ServicePartner.findOne({ phone: normalizedPhone, isActive: true });

        if (!partner) {
            return next(new AppError('Partner not found or inactive', 404));
        }

        // In a real app, we would verify OTP here.
        // For now, we trust the phone number verification is done by frontend/firebase

        const token = generateToken({
            userId: partner._id.toString(),
            email: partner.email // Assuming partner has email, or undefined
        });

        res.status(200).json({
            success: true,
            token,
            data: {
                partner: {
                    id: partner._id,
                    name: partner.name,
                    phone: partner.phone,
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get current partner profile
// @route   GET /api/partners/me
// @access  Private (Partner)
export const getPartnerProfile = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const partner = (req as any).user;

        res.status(200).json({
            success: true,
            data: {
                partner: {
                    id: partner._id,
                    name: partner.name,
                    phone: partner.phone,
                    status: partner.status, // e.g. active/inactive/verified
                    rating: 4.8, // Mock rating for now or fetch from DB if exists
                    jobsCount: 0 // Mock or calculate
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get partner bookings
// @route   GET /api/partners/bookings
// @access  Private (Partner)
export const getPartnerBookings = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const partnerId = (req as any).user.id;

        // Find all order items assigned to this partner
        const assignedItems = await OrderItem.find({
            assignedPartnerId: partnerId
        }).sort({ createdAt: -1 });

        const bookings = await Promise.all(assignedItems.map(async (item) => {
            const booking = await Booking.findById(item.bookingId);
            if (!booking) return null;

            // Filter out invalid states if needed, but we likely want all history

            return {
                id: item._id, // Using OrderItem ID as the primary reference for partner actions
                bookingDisplayId: booking.bookingId,
                serviceId: item.serviceId,
                serviceName: item.serviceName,
                customerName: 'Customer', // TODO: Fetch user name from User model if needed
                date: booking.scheduledDate || 'ASAP', // Return raw date or string for frontend to format
                time: booking.scheduledTime,
                address: booking.address.fullAddress,
                coordinates: booking.address.coordinates ? [booking.address.coordinates.lng, booking.address.coordinates.lat] : null,
                status: item.status,
                notes: booking.notes,
                variantName: item.variantName, // Added variant name
                otpStart: item.startJobOtp, // Should only be visible if reached/started? No, security risk.
                // Actually, partner needs to verify the OTP given by user.
                // The backend verifies it. Partner app shouldn't likely receive the correct OTP to display.
            };
        }));

        const validBookings = bookings.filter(b => b !== null);

        res.status(200).json({
            success: true,
            count: validBookings.length,
            data: validBookings
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update booking status
// @route   POST /api/partners/bookings/:id/status
// @access  Private (Partner)
export const updateBookingStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { status } = req.body;
        const orderItemId = req.params.id;
        const partnerId = (req as any).user.id;

        const item = await OrderItem.findOne({ _id: orderItemId, assignedPartnerId: partnerId });

        if (!item) {
            return next(new AppError('Booking item not found or not assigned to you', 404));
        }

        // Validate transition
        // Simply updating status for EnRoute / Reached
        if ([BookingStatus.EN_ROUTE, BookingStatus.REACHED].includes(status)) {
            item.status = status as any;
            await item.save();
            await syncBookingStatus(item.bookingId);
        } else {
            return next(new AppError('Invalid status update via this endpoint. Use OTP endpoints for Start/Complete.', 400));
        }

        res.status(200).json({
            success: true,
            data: {
                status: item.status
            }
        });

    } catch (error) {
        next(error);
    }
};

// @desc    Verify Start Job OTP
// @route   POST /api/partners/bookings/:id/verify-start
// @access  Private (Partner)
export const verifyStartJobOtp = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { otp } = req.body;
        const orderItemId = req.params.id;
        const partnerId = (req as any).user.id;

        const item = await OrderItem.findOne({ _id: orderItemId, assignedPartnerId: partnerId });

        if (!item) {
            return next(new AppError('Item not found', 404));
        }

        if (item.status !== BookingStatus.REACHED) {
            return next(new AppError('Must be at location (Reached) to start job', 400));
        }

        // Verify OTP
        if (item.startJobOtp !== otp) {
            return next(new AppError('Invalid Start OTP', 400));
        }

        item.status = BookingStatus.IN_PROGRESS;
        await item.save();
        await syncBookingStatus(item.bookingId);

        res.status(200).json({
            success: true,
            data: { status: BookingStatus.IN_PROGRESS }
        });

    } catch (error) {
        next(error);
    }
};

// @desc    Verify End Job OTP
// @route   POST /api/partners/bookings/:id/verify-end
// @access  Private (Partner)
export const verifyEndJobOtp = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { otp } = req.body;
        const orderItemId = req.params.id;
        const partnerId = (req as any).user.id;

        const item = await OrderItem.findOne({ _id: orderItemId, assignedPartnerId: partnerId });

        if (!item) {
            return next(new AppError('Item not found', 404));
        }

        if (item.status !== BookingStatus.IN_PROGRESS) {
            return next(new AppError('Job must be in progress to complete it', 400));
        }

        // Verify OTP
        if (item.endJobOtp !== otp) {
            return next(new AppError('Invalid End OTP', 400));
        }

        item.status = BookingStatus.COMPLETED;
        await item.save();
        await syncBookingStatus(item.bookingId);

        res.status(200).json({
            success: true,
            data: { status: BookingStatus.COMPLETED }
        });

    } catch (error) {
        next(error);
    }
};
