import express from 'express';
import { getAppConfig, getBookingSlots } from '../controllers/configController';

const router = express.Router();

// Public config route - generic endpoint for app configuration
router.get('/config', getAppConfig);
router.get('/booking/slots', getBookingSlots);

export default router;

