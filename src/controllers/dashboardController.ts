
import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import User from '../models/User';
import Booking from '../models/Booking';
import Service from '../models/Service';
import { BookingStatus } from '../constants/bookingStatus';

// @desc    Get dashboard metrics
// @route   GET /api/admin/metrics
// @access  Private/Admin
export const getDashboardMetrics = asyncHandler(async (_req: Request, res: Response, _next: NextFunction) => {
    // 1. Total Active Customers (Role 'customer', isActive: true)
    const activeCustomersCount = await User.countDocuments({
        role: 'customer',
        isActive: true
    });

    // 2. All Time Bookings (Count of all bookings)
    const totalBookingsCount = await Booking.countDocuments({});

    // 3. Active Services (Count of active services)
    const activeServicesCount = await Service.countDocuments({ isActive: true });

    // 4. Revenue (Total amount of all COMPLETED bookings)
    // We sum up the totalAmount of bookings where status is 'COMPLETED'
    const revenueResult = await Booking.aggregate([
        { $match: { status: BookingStatus.COMPLETED } },
        { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" } } }
    ]);
    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

    // 5. Recent Activity (Latest 5 bookings)
    // We'll fetch basic details: bookingId, customer name, date, amount, status
    const recentBookings = await Booking.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('userId', 'name email');

    const recentActivity = recentBookings.map(booking => ({
        id: booking._id,
        bookingId: booking.bookingId,
        customerName: (booking.userId as any)?.name || 'Unknown',
        amount: booking.totalAmount,
        status: booking.status,
        date: booking.createdAt
    }));

    res.status(200).json({
        success: true,
        data: {
            activeCustomers: activeCustomersCount,
            totalBookings: totalBookingsCount,
            activeServices: activeServicesCount,
            totalRevenue: totalRevenue,
            recentActivity: recentActivity
        }
    });
});
