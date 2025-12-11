import express from 'express';

import {
    loginPartner,
    getPartnerProfile,
    getPartnerBookings,
    updateBookingStatus,
    verifyStartJobOtp,
    verifyEndJobOtp
} from '../controllers/partnerController';
import { protectPartner } from '../middleware/partnerAuth';

const router = express.Router();

router.post('/auth/login', loginPartner);

// Protected routes
router.use(protectPartner);

router.get('/me', getPartnerProfile);
router.get('/bookings', getPartnerBookings);
router.post('/bookings/:id/status', updateBookingStatus);
router.post('/bookings/:id/verify-start', verifyStartJobOtp);
router.post('/bookings/:id/verify-end', verifyEndJobOtp);

export default router;
