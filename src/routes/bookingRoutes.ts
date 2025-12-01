import express from 'express';
import { getServicesByLocation, createBooking, getUserBookings, getUserBookingById } from '../controllers/bookingController';
import { protect } from '../middleware/auth';

const router = express.Router();

// Public route - get services by location
router.get('/services/by-location', getServicesByLocation);

// Protected routes - require authentication
// IMPORTANT: More specific routes (with params) must come before less specific ones
router.get('/bookings/:bookingId', protect, getUserBookingById);
router.post('/bookings', protect, createBooking);
router.get('/bookings', protect, getUserBookings);

export default router;

