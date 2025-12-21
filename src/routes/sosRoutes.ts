import express from 'express';
import { protect } from '../middleware/auth';
import { requireAdmin } from '../middleware/adminAuth';
import {
    triggerSOS,
    cancelSOS,
    acknowledgeSOS,
    resolveSOS,
    getActiveSOS,
    getAllSOS,
    getSOSDetails,
    updatePartnerLocation,
    getSOSAlertByBookingId
} from '../controllers/sosController';

const router = express.Router();

// Customer/Partner Endpoints (Protected by user auth)
router.get('/booking/:bookingId', protect, getSOSAlertByBookingId);
router.post('/trigger', protect, triggerSOS);
router.post('/cancel', protect, cancelSOS);
router.post('/update-location', protect, updatePartnerLocation);

// Admin Endpoints (Protected by admin auth)
router.get('/active', requireAdmin, getActiveSOS);
router.get('/history', requireAdmin, getAllSOS);
router.get('/:id', requireAdmin, getSOSDetails);
router.post('/:id/acknowledge', requireAdmin, acknowledgeSOS);
router.post('/:id/resolve', requireAdmin, resolveSOS);

export default router;
