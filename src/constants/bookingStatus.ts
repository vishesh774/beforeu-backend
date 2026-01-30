/**
 * Booking Status Constants
 * Single source of truth for all booking status related strings and labels
 */

export enum BookingStatus {
    PENDING = 'pending',
    CONFIRMED = 'confirmed',
    ASSIGNED = 'assigned',
    EN_ROUTE = 'en_route',
    REACHED = 'reached',
    IN_PROGRESS = 'in_progress',
    ON_HOLD = 'on_hold',  // Task paused by partner/admin
    COMPLETED = 'completed',
    CANCELLED = 'cancelled',
    REFUND_INITIATED = 'refund_initiated',
    REFUNDED = 'refunded'
}

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
    [BookingStatus.PENDING]: 'Pending',
    [BookingStatus.CONFIRMED]: 'Confirmed',
    [BookingStatus.ASSIGNED]: 'Partner Assigned',
    [BookingStatus.EN_ROUTE]: 'On The Way',
    [BookingStatus.REACHED]: 'Partner Arrived',
    [BookingStatus.IN_PROGRESS]: 'In Progress',
    [BookingStatus.ON_HOLD]: 'On Hold',
    [BookingStatus.COMPLETED]: 'Completed',
    [BookingStatus.CANCELLED]: 'Cancelled',
    [BookingStatus.REFUND_INITIATED]: 'Refund Initiated',
    [BookingStatus.REFUNDED]: 'Refunded'
};

// Groups of statuses for logic
export const ACTIVE_BOOKING_STATUSES = [
    BookingStatus.PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.ASSIGNED,
    BookingStatus.EN_ROUTE,
    BookingStatus.REACHED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.ON_HOLD
];

export const ONGOING_BOOKING_STATUSES = [
    BookingStatus.ASSIGNED,
    BookingStatus.EN_ROUTE,
    BookingStatus.REACHED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.ON_HOLD
];

export const COMPLETED_BOOKING_STATUSES = [
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.REFUND_INITIATED,
    BookingStatus.REFUNDED
];
