import Service from '../models/Service';
import ServicePartner from '../models/ServicePartner';
import ServiceRegion from '../models/ServiceRegion';
import OrderItem from '../models/OrderItem';
import Booking from '../models/Booking';
import { isPointInPolygon } from '../utils/pointInPolygon';
import { BookingStatus } from '../constants/bookingStatus';
import { sendPushNotification } from './pushNotificationService';
import { SOSAlert, SOSStatus } from '../models/SOSAlert';
import { socketService } from './socketService';

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
    return true || (scheduledMinutes >= startMinutes && scheduledMinutes <= endMinutes);
}

// Helper function to synchronize Booking status based on OrderItems
export async function syncBookingStatus(bookingId: string | any, actor?: { id: any, name: string }): Promise<void> {
    try {
        const booking = await Booking.findById(bookingId);
        if (!booking) return;

        const items = await OrderItem.find({ bookingId });

        if (items.length === 0) return;

        const oldStatus = booking.status;
        let newStatus = BookingStatus.PENDING;
        const statuses = items.map(i => i.status);

        // check if all items are cancelled or refunded
        const allCancelled = items.every(i => i.status === BookingStatus.CANCELLED);
        const allRefunded = items.every(i => i.status === BookingStatus.REFUNDED);
        const allRefundInitiated = items.every(i => i.status === BookingStatus.REFUND_INITIATED);

        // check if all items are completed or cancelled/refunded (fully terminated)
        const allTerminated = items.every(i =>
            [BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.REFUNDED, BookingStatus.REFUND_INITIATED].includes(i.status as any)
        );

        if (allCancelled) {
            newStatus = BookingStatus.CANCELLED;
        } else if (allRefunded) {
            newStatus = BookingStatus.REFUNDED;
        } else if (allRefundInitiated) {
            newStatus = BookingStatus.REFUND_INITIATED;
        } else if (allTerminated) {
            newStatus = BookingStatus.COMPLETED;
        } else {
            if (statuses.some(s => s === BookingStatus.IN_PROGRESS || s === BookingStatus.COMPLETED)) {
                newStatus = BookingStatus.IN_PROGRESS;
            } else if (statuses.some(s => s === BookingStatus.REACHED)) {
                newStatus = BookingStatus.REACHED;
            } else if (statuses.some(s => s === BookingStatus.EN_ROUTE)) {
                newStatus = BookingStatus.EN_ROUTE;
            } else if (statuses.some(s => s === BookingStatus.ASSIGNED)) {
                newStatus = BookingStatus.ASSIGNED;
            } else if (statuses.some(s => s === BookingStatus.CONFIRMED)) {
                newStatus = BookingStatus.CONFIRMED;
            } else {
                newStatus = BookingStatus.PENDING;
            }
        }

        if (oldStatus !== newStatus) {
            await Booking.findByIdAndUpdate(bookingId, { status: newStatus });
            console.log(`[syncBookingStatus] Updated Booking ${bookingId} status from ${oldStatus} to ${newStatus}`);
        }

        // If SOS booking, always sync with SOSAlert to ensure granular progress
        if (booking.bookingType === 'SOS') {
            const alert = await SOSAlert.findOne({ bookingId: booking._id });
            if (alert) {
                // Use the status of the first item for granular SOS status
                const itemStatus = items[0].status;
                let logAction = itemStatus.toUpperCase();
                let socketEvent = 'sos:active';

                if (itemStatus === BookingStatus.ASSIGNED) {
                    alert.status = SOSStatus.PARTNER_ASSIGNED;
                    logAction = 'PARTNER_ASSIGNED';
                } else if (itemStatus === BookingStatus.EN_ROUTE) {
                    alert.status = SOSStatus.EN_ROUTE;
                    logAction = 'EN_ROUTE';
                } else if (itemStatus === BookingStatus.REACHED) {
                    alert.status = SOSStatus.REACHED;
                    logAction = 'REACHED';
                } else if (itemStatus === BookingStatus.IN_PROGRESS) {
                    alert.status = SOSStatus.IN_PROGRESS;
                    logAction = 'IN_PROGRESS';
                } else if (itemStatus === BookingStatus.COMPLETED) {
                    alert.status = SOSStatus.RESOLVED;
                    alert.resolvedAt = new Date();
                    if (actor) {
                        alert.resolvedBy = actor.id;
                    }
                    logAction = 'RESOLVED';
                    socketEvent = 'sos:resolved';
                } else if (itemStatus === BookingStatus.CANCELLED) {
                    alert.status = SOSStatus.CANCELLED;
                    logAction = 'CANCELLED';
                    socketEvent = 'sos:cancelled';
                }

                // Only add log if last log is different
                const lastLog = alert.logs[alert.logs.length - 1];
                if (!lastLog || lastLog.action !== logAction) {
                    alert.logs.push({
                        action: logAction,
                        timestamp: new Date(),
                        performedBy: actor?.id,
                        details: `Status synced with job: ${itemStatus}${actor ? ` by ${actor.name}` : ''}`
                    });
                }

                await alert.save();

                // Emit to admins for real-time dashboard updates
                const populatedAlert = await alert.populate([
                    { path: 'user', select: 'name phone email' },
                    { path: 'resolvedBy', select: 'name' }
                ]);
                socketService.emitToAdmin(socketEvent, populatedAlert);
                console.log(`[syncBookingStatus] Granular sync for SOSAlert ${alert.sosId} with item status ${itemStatus}${actor ? ` by ${actor.name}` : ''}`);
            }
        }

    } catch (error) {
        console.error('[syncBookingStatus] Error syncing status:', error);
    }
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

            const eligiblePartners = await ServicePartner.find(partnerFilter).sort({ lastAssignedAt: 1 });
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
                    status: [BookingStatus.PENDING, BookingStatus.CONFIRMED].includes(item.status) ? BookingStatus.ASSIGNED : item.status
                });

                // Update partner's lastAssignedAt for cyclic assignment
                await ServicePartner.findByIdAndUpdate(assignedPartner._id, { lastAssignedAt: new Date() });

                console.log(`[autoAssignServicePartner] Assigned partner ${assignedPartner.name} to item ${item._id} (${service.name})`);

                // Send Push Notification to Partner
                if (assignedPartner.pushToken) {
                    const isSOS = booking.bookingType === 'SOS';
                    const title = isSOS ? '🚨 SOS ALERT ASSIGNED!' : 'New Service Assigned';
                    const body = isSOS
                        ? `URGENT! SOS assigned at ${booking.address?.fullAddress || 'Unknown location'}. Check app immediately!`
                        : `You have been assigned ${service.name} for ${booking.scheduledDate ? new Date(booking.scheduledDate).toLocaleDateString() : 'Today'} ${booking.scheduledTime || ''}`;

                    const isToday = booking.scheduledDate
                        ? new Date(booking.scheduledDate).toDateString() === new Date().toDateString()
                        : true;

                    await sendPushNotification({
                        pushToken: assignedPartner.pushToken,
                        title,
                        body,
                        data: {
                            bookingId: booking._id,
                            itemId: item._id,
                            screen: 'BookingDetails',
                            type: isSOS ? 'SOS_ASSIGNED' : 'SERVICE_ASSIGNED'
                        },
                        // Requirement: SOS gets sound, Job for today only gets no sound
                        sound: isSOS ? 'default' : (isToday ? null : 'default'),
                        channelId: isSOS ? 'high_priority' : (isToday ? 'silent' : 'default'),
                        priority: isSOS ? 'high' : 'normal'
                    });
                    console.log(`[autoAssignServicePartner] Notification sent to partner ${assignedPartner.name}`);
                }
            } else {
                console.log(`[autoAssignServicePartner] No available partners for item ${item._id} at requested time`);
            }

        } catch (error) {
            console.error(`[autoAssignServicePartner] Error assigning partner for item ${item._id}:`, error);
            // Continue to next item
        }
    }

    // Sync booking status after assignments
    await syncBookingStatus(booking._id);
}
