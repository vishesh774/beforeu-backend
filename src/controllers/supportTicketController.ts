import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import SupportTicket from '../models/SupportTicket';
import Booking from '../models/Booking';

/**
 * Customer support tickets.
 *
 * Complements `Review` (a rating on a completed booking) with the other half of the feedback loop:
 * a two-way thread the customer can open and ops can work. Reviews are per-booking and one-shot;
 * tickets are conversational and may or may not reference a booking.
 */

const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
const TICKET_PRIORITIES = ['low', 'medium', 'high'] as const;

// @desc    Raise a support ticket
// @route   POST /api/support/tickets
// @access  Private (Customer)
export const createSupportTicket = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) {
        return next(new AppError('User not authenticated', 401));
    }

    const { subject, message, category, bookingId } = req.body;

    if (!subject || !subject.trim()) {
        return next(new AppError('Subject is required', 400));
    }
    if (!message || message.trim().length < 5) {
        return next(new AppError('Please describe the issue (minimum 5 characters)', 400));
    }

    const userIdObj = new mongoose.Types.ObjectId(userId);

    // A referenced booking must belong to the customer raising the ticket.
    let resolvedBookingId: mongoose.Types.ObjectId | undefined;
    if (bookingId) {
        const booking = await Booking.findOne(
            mongoose.isValidObjectId(bookingId)
                ? { _id: bookingId, userId: userIdObj }
                : { bookingId, userId: userIdObj }
        );
        if (!booking) {
            return next(new AppError('Booking not found for this customer', 404));
        }
        resolvedBookingId = booking._id;
    }

    const ticket = await SupportTicket.create({
        userId: userIdObj,
        bookingId: resolvedBookingId,
        category: (category || 'general').trim(),
        subject: subject.trim(),
        messages: [{
            author: req.user?.name || 'Customer',
            authorRole: 'customer',
            message: message.trim(),
            createdAt: new Date()
        }]
    });

    res.status(201).json({
        success: true,
        message: 'Support ticket raised',
        data: { ticket }
    });
});

// @desc    List the logged-in customer's tickets
// @route   GET /api/support/tickets
// @access  Private (Customer)
export const getMySupportTickets = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) {
        return next(new AppError('User not authenticated', 401));
    }

    const tickets = await SupportTicket.find({ userId: new mongoose.Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .populate('bookingId', 'bookingId');

    res.status(200).json({
        success: true,
        data: { tickets }
    });
});

// @desc    Add a reply to a ticket (customer or admin)
// @route   POST /api/support/tickets/:id/messages
// @access  Private
export const addTicketMessage = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) {
        return next(new AppError('User not authenticated', 401));
    }

    const { message } = req.body;
    if (!message || !message.trim()) {
        return next(new AppError('Message is required', 400));
    }

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) {
        return next(new AppError('Ticket not found', 404));
    }

    // `requireAdmin` treats any non-customer role as staff; mirror that here.
    const isAdmin = req.user?.role !== undefined && req.user.role !== 'customer';

    if (!isAdmin && ticket.userId.toString() !== userId) {
        return next(new AppError('Not authorised for this ticket', 403));
    }

    if (ticket.status === 'closed') {
        return next(new AppError('This ticket is closed', 400));
    }

    ticket.messages.push({
        author: req.user?.name || (isAdmin ? 'Support' : 'Customer'),
        authorRole: isAdmin ? 'admin' : 'customer',
        message: message.trim(),
        createdAt: new Date()
    });

    // An admin reply moves an untouched ticket into progress; a customer reply reopens a resolved one.
    if (isAdmin && ticket.status === 'open') {
        ticket.status = 'in_progress';
    } else if (!isAdmin && ticket.status === 'resolved') {
        ticket.status = 'open';
        ticket.resolvedAt = undefined;
    }

    await ticket.save();

    res.status(200).json({
        success: true,
        data: { ticket }
    });
});

// @desc    List all tickets
// @route   GET /api/support/admin/tickets
// @access  Private/Admin
export const getAllSupportTickets = asyncHandler(async (req: Request, res: Response) => {
    const { status, priority, search } = req.query;

    const filter: Record<string, unknown> = {};
    if (status && TICKET_STATUSES.includes(status as typeof TICKET_STATUSES[number])) {
        filter.status = status;
    }
    if (priority && TICKET_PRIORITIES.includes(priority as typeof TICKET_PRIORITIES[number])) {
        filter.priority = priority;
    }
    if (search && typeof search === 'string' && search.trim()) {
        const regex = { $regex: search.trim(), $options: 'i' };
        filter.$or = [{ ticketId: regex }, { subject: regex }];
    }

    const tickets = await SupportTicket.find(filter)
        .sort({ createdAt: -1 })
        .populate('userId', 'name phone email')
        .populate('bookingId', 'bookingId');

    res.status(200).json({
        success: true,
        data: { tickets }
    });
});

// @desc    Update ticket status / priority / assignee
// @route   PUT /api/support/admin/tickets/:id
// @access  Private/Admin
export const updateSupportTicket = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { status, priority, assignedTo } = req.body;

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) {
        return next(new AppError('Ticket not found', 404));
    }

    if (status !== undefined) {
        if (!TICKET_STATUSES.includes(status)) {
            return next(new AppError(`Status must be one of: ${TICKET_STATUSES.join(', ')}`, 400));
        }
        ticket.status = status;
        ticket.resolvedAt = (status === 'resolved' || status === 'closed') ? new Date() : undefined;
    }

    if (priority !== undefined) {
        if (!TICKET_PRIORITIES.includes(priority)) {
            return next(new AppError(`Priority must be one of: ${TICKET_PRIORITIES.join(', ')}`, 400));
        }
        ticket.priority = priority;
    }

    if (assignedTo !== undefined) {
        ticket.assignedTo = assignedTo ? new mongoose.Types.ObjectId(assignedTo) : undefined;
    }

    await ticket.save();

    res.status(200).json({
        success: true,
        data: { ticket }
    });
});
