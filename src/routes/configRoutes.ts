import express from 'express';
import { getAppConfig } from '../controllers/configController';

const router = express.Router();

// Public config route - generic endpoint for app configuration
router.get('/config', getAppConfig);

export default router;

