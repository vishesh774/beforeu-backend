import express from 'express';
import { protect } from '../middleware/auth';
import { requireAdmin } from '../middleware/adminAuth';
import {
    createOrUpdateReview,
    getReviewByBooking,
    getAllReviews,
    publishReview
} from '../controllers/reviewController';

const router = express.Router();

// Customer routes
router.post('/', protect, createOrUpdateReview);
router.get('/booking/:bookingId', protect, getReviewByBooking);

// Admin routes
router.get('/admin/all', protect, requireAdmin, getAllReviews);
router.put('/admin/:id/publish', protect, requireAdmin, publishReview);

export default router;
