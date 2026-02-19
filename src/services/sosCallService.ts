/**
 * SOS Click-to-Call Service
 *
 * When an SOS is triggered (from customer app or admin panel):
 * 1. Always call explicitly assigned partner(s) first (e.g. admin-chosen partner)
 * 2. Determine which service region the SOS location belongs to
 * 3. Find all active SOS partners in that region and call them too
 * 4. Deduplicate so no partner gets called twice
 *
 * Fallback: If coordinates are missing/invalid (0,0), skip region lookup and
 * call ALL active SOS partners rather than silently calling nobody.
 */

import axios from 'axios';
import ServiceRegion from '../models/ServiceRegion';
import ServicePartner from '../models/ServicePartner';
import Service from '../models/Service';
import { isPointInPolygon } from '../utils/pointInPolygon';

// Tata Teleservices SmartFlo config
const SMARTFLO_API_URL = 'https://api-smartflo.tatateleservices.com/v1/click_to_call_support';
const SMARTFLO_API_KEY = process.env.SMARTFLO_API_KEY;
const CUSTOMER_RING_TIMEOUT = 30;

interface SOSCallLocation {
    latitude: number;
    longitude: number;
    address?: string;
}

interface SOSCallResult {
    totalPartners: number;
    callsTriggered: number;
    callsFailed: number;
    details: Array<{
        partnerId: string;
        partnerName: string;
        phone: string;
        success: boolean;
        error?: string;
    }>;
}

/**
 * Normalize a phone number to the 91XXXXXXXXXX format required by Tata Teleservices.
 *
 * Handles formats like:
 *  - +919876543210  →  919876543210
 *  - 919876543210   →  919876543210
 *  - 09876543210    →  919876543210
 *  - 9876543210     →  919876543210
 */
function normalizePhoneFor91(phone: string): string {
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('91') && digits.length === 12) return digits;
    if (digits.startsWith('0')) digits = digits.substring(1);
    if (digits.length === 10) return `91${digits}`;
    return digits;
}

/**
 * Trigger a single click-to-call via Tata Teleservices SmartFlo API
 */
async function triggerClickToCall(phoneNumber: string): Promise<void> {
    const normalizedNumber = normalizePhoneFor91(phoneNumber);
    console.log(`[SOSCallService] Triggering click-to-call for: ${normalizedNumber}`);

    const response = await axios.post(
        SMARTFLO_API_URL,
        {
            customer_number: normalizedNumber,
            customer_ring_timeout: CUSTOMER_RING_TIMEOUT,
            async: 1,
            api_key: SMARTFLO_API_KEY
        },
        {
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json'
            },
            timeout: 15000
        }
    );

    console.log(`[SOSCallService] Click-to-call response for ${normalizedNumber}:`, response.status, response.data);
}

/**
 * Main function: Find partners for the SOS and call them all.
 *
 * @param location         - SOS coordinates + address
 * @param sosId            - Human-readable SOS ID for logging
 * @param priorityPartnerIds - Partner IDs that MUST be called regardless of region
 *                            (e.g. the partner manually assigned by admin)
 */
