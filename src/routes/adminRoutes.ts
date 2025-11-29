import express from 'express';
import { getAllUsers, createUser, updateUser, deactivateUser } from '../controllers/adminController';
import { requireAdmin } from '../middleware/adminAuth';

const router = express.Router();

// All routes require admin authentication
router.use(requireAdmin);

// User management routes
router.get('/users', getAllUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.patch('/users/:id/deactivate', deactivateUser);

export default router;

