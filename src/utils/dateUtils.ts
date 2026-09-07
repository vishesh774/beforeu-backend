/**
 * Formats a date to a string in Indian Standard Time (IST)
 * @param date The date to format
 * @returns Date string like "Jan 23, 2026"
 */
export const formatDateToIST = (date: Date = new Date()): string => {
    return date.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
};

/**
 * Formats the time to a string in Indian Standard Time (IST)
 * @param date The date to extract time from
 * @returns Time string like "05:01 PM"
 */
export const formatTimeToIST = (date: Date = new Date()): string => {
    return date.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).toUpperCase();
};

/**
 * Formats a date and time together in IST.
 * The process pins no TZ, so anything user-facing that carries both must go through here.
 * @returns String like "Jan 23, 2026, 05:01 PM"
 */
export const formatDateTimeToIST = (date: Date = new Date()): string => {
    return `${formatDateToIST(date)}, ${formatTimeToIST(date)}`;
};

/**
 * Weekday name in IST, lowercase ("monday" … "sunday").
 *
 * Correct for both shapes of `scheduledDate` we store:
 *  - a date-only value (UTC midnight) — 00:00Z is 05:30 IST the same day, so the weekday holds;
 *  - a full timestamp (ASAP bookings store now+1h) — 19:30Z is 01:00 IST the *next* day, and only
 *    an IST-aware conversion gets that right.
 *
 * `getUTCDay()` handles the first case and silently gets the second wrong, which made partners look
 * unavailable for anything booked after 18:30 IST.
 */
export const getISTWeekday = (date: Date): string => {
    const weekday = date.toLocaleDateString('en-US', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long'
    });
    return weekday.toLowerCase();
};
