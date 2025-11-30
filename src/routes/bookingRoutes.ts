import express from 'express';
import { getServicesByLocation, createBooking, getUserBookings } from '../controllers/bookingController';
import { protect } from '../middleware/auth';

const router = express.Router();

// Public route - get services by location
router.get('/services/by-location', getServicesByLocation);

// Protected routes - require authentication
router.post('/bookings', protect, createBooking);
router.get('/bookings', protect, getUserBookings);

export default router;

