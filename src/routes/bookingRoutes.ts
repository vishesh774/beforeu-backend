import express from 'express';
import { getAllServices, getServicesByLocation, getSubServicesByServiceId, createBooking, getUserBookings, getUserBookingById, rescheduleBooking, cancelBooking } from '../controllers/bookingController';
import { protect } from '../middleware/auth';

const router = express.Router();

// Public routes - get services
router.get('/services/all', getAllServices);
router.get('/services/by-location', getServicesByLocation);
router.get('/services/:serviceId/sub-services', getSubServicesByServiceId);

// Protected routes - require authentication
// IMPORTANT: More specific routes (with params) must come before less specific ones
router.get('/bookings/:bookingId', protect, getUserBookingById);
router.post('/bookings', protect, createBooking);
router.get('/bookings', protect, getUserBookings);
router.post('/bookings/:id/reschedule', protect, rescheduleBooking); // Using :id to match controller param
router.post('/bookings/:id/cancel', protect, cancelBooking); // Using :id to match controller param

export default router;

