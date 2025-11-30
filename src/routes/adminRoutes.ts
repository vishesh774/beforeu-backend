import express from 'express';
import { getAllUsers, getUser, createUser, updateUser, deactivateUser } from '../controllers/adminController';
import {
  getAllServiceRegions,
  getServiceRegion,
  createServiceRegion,
  updateServiceRegion,
  toggleServiceRegionStatus,
  checkPointInRegion
} from '../controllers/serviceRegionController';
import {
  getAllServices,
  getService,
  createService,
  updateService,
  toggleServiceStatus
} from '../controllers/serviceController';
import {
  getAllServicePartners,
  getServicePartner,
  createServicePartner,
  updateServicePartner,
  toggleServicePartnerStatus
} from '../controllers/servicePartnerController';
import {
  getAllCustomers,
  getCustomer,
  toggleCustomerStatus
} from '../controllers/customerController';
import { requireAdmin } from '../middleware/adminAuth';

const router = express.Router();

// All routes require admin authentication
router.use(requireAdmin);

// User management routes
router.get('/users', getAllUsers);
router.get('/users/:id', getUser);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.patch('/users/:id/deactivate', deactivateUser);

// Service region routes
router.get('/service-regions', getAllServiceRegions);
router.get('/service-regions/:id', getServiceRegion);
router.post('/service-regions', createServiceRegion);
router.put('/service-regions/:id', updateServiceRegion);
router.patch('/service-regions/:id/toggle-status', toggleServiceRegionStatus);
router.post('/service-regions/check-point', checkPointInRegion);

// Service management routes
router.get('/services', getAllServices);
router.get('/services/:id', getService);
router.post('/services', createService);
router.put('/services/:id', updateService);
router.patch('/services/:id/toggle-status', toggleServiceStatus);

// Service partner routes
router.get('/service-partners', getAllServicePartners);
router.get('/service-partners/:id', getServicePartner);
router.post('/service-partners', createServicePartner);
router.put('/service-partners/:id', updateServicePartner);
router.patch('/service-partners/:id/toggle-status', toggleServicePartnerStatus);

// Customer management routes
router.get('/customers', getAllCustomers);
router.get('/customers/:id', getCustomer);
router.patch('/customers/:id/toggle-status', toggleCustomerStatus);

export default router;

