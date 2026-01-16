import express from 'express';
import { requireAdmin } from '../middleware/adminAuth';
import {
    createRole,
    getAllRoles,
    getRole,
    updateRole,
    deleteRole
} from '../controllers/roleController';

const router = express.Router();

// protect all routes
router.use(requireAdmin);

router.route('/')
    .get(getAllRoles)
    .post(createRole);

router.route('/:id')
    .get(getRole)
    .patch(updateRole)
    .delete(deleteRole);

export default router;
