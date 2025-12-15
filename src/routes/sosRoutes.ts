import express from 'express';
import { protect } from '../middleware/auth';
import { requireAdmin } from '../middleware/adminAuth';
import {
    triggerSOS,
    cancelSOS,
    acknowledgeSOS,
    resolveSOS,
    getActiveSOS,
    getAllSOS
} from '../controllers/sosController';

const router = express.Router();

// Customer Endpoints (Protected by user auth)
router.post('/trigger', protect, triggerSOS);
router.post('/cancel', protect, cancelSOS);

// Admin Endpoints (Protected by admin auth)
router.get('/active', requireAdmin, getActiveSOS);
router.get('/history', requireAdmin, getAllSOS);
router.post('/:id/acknowledge', requireAdmin, acknowledgeSOS);
router.post('/:id/resolve', requireAdmin, resolveSOS);

export default router;
