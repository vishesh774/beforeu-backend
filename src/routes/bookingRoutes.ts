import express from 'express';
import {
    getAllServices,
    getServicesByLocation,
    getSubServicesByServiceId,
    createBooking,
    getUserBookings,
    getUserBookingById,
    rescheduleBooking,
    cancelBooking
} from '../controllers/bookingController';
import { getUserInvoicePDF } from '../controllers/invoiceController';
import { protect } from '../middleware/auth';
import {
    getCustomerPendingPayments,
    createCustomerPaymentOrder,
    verifyCustomerPayment
} from '../controllers/extraChargesController';

const router = express.Router();

// Public routes - get services
router.get('/services/all', getAllServices);
router.get('/services/by-location', getServicesByLocation);
router.get('/services/:serviceId/sub-services', getSubServicesByServiceId);

// Protected routes - require authentication
// IMPORTANT: More specific routes (with params) must come before less specific ones

// Extra charges payment routes for customers (must be before :bookingId routes)
router.get('/bookings/pending-extra-payments', protect, getCustomerPendingPayments);

// Standard booking routes
router.post('/bookings', protect, createBooking);
router.get('/bookings', protect, getUserBookings);
router.get('/bookings/:bookingId', protect, getUserBookingById);
router.get('/bookings/:id/invoice', protect, getUserInvoicePDF);
router.post('/bookings/:id/reschedule', protect, rescheduleBooking);
router.post('/bookings/:id/cancel', protect, cancelBooking);

// Extra charges payment routes (with booking ID params)
router.post('/bookings/:bookingId/items/:itemId/extra-charges/:chargeId/pay', protect, createCustomerPaymentOrder);
router.post('/bookings/:bookingId/items/:itemId/extra-charges/:chargeId/verify', protect, verifyCustomerPayment);

export default router;
