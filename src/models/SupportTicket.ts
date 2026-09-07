import mongoose, { Document, Schema } from 'mongoose';

export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type SupportTicketPriority = 'low' | 'medium' | 'high';

export interface ISupportTicketMessage {
    /** 'customer' or the admin's display name. */
    author: string;
    authorRole: 'customer' | 'admin';
    message: string;
    createdAt: Date;
}

export interface ISupportTicket extends Document {
    ticketId: string; // Human reference, e.g. TKT-20260813-001
    userId: mongoose.Types.ObjectId;
    /** Optional — a ticket may be about a specific booking, or general. */
    bookingId?: mongoose.Types.ObjectId;
    category: string;
    subject: string;
    status: SupportTicketStatus;
    priority: SupportTicketPriority;
    messages: ISupportTicketMessage[];
    assignedTo?: mongoose.Types.ObjectId;
    resolvedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const SupportTicketMessageSchema = new Schema<ISupportTicketMessage>({
    author: { type: String, required: true, trim: true },
    authorRole: { type: String, enum: ['customer', 'admin'], required: true },
    message: { type: String, required: true, trim: true, maxlength: [2000, 'Message cannot exceed 2000 characters'] },
    createdAt: { type: Date, default: Date.now }
}, { _id: false });

const SupportTicketSchema = new Schema<ISupportTicket>(
    {
        ticketId: {
            type: String,
            unique: true,
            index: true
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        bookingId: {
            type: Schema.Types.ObjectId,
            ref: 'Booking',
            index: true
        },
        category: {
            type: String,
            required: true,
            trim: true,
            default: 'general'
        },
        subject: {
            type: String,
            required: [true, 'Subject is required'],
            trim: true,
            maxlength: [150, 'Subject cannot exceed 150 characters']
        },
        status: {
            type: String,
            enum: ['open', 'in_progress', 'resolved', 'closed'],
            default: 'open',
            required: true,
            index: true
        },
        priority: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'medium',
            required: true
        },
        messages: {
            type: [SupportTicketMessageSchema],
            default: []
        },
        assignedTo: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        resolvedAt: {
            type: Date
        }
    },
    {
        timestamps: true
    }
);

/**
 * Assign a human-readable ticket reference.
 *
 * Uses the same `TKT-YYYYMMDD-NNN` shape as `Booking.bookingId` and, like it, derives the sequence
 * from a same-day count — so two tickets created in the same millisecond can collide on the unique
 * index. Acceptable at support-ticket volume; if that ever changes, move it to an atomic counter the
 * way `InvoiceCounter` does.
 */
SupportTicketSchema.pre('save', async function (this: ISupportTicket) {
    if (this.ticketId) {
        return;
    }

    const now = new Date();
    const datePart = now.toISOString().split('T')[0].replace(/-/g, '');

    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const count = await mongoose.model('SupportTicket').countDocuments({
        createdAt: { $gte: startOfDay }
    });

    this.ticketId = `TKT-${datePart}-${String(count + 1).padStart(3, '0')}`;
});

const SupportTicket = mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);

export default SupportTicket;
