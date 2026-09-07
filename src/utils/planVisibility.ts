import { IPlan } from '../models/Plan';
import { normalizePhone } from './phoneUtils';

/**
 * Restricted-plan eligibility.
 *
 * A plan marked `restricted` is only visible and purchasable by the phone numbers listed on it.
 * This is what makes a fully-discounted (₹0) plan safe to create — without it, a free plan would be
 * on the storefront for every customer.
 *
 * Numbers are compared after `normalizePhone()` because the allow-list is typed by hand in the
 * dashboard and will not reliably be in E.164 form.
 */
export const isPlanVisibleToPhone = (
    plan: Pick<IPlan, 'visibility' | 'allowedPhoneNumbers'>,
    phone?: string | null
): boolean => {
    if (plan.visibility !== 'restricted') {
        return true;
    }

    if (!phone) {
        return false;
    }

    const target = normalizePhone(phone);
    if (!target) {
        return false;
    }

    return (plan.allowedPhoneNumbers || []).some(allowed => normalizePhone(allowed) === target);
};

/**
 * Filter a list of plans down to the ones this phone number may see.
 */
export const filterPlansForPhone = <T extends Pick<IPlan, 'visibility' | 'allowedPhoneNumbers'>>(
    plans: T[],
    phone?: string | null
): T[] => plans.filter(plan => isPlanVisibleToPhone(plan, phone));

/**
 * Whether a plan is sold in at least one of the regions the customer's location falls in.
 * A plan with no regions listed is sold everywhere.
 */
export const isPlanInRegions = (
    plan: Pick<IPlan, 'serviceRegions'>,
    matchingRegionIds: string[]
): boolean => {
    const planRegions = (plan.serviceRegions || []).filter(Boolean).map(String);
    if (planRegions.length === 0) {
        return true;
    }
    return planRegions.some(regionId => matchingRegionIds.includes(regionId));
};

/**
 * Whether a plan may be sold through a given channel.
 * `offline` plans are field-sales only and must never reach the customer storefront.
 */
export const isPlanOnChannel = (
    plan: Pick<IPlan, 'saleChannel'>,
    channel: 'online' | 'offline'
): boolean => {
    const planChannel = plan.saleChannel || 'both';
    return planChannel === 'both' || planChannel === channel;
};

/**
 * The full customer-storefront filter: restricted allow-list, sale channel, and region.
 *
 * `matchingRegionIds` is null when the caller has no coordinates for the customer — in that case
 * region filtering is skipped rather than hiding every region-scoped plan, so a customer who has
 * not yet set an address still sees the catalogue.
 */
export const filterPlansForCustomer = <
    T extends Pick<IPlan, 'visibility' | 'allowedPhoneNumbers' | 'serviceRegions' | 'saleChannel'>
>(
    plans: T[],
    options: { phone?: string | null; matchingRegionIds?: string[] | null }
): T[] => plans.filter(plan =>
    isPlanVisibleToPhone(plan, options.phone)
    && isPlanOnChannel(plan, 'online')
    && (options.matchingRegionIds === null || options.matchingRegionIds === undefined
        || isPlanInRegions(plan, options.matchingRegionIds))
);
