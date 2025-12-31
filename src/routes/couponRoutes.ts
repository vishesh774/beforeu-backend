import express from 'express';
import {
    createCoupon,
    getCoupons,
    deleteCoupon,
    getApplicableCoupons,
    validateCoupon,
    appendPhoneNumbers,
    getCouponsWithUsers
} from '../controllers/couponController';
import { protect } from '../middleware/auth';
import { requireAdmin } from '../middleware/adminAuth';

const router = express.Router();

// Public/Protected routes
router.use(protect); // All routes below require authentication

router.get('/applicable', getApplicableCoupons);
router.post('/validate', validateCoupon);

// Admin routes
router.route('/')
    .post(requireAdmin, createCoupon)
    .get(requireAdmin, getCoupons);

router.get('/with-users', requireAdmin, getCouponsWithUsers);
router.post('/:id/append-phones', requireAdmin, appendPhoneNumbers);

router.route('/:id')
    .delete(requireAdmin, deleteCoupon);

export default router;
