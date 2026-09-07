import express from 'express';
import { protect } from '../middleware/auth';
import { requireAdmin } from '../middleware/adminAuth';
import {
    createSupportTicket,
    getMySupportTickets,
    addTicketMessage,
    getAllSupportTickets,
    updateSupportTicket
} from '../controllers/supportTicketController';

const router = express.Router();

// Customer
router.post('/tickets', protect, createSupportTicket);
router.get('/tickets', protect, getMySupportTickets);
// Shared: the controller decides customer vs admin from the caller's role.
router.post('/tickets/:id/messages', protect, addTicketMessage);

// Admin
router.get('/admin/tickets', protect, requireAdmin, getAllSupportTickets);
router.put('/admin/tickets/:id', protect, requireAdmin, updateSupportTicket);

export default router;
