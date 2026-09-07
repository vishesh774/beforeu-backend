import { describe, it, expect } from '@jest/globals';
import { formatDateToIST, formatTimeToIST, formatDateTimeToIST } from '../utils/dateUtils';

/**
 * The process pins no TZ and Fly runs the container in UTC, so any booking time formatted with a
 * bare toLocaleTimeString() silently comes out 5h30m behind IST. That is exactly what made instant
 * bookings display the wrong slot. These assert the helpers are timezone-explicit, so the same
 * mistake cannot come back through them.
 */
describe('dateUtils IST formatting', () => {
    // 2026-08-13T07:00:00Z is 12:30 PM IST on the same day.
    const utcMorning = new Date('2026-08-13T07:00:00.000Z');

    // 2026-08-13T19:30:00Z is 01:00 AM IST on 14 Aug — a case that rolls the date forward.
    const utcEvening = new Date('2026-08-13T19:30:00.000Z');

    it('formats the time in IST, not the process timezone', () => {
        expect(formatTimeToIST(utcMorning)).toBe('12:30 PM');
    });

    it('rolls the date forward when IST crosses midnight', () => {
        expect(formatTimeToIST(utcEvening)).toBe('01:00 AM');
        expect(formatDateToIST(utcEvening)).toContain('14');
    });

    it('formats date and time together in IST', () => {
        const formatted = formatDateTimeToIST(utcMorning);
        expect(formatted).toContain('12:30 PM');
        expect(formatted).toContain('13');
    });

    it('never returns the raw UTC wall clock for a time that differs in IST', () => {
        // Guards the specific regression: 07:00 UTC must never render as "07:00 AM".
        expect(formatTimeToIST(utcMorning)).not.toBe('07:00 AM');
    });
});
