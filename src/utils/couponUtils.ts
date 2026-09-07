/**
 * Coupon applicability and discount maths.
 *
 * Coupons are read in three places — createBooking, validateCoupon and the "available coupons"
 * listing — which each had their own copy of the percentage formula. Everything goes through here
 * now so a fixed-amount coupon can't behave differently depending on which endpoint you hit.
 */

export type CouponDiscountType = 'percentage' | 'fixed';

interface CouponLike {
    discountType?: CouponDiscountType | string;
    discountValue: number;
    serviceIds?: string[];
    serviceId?: string;
}

/**
 * The services a coupon is restricted to, merging the legacy single `serviceId` field with the
 * newer `serviceIds` array. An empty result means the coupon applies to every service.
 */
export const getCouponServiceIds = (coupon: CouponLike): string[] => {
    const ids = [
        ...(Array.isArray(coupon.serviceIds) ? coupon.serviceIds : []),
        ...(coupon.serviceId ? [coupon.serviceId] : [])
    ]
        .map(id => String(id).trim())
        .filter(id => id.length > 0);

    return [...new Set(ids)];
};

/**
 * Whether a coupon covers at least one of the services in the cart.
 * An unrestricted coupon (no services listed) always matches.
 */
export const couponAppliesToServices = (coupon: CouponLike, cartServiceIds: string[]): boolean => {
    const allowed = getCouponServiceIds(coupon);
    if (allowed.length === 0) {
        return true;
    }
    const cart = cartServiceIds.map(id => String(id));
    return allowed.some(allowedId => cart.includes(allowedId));
};

/**
 * Discount in rupees for a given pre-discount amount.
 *
 * Never returns more than `amount` — a fixed coupon worth more than the cart zeroes the cart
 * rather than producing a negative total. Money stays a plain rupee Number, per the workspace
 * convention, and is rounded to paise to avoid float dust reaching the persisted breakdown.
 */
export const calculateCouponDiscount = (coupon: CouponLike, amount: number): number => {
    if (!amount || amount <= 0 || !coupon.discountValue || coupon.discountValue <= 0) {
        return 0;
    }

    const raw = coupon.discountType === 'fixed'
        ? coupon.discountValue
        : (amount * coupon.discountValue) / 100;

    return Math.round(Math.min(raw, amount) * 100) / 100;
};

/**
 * How the discount should be described in the UI and on the invoice, e.g. "20%" or "₹250".
 */
export const formatCouponDiscount = (coupon: CouponLike): string =>
    coupon.discountType === 'fixed'
        ? `₹${coupon.discountValue}`
        : `${coupon.discountValue}%`;
