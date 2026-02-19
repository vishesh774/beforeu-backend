import InvoiceCounter from '../models/InvoiceCounter';

/**
 * Gets the current financial year in format "YY-YY"
 * Financial year starts from April 1st.
 */
export const getCurrentFinancialYear = (date: Date = new Date()): string => {
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-indexed, 3 is April

    let startYear, endYear;

    if (month >= 3) {
        // April to December
        startYear = year;
        endYear = year + 1;
    } else {
        // January to March
        startYear = year - 1;
        endYear = year;
    }

    const startYearShort = String(startYear).slice(-2);
    const endYearShort = String(endYear).slice(-2);

    return `${startYearShort}-${endYearShort}`;
};

/**
 * Generates the next invoice number in the format "BUC/YY-YY/NNN"
 */
export const generateNextInvoiceNumber = async (date: Date = new Date()): Promise<string> => {
    const year = getCurrentFinancialYear(date);

    const counter = await InvoiceCounter.findOneAndUpdate(
        { year },
        { $inc: { count: 1 }, $set: { lastUpdated: new Date() } },
        { upsert: true, new: true }
    );

    const paddedCount = String(counter.count).padStart(3, '0');
    return `BUC/${year}/${paddedCount}`;
};
