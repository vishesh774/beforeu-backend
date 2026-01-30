/**
 * Hold Reasons Constants
 * Predefined reasons for putting a task on hold
 */

export const HOLD_REASONS = [
    'Waiting for parts/materials',
    'Customer unavailable',
    'Weather conditions',
    'Safety concern',
    'Scheduled break',
    'Other'
] as const;

export type HoldReason = typeof HOLD_REASONS[number];
