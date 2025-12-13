import express from 'express';
import { protect } from '../middleware/auth';
import {
    getProviderJobs,
    getJobDetails,
    updateJobStatus,
    startJob,
    endJob
} from '../controllers/providerController';

const router = express.Router();

// All routes are protected and assume the user is a service partner
router.use(protect); // Ensure user is logged in
// TODO: Add middleware to ensure user role is 'ServicePartner' or check ServicePartner existence?
// The controller checks ServicePartner existence, so basic protect is fine for now.

router.get('/jobs', getProviderJobs);
router.get('/jobs/:id', getJobDetails);
router.put('/jobs/:id/status', updateJobStatus);
router.post('/jobs/:id/start', startJob);
router.post('/jobs/:id/end', endJob);

export default router;