export async function triggerSOSCallsToPartners(
    location: SOSCallLocation,
    sosId?: string,
    priorityPartnerIds: string[] = []
): Promise<SOSCallResult> {
    const result: SOSCallResult = {
        totalPartners: 0,
        callsTriggered: 0,
        callsFailed: 0,
        details: []
    };

    try {
        console.log(
            `[SOSCallService] Starting SOS call workflow for location: lat=${location.latitude}, lng=${location.longitude}` +
            `${sosId ? `, SOS ID: ${sosId}` : ''}` +
            `${priorityPartnerIds.length > 0 ? `, Priority partners: [${priorityPartnerIds.join(', ')}]` : ''}`
        );

        // --- Step 1: Find the SOS service ---
        const sosService = await Service.findOne({ name: { $regex: /^SOS/i } });
        if (!sosService) {
            console.error('[SOSCallService] SOS service not found in database. Cannot determine eligible partners.');
            return result;
        }
        const sosServiceId = sosService._id.toString();
        const sosServiceSlug = (sosService as any).id; // 'sos'
        const sosIdentifierFilter = sosServiceSlug ? [sosServiceId, sosServiceSlug] : [sosServiceId];

        console.log(`[SOSCallService] SOS Service found: ${sosService.name} (${sosServiceId}), slug: ${sosServiceSlug}`);

        // --- Step 2: Collect all partner IDs to call ---
        const partnerIdSet = new Set<string>();

        // 2a. Always include explicitly assigned (priority) partners
        if (priorityPartnerIds.length > 0) {
            const priorityPartners = await ServicePartner.find({
                _id: { $in: priorityPartnerIds },
                isActive: true
            });
            for (const p of priorityPartners) {
                partnerIdSet.add(p._id.toString());
                console.log(`[SOSCallService] Priority partner added: ${p.name} (${p._id})`);
            }
            if (priorityPartners.length < priorityPartnerIds.length) {
                console.warn(`[SOSCallService] Some priority partner IDs were not found or are inactive.`);
            }
        }

        // 2b. Region-based lookup for additional partners
        const hasValidCoords =
            location.latitude !== 0 ||
            location.longitude !== 0;

        if (!hasValidCoords) {
            // Coordinates are 0,0 — region lookup would be useless.
            // Fall back: call ALL active SOS partners.
            console.warn(
                `[SOSCallService] Coordinates are 0,0 for SOS ${sosId}. ` +
                `Falling back to calling ALL active SOS partners.`
            );
            const allSosPartners = await ServicePartner.find({
                isActive: true,
                services: { $in: sosIdentifierFilter }
            });
            for (const p of allSosPartners) {
                partnerIdSet.add(p._id.toString());
            }
            console.log(
                `[SOSCallService] Fallback: found ${allSosPartners.length} active SOS partner(s).`
            );
        } else {
            // Normal path: region polygon lookup
            const activeRegions = await ServiceRegion.find({ isActive: true });
            const matchingRegionIds: string[] = [];

            for (const region of activeRegions) {
                if (isPointInPolygon(
                    { lat: location.latitude, lng: location.longitude },
                    region.polygon
                )) {
                    matchingRegionIds.push(region._id.toString());
                    console.log(`[SOSCallService] Location matched region: ${region.name} (${region._id})`);
                }
            }

            let regionalPartners;
            if (matchingRegionIds.length > 0) {
                // Partners in matching regions OR partners with no region restrictions
                regionalPartners = await ServicePartner.find({
                    isActive: true,
                    services: { $in: sosIdentifierFilter },
                    $or: [
                        { serviceRegions: { $in: matchingRegionIds } },
                        { serviceRegions: { $size: 0 } }
                    ]
                });
            } else {
                // No region matched — warn and broaden to ALL active SOS partners
                // (avoids silently skipping everyone when GPS is slightly off)
                console.warn(
                    `[SOSCallService] No service region matched lat=${location.latitude}, lng=${location.longitude}. ` +
                    `Broadening to all active SOS partners.`
                );
                regionalPartners = await ServicePartner.find({
                    isActive: true,
                    services: { $in: sosIdentifierFilter }
                });
            }

            for (const p of regionalPartners) {
                partnerIdSet.add(p._id.toString());
            }
            console.log(
                `[SOSCallService] Region lookup added ${regionalPartners.length} partner(s). ` +
                `Total unique: ${partnerIdSet.size}.`
            );
        }

        // --- Step 3: Fetch full partner docs for phone numbers ---
        const allPartnerIds = Array.from(partnerIdSet);
        result.totalPartners = allPartnerIds.length;

        if (allPartnerIds.length === 0) {
            console.warn('[SOSCallService] No eligible partners found to call for this SOS.');
            return result;
        }

        const partnersToCall = await ServicePartner.find({
            _id: { $in: allPartnerIds }
        });

        console.log(`[SOSCallService] Placing calls to ${partnersToCall.length} partner(s)...`);

        // --- Step 4: Trigger calls in parallel ---
        const callPromises = partnersToCall.map(async (partner) => {
            const detail = {
                partnerId: partner._id.toString(),
                partnerName: partner.name,
                phone: partner.phone,
                success: false,
                error: undefined as string | undefined
            };

            try {
                await triggerClickToCall(partner.phone);
                detail.success = true;
                result.callsTriggered++;
                console.log(`[SOSCallService] ✅ Call triggered to ${partner.name} (${partner.phone})`);
            } catch (error: any) {
                detail.success = false;
                detail.error = error.message || 'Unknown error';
                result.callsFailed++;
                console.error(`[SOSCallService] ❌ Failed to call ${partner.name} (${partner.phone}):`, error.message);
            }

            result.details.push(detail);
        });

        await Promise.all(callPromises);

        console.log(
            `[SOSCallService] SOS call workflow complete. ` +
            `Triggered: ${result.callsTriggered}, Failed: ${result.callsFailed}`
        );

    } catch (error: any) {
        console.error('[SOSCallService] Critical error in SOS call workflow:', error);
    }

    return result;
}
