import express from 'express';
import {
    getActiveHealthPartners,
    downloadMyHealthCard,
    downloadFamilyHealthCard
} from '../controllers/healthPartnerController';
import { protect } from '../middleware/auth';

const router = express.Router();

// Public routes
router.get('/partners', getActiveHealthPartners);

// Private routes
router.get('/card/me', protect, downloadMyHealthCard);
router.get('/card/family/:memberId', protect, downloadFamilyHealthCard);

export default router;
