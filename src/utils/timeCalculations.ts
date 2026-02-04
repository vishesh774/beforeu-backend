/**
 * Time Calculation Utilities
 * Functions for calculating active work time excluding hold periods
 */

import { IHoldEntry } from '../models/OrderItem';

/**
 * Calculate total hold duration in milliseconds from hold history
 */
export function calculateTotalHoldDuration(holdHistory: IHoldEntry[]): number {
    return holdHistory.reduce((total, entry) => {
        if (entry.holdEndedAt) {
            return total + (new Date(entry.holdEndedAt).getTime() - new Date(entry.holdStartedAt).getTime());
        }
        return total;
    }, 0);
}

/**
 * Calculate active work time excluding hold periods
 * Returns time in milliseconds
 */
export function calculateActiveWorkTime(
    startedAt: Date,
    completedAt: Date,
    holdHistory: IHoldEntry[]
): number {
    const totalDuration = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    const holdDuration = calculateTotalHoldDuration(holdHistory);
    return Math.max(0, totalDuration - holdDuration);
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}
