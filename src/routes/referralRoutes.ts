import express from 'express';
import {
    getReferralConfig,
    updateReferralConfig,
    getMyReferralInfo,
    verifyReferralCode,
    getAdminUserReferralStats
} from '../controllers/referralController';
import { protect, authorize } from '../middleware/auth';

const router = express.Router();

// Public routes
router.get('/verify/:code', verifyReferralCode);

// Private customer routes
router.get('/my-code', protect, getMyReferralInfo);

// Admin routes
router.get('/config', protect, authorize('Admin'), getReferralConfig);
router.post('/config', protect, authorize('Admin'), updateReferralConfig);
router.get('/stats/:userId', protect, authorize('Admin', 'Supervisor', 'Incharge'), getAdminUserReferralStats);

export default router;
