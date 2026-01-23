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
