import express from 'express';
import {
    getMyReferralInfo,
    verifyReferralCode
} from '../controllers/referralController';
import { protect } from '../middleware/auth';

const router = express.Router();

// Public routes
router.get('/verify/:code', verifyReferralCode);

// Private customer routes
router.get('/my-code', protect, getMyReferralInfo);

// Private customer routes
router.get('/my-code', protect, getMyReferralInfo);

export default router;
