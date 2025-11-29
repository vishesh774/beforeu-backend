import express from 'express';
import { getAllUsers, createUser, updateUser, deactivateUser } from '../controllers/adminController';
import {
  getAllServiceRegions,
  getServiceRegion,
  createServiceRegion,
  updateServiceRegion,
  toggleServiceRegionStatus,
  checkPointInRegion
} from '../controllers/serviceRegionController';
import { requireAdmin } from '../middleware/adminAuth';

const router = express.Router();

// All routes require admin authentication
router.use(requireAdmin);

// User management routes
router.get('/users', getAllUsers);
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

export default router;

