import { IBooking } from '../models/Booking';
import { IOrderItem } from '../models/OrderItem';
import { formatDateTimeToIST } from './dateUtils';

/**
 * A single dated event in a booking's life, for the admin service-call timeline.
 *
 * The history is scattered across three places — `Booking.actionLog[]`, the lifecycle timestamps on
 * each `OrderItem`, and each item's `holdHistory[]` / `extraCharges[]`. None of them is a complete
 * record on its own, so this merges all of them into one chronological list.
 */
export interface TimelineEvent {
    /** Machine-readable event key, e.g. BOOKING_CREATED, JOB_STARTED, HOLD_STARTED. */
    type: string;
    /** Human-readable one-liner for the dashboard. */
    label: string;
    timestamp: Date;
    /** Pre-formatted IST string — there is no global TZ, so never let the client guess. */
    timestampIST: string;
    /** Who caused it: a partner name, an admin username, 'System' or 'Customer'. */
    performedBy?: string;
    /** Extra context (hold reason, charge description, status transition detail). */
    details?: string;
    /** Which order item this belongs to; absent for booking-level events. */
    orderItemId?: string;
    serviceName?: string;
}

const event = (
    type: string,
    label: string,
    timestamp: Date | undefined | null,
    extra: Partial<TimelineEvent> = {}
): TimelineEvent | null => {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return null;

    return {
        type,
        label,
        timestamp: date,
        timestampIST: formatDateTimeToIST(date),
        ...extra
    };
};

/**
 * Build the merged, chronologically sorted timeline for a booking and its order items.
 */
export const buildBookingTimeline = (
    booking: IBooking,
    orderItems: IOrderItem[],
    /** assignedPartnerId -> partner name, resolved by the caller. */
    partnerNames: Map<string, string> = new Map()
): TimelineEvent[] => {
    const events: Array<TimelineEvent | null> = [];

    // --- Booking-level ---
    events.push(event('BOOKING_CREATED', 'Booking created', booking.createdAt, {
        performedBy: 'Customer',
        details: `${booking.bookingType} booking ${booking.bookingId}`
    }));

    if (booking.bookingType === 'SCHEDULED' && booking.scheduledDate) {
        events.push(event('BOOKING_SCHEDULED', 'Scheduled for', booking.scheduledDate, {
            performedBy: 'Customer',
            details: booking.scheduledTime
                ? `${formatDateTimeToIST(new Date(booking.scheduledDate))} at ${booking.scheduledTime}`
                : undefined
        }));
    }

    // actionLog already carries admin/partner actions (assignment, reschedule, cancel, waivers…).
    (booking.actionLog || []).forEach(entry => {
        events.push(event(entry.action, humanizeAction(entry.action), entry.timestamp, {
            performedBy: entry.performedBy,
            details: entry.details
        }));
    });

    // --- Per order item ---
    orderItems.forEach(item => {
        const itemId = item._id?.toString();
        const context = { orderItemId: itemId, serviceName: item.serviceName };
        const partnerName = item.assignedPartnerId
            ? partnerNames.get(item.assignedPartnerId.toString()) || 'Partner'
            : 'Partner';

        events.push(event('JOB_STARTED', 'Job started', item.startedAt, {
            ...context,
            performedBy: partnerName,
            details: item.variantName
        }));

        events.push(event('JOB_COMPLETED', 'Job completed', item.completedAt, {
            ...context,
            performedBy: partnerName,
            details: item.variantName
        }));

        (item.holdHistory || []).forEach(hold => {
            events.push(event('HOLD_STARTED', 'Job put on hold', hold.holdStartedAt, {
                ...context,
                performedBy: hold.heldBy,
                details: hold.customRemark ? `${hold.reason} — ${hold.customRemark}` : hold.reason
            }));
            events.push(event('HOLD_ENDED', 'Job resumed', hold.holdEndedAt, {
                ...context,
                performedBy: hold.heldBy
            }));
        });

        (item.extraCharges || []).forEach(charge => {
            const payable = charge.totalAmount ?? charge.amount;
            events.push(event('EXTRA_CHARGE_ADDED', 'Extra charge added', charge.addedAt, {
                ...context,
                performedBy: charge.addedByName,
                details: `₹${payable} — ${charge.description}`
            }));
            events.push(event('EXTRA_CHARGE_PAID', 'Extra charge paid', charge.paidAt, {
                ...context,
                performedBy: charge.addedByName,
                details: `₹${payable} via ${charge.paymentMethod || 'unknown'}`
            }));
        });
    });

    return events
        .filter((e): e is TimelineEvent => e !== null)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
};

/**
 * Turn an actionLog key like EXTRA_CHARGE_WAIVED into "Extra charge waived".
 */
const humanizeAction = (action: string): string => {
    const spaced = action.replace(/_/g, ' ').toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
