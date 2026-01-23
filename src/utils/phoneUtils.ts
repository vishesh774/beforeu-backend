/**
 * Utility to normalize phone numbers for consistent database lookups.
 * Primarily handles Indian numbers (+91).
 */
export const normalizePhone = (phone: string): string => {
    if (!phone) return phone;

    // 1. Remove all non-digit characters except '+'
    let normalized = phone.replace(/[^\d+]/g, '');

    // 2. Handle Indian numbers (+91 or 91 prefix or 10 digits)
    if (normalized.startsWith('+91')) {
        // Already in E.164 format for India
        return normalized;
    } else if (normalized.startsWith('91') && normalized.length === 12) {
        // 91XXXXXXXXXX format, convert to +91
        return '+' + normalized;
    } else if (normalized.length === 10) {
        // 10 digit number, assume +91
        return '+91' + normalized;
    }

    // 3. Fallback: ensure '+' prefix if it looks like an international number but missing '+'
    if (normalized.length > 10 && !normalized.startsWith('+')) {
        return '+' + normalized;
    }

    return normalized;
};
