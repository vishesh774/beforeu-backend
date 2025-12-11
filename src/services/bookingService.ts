import Service from '../models/Service';
import ServicePartner from '../models/ServicePartner';
import ServiceRegion from '../models/ServiceRegion';
import OrderItem from '../models/OrderItem';
import { isPointInPolygon } from '../utils/pointInPolygon';

/**
 * Helper function to check if a service partner is available at a given time
 */
export function isPartnerAvailableAtTime(
    partner: any,
    scheduledDate: Date | undefined,
    scheduledTime: string | undefined
): boolean {
    if (!scheduledDate || !scheduledTime) {
        // For ASAP bookings, consider all partners as potentially available
        return true;
    }

    // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const dayOfWeek = scheduledDate.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[dayOfWeek];

    // Find availability for this day
    const dayAvailability = partner.availability.find((avail: any) => avail.day === dayName);
    if (!dayAvailability || !dayAvailability.isAvailable) {
        return false;
    }

    // Parse scheduled time (format: "HH:mm" or "HH:mm AM/PM")
    let scheduledHour = 0;
    let scheduledMinute = 0;

    if (scheduledTime.includes('AM') || scheduledTime.includes('PM')) {
        // Format: "HH:mm AM/PM"
        const timeMatch = scheduledTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (timeMatch) {
            let hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const period = timeMatch[3].toUpperCase();

            if (period === 'PM' && hours !== 12) hours += 12;
            if (period === 'AM' && hours === 12) hours = 0;

            scheduledHour = hours;
            scheduledMinute = minutes;
        }
    } else {
        // Format: "HH:mm"
        const timeMatch = scheduledTime.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
            scheduledHour = parseInt(timeMatch[1]);
            scheduledMinute = parseInt(timeMatch[2]);
        }
    }

    // Parse availability times (format: "HH:mm")
    const [startHour, startMinute] = dayAvailability.startTime.split(':').map(Number);
    const [endHour, endMinute] = dayAvailability.endTime.split(':').map(Number);

    // Convert to minutes for easier comparison
    const scheduledMinutes = scheduledHour * 60 + scheduledMinute;
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    // Check if scheduled time is within availability window
    return scheduledMinutes >= startMinutes && scheduledMinutes <= endMinutes;
}

/**
 * Auto-assign the best matching service partner to a booking
 * This function finds eligible partners and assigns the first available one PER ITEM
 * If no partner is available for an item, that item proceeds without assignment
 */
export async function autoAssignServicePartner(booking: any, orderItems: any[]): Promise<void> {
    // Get booking location
    const bookingLocation = booking.address?.coordinates;
    if (!bookingLocation) {
        console.log('[autoAssignServicePartner] No booking location found, skipping assignment');
        return;
    }

    // Find service regions that contain the booking location
    // We do this once for the booking since location is constant
    const activeRegions = await ServiceRegion.find({ isActive: true });
    const matchingRegionIds: string[] = [];

    for (const region of activeRegions) {
        if (isPointInPolygon(bookingLocation, region.polygon)) {
            matchingRegionIds.push(region._id.toString());
        }
    }

    console.log('[autoAssignServicePartner] Matching regions:', matchingRegionIds);

    // Iterate through each order item and try to assign a partner
    for (const item of orderItems) {
        try {
            // Get the actual service from the item
            const service = await Service.findById(item.serviceId);
            if (!service) {
                console.log(`[autoAssignServicePartner] Service not found for item ${item._id}, skipping`);
                continue;
            }

            const serviceIdString = service.id; // The string ID used in ServicePartner services array

            // Find service partners who:
            // 1. Are active
            // 2. Have THIS service
            // 3. Have at least one matching service region (or no region restrictions)
            const partnerFilter: any = {
                isActive: true,
                services: { $in: [serviceIdString] }
            };

            // If we found matching regions, filter by regions (or partners with no region restrictions)
            if (matchingRegionIds.length > 0) {
                partnerFilter.$or = [
                    { serviceRegions: { $in: matchingRegionIds } },
                    { serviceRegions: { $size: 0 } } // Partners available in all regions
                ];
            }

            console.log(`[autoAssignServicePartner] Processing item ${item._id}. Service: ${service.name} (${serviceIdString})`);

            const eligiblePartners = await ServicePartner.find(partnerFilter);
            console.log(`[autoAssignServicePartner] Found ${eligiblePartners.length} eligible partners for service ${serviceIdString}`);

            if (eligiblePartners.length === 0) {
                console.log(`[autoAssignServicePartner] No eligible partners found for item ${item._id} (${service.name})`);
                continue;
            }

            // Check availability based on schedule
            const scheduledDate = booking.scheduledDate;
            const scheduledTime = booking.scheduledTime;

            // Shuffle partners to distribute load randomly among available ones
            // or simplistic: just pick the first one that is available
            let assignedPartner: any = null;

            for (const partner of eligiblePartners) {
                const isAvailable = isPartnerAvailableAtTime(partner, scheduledDate, scheduledTime);
                console.log(`[autoAssignServicePartner] Partner ${partner.name} available? ${isAvailable}`);
                if (isAvailable) {
                    assignedPartner = partner;
                    break; // Found one!
                }
            }

            if (assignedPartner) {
                // Assign partner to this specific order item
                await OrderItem.findByIdAndUpdate(item._id, {
                    assignedPartnerId: assignedPartner._id,
                    status: item.status === 'pending' ? 'assigned' : item.status
                });
                console.log(`[autoAssignServicePartner] Assigned partner ${assignedPartner.name} to item ${item._id} (${service.name})`);
            } else {
                console.log(`[autoAssignServicePartner] No available partners for item ${item._id} at requested time`);
            }

        } catch (error) {
            console.error(`[autoAssignServicePartner] Error assigning partner for item ${item._id}:`, error);
            // Continue to next item
        }
    }
}
