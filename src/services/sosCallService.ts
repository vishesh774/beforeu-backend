/**
 * SOS Click-to-Call Service
 * 
 * When an SOS is triggered (from customer app or admin panel):
 * 1. Determine which service region the SOS location belongs to
 * 2. Find active service partners in that region assigned to the SOS service
 * 3. Trigger phone calls to all of them via Tata Teleservices Click-to-Call API
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
    // Strip all non-digit characters
    let digits = phone.replace(/\D/g, '');

    // If it starts with 91 and is 12 digits, it's already correct
    if (digits.startsWith('91') && digits.length === 12) {
        return digits;
    }

    // If it starts with 0, remove leading 0
    if (digits.startsWith('0')) {
        digits = digits.substring(1);
    }

    // If it's 10 digits (Indian mobile number), prepend 91
    if (digits.length === 10) {
        return `91${digits}`;
    }

    // Fallback: return whatever we have (may already be correct or edge case)
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
            async: 10,
            api_key: SMARTFLO_API_KEY
        },
        {
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json'
            },
            timeout: 15000 // 15 second timeout
        }
    );

    console.log(`[SOSCallService] Click-to-call response for ${normalizedNumber}:`, response.status, response.data);
}

/**
 * Main function: Find partners for the SOS and call them all.
 * 
 * Flow:
 * 1. Get all active service regions
 * 2. Check which region(s) the SOS location falls in (point-in-polygon)
 * 3. Find the SOS service (system service with id 'sos')
 * 4. Find active service partners who:
 *    - Are in the matching region(s) OR have no region restrictions
 *    - Are assigned to the SOS service
 * 5. Trigger phone call to each partner
 */
export async function triggerSOSCallsToPartners(location: SOSCallLocation, sosId?: string): Promise<SOSCallResult> {
    const result: SOSCallResult = {
        totalPartners: 0,
        callsTriggered: 0,
        callsFailed: 0,
        details: []
    };

    try {
        console.log(`[SOSCallService] Starting SOS call workflow for location: lat=${location.latitude}, lng=${location.longitude}${sosId ? `, SOS ID: ${sosId}` : ''}`);

        // 1. Find matching service regions
        const activeRegions = await ServiceRegion.find({ isActive: true });
        const matchingRegionIds: string[] = [];

        for (const region of activeRegions) {
            if (isPointInPolygon({ lat: location.latitude, lng: location.longitude }, region.polygon)) {
                matchingRegionIds.push(region._id.toString());
                console.log(`[SOSCallService] Location matched region: ${region.name} (${region._id})`);
            }
        }

        if (matchingRegionIds.length === 0) {
            console.warn(`[SOSCallService] No service region found for location lat=${location.latitude}, lng=${location.longitude}. Will try partners with no region restrictions.`);
        }

        // 2. Find the SOS service by name (case-insensitive)
        const sosService = await Service.findOne({ name: { $regex: /^SOS/i } });
        if (!sosService) {
            console.error('[SOSCallService] SOS service not found in database. Cannot determine eligible partners.');
            return result;
        }

        const sosServiceId = sosService._id.toString();
        console.log(`[SOSCallService] SOS Service found: ${sosService.name} (${sosServiceId})`);

        // 3. Build partner filter
        const partnerFilter: any = {
            isActive: true,
            services: { $in: [sosServiceId] }
        };

        // If we found matching regions, filter by those regions (or partners with no restrictions)
        if (matchingRegionIds.length > 0) {
            partnerFilter.$or = [
                { serviceRegions: { $in: matchingRegionIds } },
                { serviceRegions: { $size: 0 } } // Partners available in all regions
            ];
        }
        // If no region matched, only get partners with no region restrictions
        else {
            partnerFilter.serviceRegions = { $size: 0 };
        }

        // 4. Find eligible partners
        const eligiblePartners = await ServicePartner.find(partnerFilter);
        result.totalPartners = eligiblePartners.length;

        console.log(`[SOSCallService] Found ${eligiblePartners.length} eligible partner(s) for SOS calls`);

        if (eligiblePartners.length === 0) {
            console.warn('[SOSCallService] No eligible partners found to call for this SOS.');
            return result;
        }

        // 5. Trigger phone calls to all eligible partners (in parallel)
        const callPromises = eligiblePartners.map(async (partner) => {
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

        console.log(`[SOSCallService] SOS call workflow complete. Triggered: ${result.callsTriggered}, Failed: ${result.callsFailed}`);

    } catch (error: any) {
        console.error('[SOSCallService] Critical error in SOS call workflow:', error);
    }

    return result;
}
