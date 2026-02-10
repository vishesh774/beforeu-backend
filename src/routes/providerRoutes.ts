import express from 'express';
import { protect } from '../middleware/auth';
import {
    getProviderJobs,
    getJobDetails,
    updateJobStatus,
    startJob,
    endJob,
    getProfile,
    getPartnerSOSAlerts,
    getUnassignedSOSAlerts,
    acceptSOSAlert
} from '../controllers/providerController';
import {
    addExtraCharge,
    getExtraCharges,
    cancelExtraCharge,
    createExtraChargeOrder,
    verifyExtraChargePayment,
    confirmCashPayment,
    canCompleteJob,
    checkPaymentStatus
} from '../controllers/extraChargesController';

const router = express.Router();

// All routes are protected and assume the user is a service partner
router.use(protect); // Ensure user is logged in
// TODO: Add middleware to ensure user role is 'ServicePartner' or check ServicePartner existence?
// The controller checks ServicePartner existence, so basic protect is fine for now.

// Job management routes
router.get('/jobs', getProviderJobs);
router.get('/jobs/:id', getJobDetails);
router.put('/jobs/:id/status', updateJobStatus);
router.post('/jobs/:id/start', startJob);
router.post('/jobs/:id/end', endJob);
router.get('/profile', getProfile);

// SOS routes (for partners assigned to SOS service)
router.get('/sos/unassigned', getUnassignedSOSAlerts);
router.get('/sos', getPartnerSOSAlerts);
router.post('/sos/:id/accept', acceptSOSAlert);

// Extra charges routes
router.get('/jobs/:id/extra-charges', getExtraCharges);
router.post('/jobs/:id/extra-charges', addExtraCharge);
router.delete('/jobs/:id/extra-charges/:chargeId', cancelExtraCharge);
router.post('/jobs/:id/extra-charges/:chargeId/create-order', createExtraChargeOrder);
router.post('/jobs/:id/extra-charges/:chargeId/verify-payment', verifyExtraChargePayment);
router.post('/jobs/:id/extra-charges/:chargeId/confirm-cash', confirmCashPayment);
router.get('/jobs/:id/extra-charges/:chargeId/payment-status', checkPaymentStatus);
router.get('/jobs/:id/can-complete', canCompleteJob);


export default router;
