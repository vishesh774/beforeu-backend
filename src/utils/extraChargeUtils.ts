import CheckoutField from '../models/CheckoutField';
import { IExtraCharge } from '../models/OrderItem';

/**
 * GST handling for mid-job extra charges.
 *
 * Extra charges are entered GST-exclusive — the partner types the amount they want to collect and,
 * historically, that was the whole story: no tax line at all. That remains the default so nothing
 * about existing charges changes. A charge can now opt in to GST, in which case tax is added on top
 * and `totalAmount` is what every collection path (cash, UPI QR, Razorpay order) must use.
 *
 * Money stays a plain rupee Number per the workspace convention, rounded to paise.
 */

/** Used only when no GST/tax CheckoutField is configured. */
export const DEFAULT_GST_RATE = 18;

const roundToPaise = (value: number): number => Math.round(value * 100) / 100;

/**
 * The GST percentage to apply, read from the same admin-configured CheckoutField the checkout uses
 * so extra charges can't drift from the main basket. Falls back to DEFAULT_GST_RATE.
 */
export const getExtraChargeGstRate = async (): Promise<number> => {
    const fields = await CheckoutField.find({ isActive: true, chargeType: 'percentage' });

    const taxField = fields.find(f => {
        const name = f.fieldName.toLowerCase();
        return name.includes('gst') || name.includes('tax');
    });

    return taxField?.value ?? DEFAULT_GST_RATE;
};

/**
 * Split a base amount into its GST components.
 */
export const calculateExtraChargeGst = (
    amount: number,
    gstIncluded: boolean,
    gstRate: number
): { gstRate: number; gstAmount: number; totalAmount: number } => {
    const base = roundToPaise(amount);

    if (!gstIncluded || !gstRate || gstRate <= 0) {
        return { gstRate: 0, gstAmount: 0, totalAmount: base };
    }

    const gstAmount = roundToPaise((base * gstRate) / 100);
    return { gstRate, gstAmount, totalAmount: roundToPaise(base + gstAmount) };
};

/**
 * What the customer owes for a charge.
 *
 * Always read the collectable amount through this rather than `charge.amount` — charges written
 * before GST support have no `totalAmount`, and the two must not disagree at the payment gateway.
 */
export const getChargePayableAmount = (charge: Pick<IExtraCharge, 'amount' | 'totalAmount'>): number =>
    roundToPaise(charge.totalAmount ?? charge.amount);

/**
 * Sum of the payable amounts for a set of charges.
 */
export const sumChargePayableAmounts = (
    charges: Array<Pick<IExtraCharge, 'amount' | 'totalAmount'>>
): number => roundToPaise(charges.reduce((sum, c) => sum + getChargePayableAmount(c), 0));
