import express from 'express';
import { createOrder, verifyPayment, testRazorpayConfig } from '../controllers/paymentController';
import { protect } from '../middleware/auth';

const router = express.Router();

// Protected routes - require authentication
router.get('/payments/test-config', protect, testRazorpayConfig);
router.post('/payments/create-order', protect, createOrder);
router.post('/payments/verify', protect, verifyPayment);

export default router;

