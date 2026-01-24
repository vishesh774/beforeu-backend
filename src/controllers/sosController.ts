import { Response } from 'express';
import { SOSAlert, SOSStatus } from '../models/SOSAlert';
import mongoose from 'mongoose';
import Booking from '../models/Booking';
import OrderItem from '../models/OrderItem';
import { socketService } from '../services/socketService';
import { AuthRequest } from '../middleware/auth';
import { getSOSService } from '../utils/systemServices';
import { syncBookingStatus, autoAssignServicePartner } from '../services/bookingService';
import { getPlanHolderId, getFamilyGroupIds } from '../utils/userHelpers';
import UserPlan from '../models/UserPlan';
import UserCredits from '../models/UserCredits';
import Plan from '../models/Plan';
import User from '../models/User';
import { sendPushNotification } from '../services/pushNotificationService';
import { formatTimeToIST } from '../utils/dateUtils';

import CustomerAppSettings from '../models/CustomerAppSettings';

export const triggerSOS = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { location, familyMemberId, serviceId } = req.body;

        // Identify the plan holder (Primary account owner) for credits/plan verification
        const userIdObj = new mongoose.Types.ObjectId(userId);
        const planHolderId = await getPlanHolderId(userIdObj);

        // 1. Verify Plan and SOS allowance
        const userPlan = await UserPlan.findOne({ userId: planHolderId });
        let isFree = false;

        const plan = userPlan?.activePlanId ? await Plan.findById(userPlan.activePlanId) : null;
        const hasActivePlan = plan && plan.allowSOS;

        if (!hasActivePlan) {
            // Check Free Quota
            const customerSettings = await CustomerAppSettings.findOne();
            const maxFree = customerSettings?.maxFreeSosCount || 0;

            if (maxFree <= 0) {
                res.status(403).json({ success: false, error: 'SOS is only available for users with an active plan.' });
                return;
            }

            const usedFreeCount = await SOSAlert.countDocuments({
                user: userId,
                usedFreeQuota: true
            });

            if (usedFreeCount >= maxFree) {
                res.status(403).json({ success: false, error: 'You have exhausted your free SOS requests. Please purchase a plan.' });
                return;
            }

            isFree = true;
        }

        // 2. Check for sufficient credits in the plan holder's account (Only if NOT free)
        const { service, variant } = await getSOSService();
        const creditsNeeded = variant.creditValue || 0;

        const userCredits = await UserCredits.findOne({ userId: planHolderId });
        if (!isFree && (!userCredits || (creditsNeeded > 0 && userCredits.credits < creditsNeeded))) {
            res.status(403).json({ success: false, error: `Insufficient credits to trigger SOS. Need ${creditsNeeded} credits.` });
            return;
        }

        // Check if there is already an active SOS for this user
        const existingAlert = await SOSAlert.findOne({
            user: userId,
            status: { $in: [SOSStatus.TRIGGERED, SOSStatus.ACKNOWLEDGED, SOSStatus.PARTNER_ASSIGNED, SOSStatus.EN_ROUTE, SOSStatus.REACHED, SOSStatus.IN_PROGRESS] }
        });

        if (existingAlert) {
            // Update location of existing alert instead of creating new one
            existingAlert.location = location;
            // Update other details if provided
            if (familyMemberId) existingAlert.familyMemberId = familyMemberId;
            if (serviceId) existingAlert.serviceId = serviceId;

            existingAlert.logs.push({
                action: 'LOCATION_UPDATE',
                timestamp: new Date(),
                details: 'User triggered SOS again, location updated'
            });

            existingAlert.updatedAt = new Date();
            await existingAlert.save();

            // Emit update event
            const populatedAlert = await existingAlert.populate('user', 'name phone email');
            socketService.emitToAdmin('sos:active', populatedAlert);

            res.status(200).json({
                success: true,
                data: populatedAlert,
                message: 'SOS location updated'
            });
            return;
        }

        // Generate human-readable SOS ID
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
        const count = await SOSAlert.countDocuments({
            sosId: { $regex: new RegExp(`^SOS-${dateStr}-`) }
        });
        const sosIdStr = `SOS-${dateStr}-${String(count + 1).padStart(3, '0')}`;

        // Generate 4-digit OTP
        const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();

        // Create new SOS Alert
        const newAlert = new SOSAlert({
            user: userId,
            sosId: sosIdStr,
            otp: generatedOtp,
            location: {
                ...location,
                emergencyType: location.emergencyType || 'General Emergency'
            },
            familyMemberId,
            serviceId,
            status: SOSStatus.TRIGGERED,
            usedFreeQuota: isFree,
            logs: [{
                action: 'TRIGGERED',
                timestamp: new Date(),
                performedBy: userId,
                details: `User initiated SOS${planHolderId.toString() !== userId ? ' (Family Plan)' : ''}`
            }]
        });

        // --- NEW: Create Booking and OrderItem for SOS ---
        try {
            // We already fetched service/variant above

            // Generate booking ID
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
            const bCount = await Booking.countDocuments({
                bookingId: { $regex: new RegExp(`^BOOK-${dateStr}-`) }
            });
            const bIdStr = `BOOK-${dateStr}-${String(bCount + 1).padStart(3, '0')}`;

            const booking = await Booking.create({
                userId: userIdObj,
                bookingId: bIdStr,
                addressId: 'SOS_LOCATION',
                address: {
                    label: 'SOS Emergency',
                    fullAddress: location.fullAddress || 'Emergency Location',
                    coordinates: {
                        lat: location.latitude,
                        lng: location.longitude
                    }
                },
                bookingType: 'SOS',
                scheduledDate: now,
                scheduledTime: formatTimeToIST(now),
                itemTotal: variant.finalPrice || 0,
                totalAmount: variant.finalPrice || 0,
                totalOriginalAmount: variant.originalPrice || 0,
                creditsUsed: isFree ? 0 : creditsNeeded,
                status: 'confirmed',
                paymentStatus: 'paid',
                notes: `SOS ALERT: ${location.emergencyType || 'General Emergency'}`
            });

            // Link booking to SOS alert immediately after creation
            newAlert.bookingId = booking._id;

            const orderItem = await OrderItem.create({
                bookingId: booking._id,
                serviceId: service._id,
                serviceVariantId: variant._id,
                serviceName: service.name,
                variantName: variant.name,
                quantity: 1,
                originalPrice: variant.originalPrice,
                finalPrice: variant.finalPrice,
                creditValue: isFree ? 0 : creditsNeeded,
                estimatedTimeMinutes: variant.estimatedTimeMinutes || 30,
                customerVisitRequired: true,
                paidWithCredits: !isFree && creditsNeeded > 0,
                status: 'confirmed',
                startJobOtp: 'NONE', // Special case for SOS
                endJobOtp: generatedOtp, // Use the SOS OTP as the completion OTP
            });

            // 3. Deduct Credits from Plan Holder
            if (!isFree && creditsNeeded > 0 && userCredits) {
                userCredits.credits = Math.max(0, userCredits.credits - creditsNeeded);
                await userCredits.save();
                console.log(`[triggerSOS] Deducted ${creditsNeeded} credits from plan holder ${planHolderId}`);
            }

            // Trigger auto-assignment for SOS
            console.log(`[triggerSOS] Triggering auto-assignment for SOS booking ${bIdStr}`);
            try {
                await autoAssignServicePartner(booking, [orderItem]);
            } catch (assignError) {
                console.error('[triggerSOS] Auto-assignment failed but booking/item created:', assignError);
            }

            console.log(`[triggerSOS] Created Booking ${bIdStr} for SOS`);
        } catch (bookingError) {
            console.error('[triggerSOS] Error creating SOS booking/item:', bookingError);
        }
        // --- END: Create Booking ---

        await newAlert.save();

        // --- NEW: Notify Family Members & Plan Holder ---
        try {
            const familyGroupIds = await getFamilyGroupIds(planHolderId);
            // Filter out the sender
            const recipientsIds = familyGroupIds.filter(id => id.toString() !== userId);

            if (recipientsIds.length > 0) {
                const recipients = await User.find({ _id: { $in: recipientsIds }, pushToken: { $exists: true, $ne: '' } });
                const sender = await User.findById(userId);

                for (const recipient of recipients) {
                    if (recipient.pushToken) {
                        await sendPushNotification({
                            pushToken: recipient.pushToken,
                            title: '🚨 Family SOS Alert!',
                            body: `${sender?.name || 'Someone'} in your family group has triggered an SOS alert. Emergency Type: ${location.emergencyType || 'General Emergency'}`,
                            data: {
                                sosId: newAlert.sosId,
                                userId: userId,
                                type: 'FAMILY_SOS',
                                screen: 'SOSDetails'
                            },
                            sound: 'ambulance',
                            channelId: 'emergency_v9_looping',
                            priority: 'high'
                        });
                    }
                }
                console.log(`[triggerSOS] Family notifications sent to ${recipients.length} members`);
            }
        } catch (notifError) {
            console.error('[triggerSOS] Error sending family notifications:', notifError);
        }

        // Populate user details for the frontend
        const populatedAlert = await newAlert.populate([
            { path: 'user', select: 'name phone email' },
            { path: 'familyMemberId' },
            { path: 'serviceId' }
        ]);

        // Emit socket event to admins
        socketService.emitToAdmin('sos:alert', populatedAlert);

        res.status(201).json({ success: true, data: populatedAlert });
    } catch (error) {
        console.error('Error triggering SOS:', error);
        res.status(500).json({ success: false, error: 'Failed to trigger SOS' });
    }
};

export const cancelSOS = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { alertId } = req.body;

        let alert;
        if (alertId) {
            alert = await SOSAlert.findById(alertId);
        } else {
            alert = await SOSAlert.findOne({
                user: userId,
                status: { $in: [SOSStatus.TRIGGERED, SOSStatus.ACKNOWLEDGED, SOSStatus.PARTNER_ASSIGNED, SOSStatus.EN_ROUTE, SOSStatus.REACHED, SOSStatus.IN_PROGRESS] }
            });
        }

        if (!alert) {
            res.status(404).json({ success: false, error: 'Active SOS alert not found' });
            return;
        }

        alert.status = SOSStatus.CANCELLED;
        alert.logs.push({
            action: 'CANCELLED',
            timestamp: new Date(),
            performedBy: userId as any,
            details: 'User cancelled SOS'
        });

        await alert.save();

        // Sync with Booking
        // Sync with Booking
        let bookingIdToUse = alert.bookingId;

        if (!bookingIdToUse) {
            const foundBooking = await Booking.findOne({
                userId: alert.user,
                bookingType: 'SOS'
            }).sort({ createdAt: -1 });

            if (foundBooking) {
                bookingIdToUse = foundBooking._id;
                alert.bookingId = foundBooking._id;
            }
        }

        if (bookingIdToUse) {
            await OrderItem.updateMany({ bookingId: bookingIdToUse }, { status: 'cancelled' });
            await syncBookingStatus(bookingIdToUse, { id: req.user?.id, name: req.user?.name || 'User' });
        }

        const populatedAlert = await alert.populate('user', 'name phone email');
        socketService.emitToAdmin('sos:cancelled', populatedAlert);

        res.status(200).json({ success: true, data: alert });
    } catch (error) {
        console.error('Error cancelling SOS:', error);
        res.status(500).json({ success: false, error: 'Failed to cancel SOS' });
    }
};

export const acknowledgeSOS = async (req: AuthRequest, res: Response) => {
    try {
        const adminId = req.user?.id;
        const { id } = req.params;

        const alert = await SOSAlert.findById(id);
        if (!alert) {
            res.status(404).json({ success: false, error: 'SOS Alert not found' });
            return;
        }

        if (alert.status !== SOSStatus.TRIGGERED) {
            res.status(400).json({ success: false, error: `Cannot acknowledge alert in ${alert.status} state` });
            return;
        }

        alert.status = SOSStatus.ACKNOWLEDGED;
        alert.logs.push({
            action: 'ACKNOWLEDGED',
            timestamp: new Date(),
            performedBy: adminId as any,
            details: 'Admin acknowledged request'
        });

        await alert.save();

        // Sync with Booking
        // Sync with Booking
        let bookingIdToUse = alert.bookingId;

        if (!bookingIdToUse) {
            const foundBooking = await Booking.findOne({
                userId: alert.user,
                bookingType: 'SOS'
            }).sort({ createdAt: -1 });

            if (foundBooking) {
                bookingIdToUse = foundBooking._id;
                alert.bookingId = foundBooking._id;
            }
        }

        if (bookingIdToUse) {
            await OrderItem.updateMany({ bookingId: bookingIdToUse }, { status: 'assigned' });
            await syncBookingStatus(bookingIdToUse, { id: req.user?.id, name: req.user?.name || 'Admin' });
        }

        const populatedAlert = await alert.populate('user', 'name phone email');
        socketService.emitToAdmin('sos:acknowledged', populatedAlert);

        res.status(200).json({ success: true, data: alert });
    } catch (error) {
        console.error('Error acknowledging SOS:', error);
        res.status(500).json({ success: false, error: 'Failed to acknowledge SOS' });
    }
};

export const resolveSOS = async (req: AuthRequest, res: Response) => {
    try {
        const adminId = req.user?.id;
        const { id } = req.params;
        const { otp, manualOverride, reason } = req.body;

        const alert = await SOSAlert.findById(id);
        if (!alert) {
            res.status(404).json({ success: false, error: 'SOS Alert not found' });
            return;
        }

        // Verify OTP unless manual override is requested by admin
        if (!manualOverride) {
            if (!otp) {
                res.status(400).json({ success: false, error: 'OTP is required to resolve SOS' });
                return;
            }
            if (alert.otp !== otp) {
                res.status(400).json({ success: false, error: 'Invalid OTP' });
                return;
            }
        }

        alert.status = SOSStatus.RESOLVED;
        alert.resolvedAt = new Date();
        alert.resolvedBy = adminId as any;
        alert.logs.push({
            action: 'RESOLVED',
            timestamp: new Date(),
            performedBy: adminId as any,
            details: manualOverride ? `Admin marked as resolved (Manual Override). Reason: ${reason || 'N/A'}` : 'Admin marked as resolved with OTP verification'
        });

        await alert.save();

        // Sync with Booking
        // Sync with Booking
        let bookingIdToUse = alert.bookingId;

        // Fallback: If no bookingId on alert, try to find a recent SOS booking for this user
        if (!bookingIdToUse) {
            const foundBooking = await Booking.findOne({
                userId: alert.user,
                bookingType: 'SOS'
            }).sort({ createdAt: -1 });

            if (foundBooking) {
                console.log(`[resolveSOS] Found unlinked SOS booking for resolution: ${foundBooking.bookingId}`);
                bookingIdToUse = foundBooking._id;

                // Link it for future references
                alert.bookingId = foundBooking._id;
            }
        }

        if (bookingIdToUse) {
            await OrderItem.updateMany({ bookingId: bookingIdToUse }, { status: 'completed' });
            await syncBookingStatus(bookingIdToUse, { id: req.user?.id, name: req.user?.name || 'Admin' });
        }

        const populatedAlert = await alert.populate('user', 'name phone email');
        socketService.emitToAdmin('sos:resolved', populatedAlert);

        res.status(200).json({ success: true, data: alert });
    } catch (error) {
        console.error('Error resolving SOS:', error);
        res.status(500).json({ success: false, error: 'Failed to resolve SOS' });
    }
};

export const getActiveSOS = async (_req: AuthRequest, res: Response) => {
    try {
        const activeAlerts = await SOSAlert.find({
            status: { $in: [SOSStatus.TRIGGERED, SOSStatus.ACKNOWLEDGED, SOSStatus.PARTNER_ASSIGNED, SOSStatus.EN_ROUTE, SOSStatus.REACHED, SOSStatus.IN_PROGRESS] }
        })
            .populate('user', 'name phone email')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: activeAlerts });
    } catch (error) {
        console.error('Error fetching active SOS:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch active SOS' });
    }
};

export const getAllSOS = async (req: AuthRequest, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const status = req.query.status as string;

        const filter: any = {};
        if (status && status !== 'all') {
            filter.status = status;
        }

        const total = await SOSAlert.countDocuments(filter);
        const alerts = await SOSAlert.find(filter)
            .populate('user', 'name phone email')
            .populate('resolvedBy', 'name email')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        res.status(200).json({
            success: true,
            data: {
                alerts,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Error fetching SOS history:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch SOS history' });
    }
};

export const getSOSAlertByBookingId = async (req: AuthRequest, res: Response) => {
    console.log('--- GET SOS ALERT BY BOOKING ID CALLED ---');
    try {
        const { bookingId } = req.params;
        console.log(`[getSOSAlertByBookingId] ID from params: "${bookingId}"`);

        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            res.status(400).json({ success: false, error: 'Invalid ID format' });
            return;
        }

        const requestedIdObj = new mongoose.Types.ObjectId(bookingId);

        // 1. Try finding by bookingId directly
        let alert = await SOSAlert.findOne({ bookingId: requestedIdObj })
            .populate('user', 'name phone email')
            .populate('familyMemberId', 'name relationship phone');

        // 2. If not found, maybe the provided ID is an OrderItem ID?
        if (!alert) {
            console.log(`[getSOSAlertByBookingId] No alert for bookingId ${bookingId}, checking if it is an OrderItem ID...`);
            const item = await OrderItem.findById(requestedIdObj);
            if (item && item.bookingId) {
                console.log(`[getSOSAlertByBookingId] Found OrderItem ${bookingId}, using its bookingId: ${item.bookingId}`);
                alert = await SOSAlert.findOne({ bookingId: item.bookingId })
                    .populate('user', 'name phone email')
                    .populate('familyMemberId', 'name relationship phone');
            }
        }

        // 3. Last fallback: check serviceId field on SOSAlert (sometimes used for OrderItem)
        if (!alert) {
            console.log(`[getSOSAlertByBookingId] Still no alert, checking serviceId field...`);
            alert = await SOSAlert.findOne({ serviceId: requestedIdObj })
                .populate('user', 'name phone email')
                .populate('familyMemberId', 'name relationship phone');
        }

        if (!alert) {
            console.log(`[getSOSAlertByBookingId] Final Failure: No SOS alert found for ID: ${bookingId}`);
            res.status(404).json({ success: false, error: 'SOS alert not found' });
            return;
        }

        console.log(`[getSOSAlertByBookingId] Success! Alert found: ${alert.sosId}`);
        res.status(200).json({ success: true, alert });
    } catch (error) {
        console.error('Error fetching SOS alert by booking ID:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

export const updatePartnerLocation = async (req: AuthRequest, res: Response) => {
    try {
        const { alertId, latitude, longitude } = req.body;

        if (!alertId || latitude === undefined || longitude === undefined) {
            res.status(400).json({ success: false, error: 'Alert ID and coordinates are required' });
            return;
        }

        const alert = await SOSAlert.findById(alertId);
        if (!alert) {
            res.status(404).json({ success: false, error: 'SOS Alert not found' });
            return;
        }

        alert.partnerLocation = {
            latitude,
            longitude,
            updatedAt: new Date()
        };

        await alert.save();

        // Emit to admins
        socketService.emitToAdmin('sos:active', await alert.populate('user', 'name phone email'));

        res.status(200).json({ success: true, partnerLocation: alert.partnerLocation });
    } catch (error) {
        console.error('Error updating partner location:', error);
        res.status(500).json({ success: false, error: 'Failed to update partner location' });
    }
};

export const getSOSDetails = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const alert = await SOSAlert.findById(id)
            .populate('user', 'name phone email')
            .populate('familyMemberId')
            .populate('resolvedBy', 'name email');

        if (!alert) {
            res.status(404).json({ success: false, error: 'SOS alert not found' });
            return;
        }

        let bookingData = null;
        let bookingIdToUse = alert.bookingId;

        // Fallback: If no bookingId on alert, try to find a recent SOS booking for this user
        if (!bookingIdToUse) {
            const foundBooking = await Booking.findOne({
                userId: alert.user._id,
                bookingType: 'SOS'
            }).sort({ createdAt: -1 });
            if (foundBooking) {
                bookingIdToUse = foundBooking._id;
            }
        }

        if (bookingIdToUse) {
            const booking = await Booking.findById(bookingIdToUse).populate('userId', 'name email phone');
            if (booking) {
                let items = await OrderItem.find({ bookingId: booking._id })
                    .populate('serviceId', 'name icon')
                    .populate('serviceVariantId', 'name icon')
                    .populate('assignedPartnerId', 'name phone email')
                    .populate('assignedServiceLocationId', 'name address contactNumber');

                // Healing logic: If SOS booking has no items, create the default one
                if (items.length === 0 && booking.bookingType === 'SOS') {
                    console.log(`[getSOSDetails] Healing SOS booking ${booking.bookingId}: Creating missing OrderItem`);
                    const { service, variant } = await getSOSService();
                    await OrderItem.create({
                        bookingId: booking._id,
                        serviceId: service._id,
                        serviceVariantId: variant._id,
                        serviceName: service.name,
                        variantName: variant.name,
                        quantity: 1,
                        originalPrice: 0,
                        finalPrice: 0,
                        creditValue: 0,
                        estimatedTimeMinutes: 30,
                        customerVisitRequired: true,
                        paidWithCredits: false,
                        status: booking.status === 'pending' ? 'confirmed' : (booking.status as any) || 'confirmed',
                        startJobOtp: 'NONE',
                        endJobOtp: alert.otp || Math.floor(1000 + Math.random() * 9000).toString(),
                    });

                    // Re-fetch items after creation to have populated data
                    items = await OrderItem.find({ bookingId: booking._id })
                        .populate('serviceId', 'name icon')
                        .populate('serviceVariantId', 'name icon')
                        .populate('assignedPartnerId', 'name phone email')
                        .populate('assignedServiceLocationId', 'name address contactNumber');
                }

                bookingData = {
                    id: booking._id,
                    bookingId: booking.bookingId,
                    customer: {
                        id: (booking.userId as any)._id,
                        name: (booking.userId as any).name,
                        email: (booking.userId as any).email,
                        phone: (booking.userId as any).phone
                    },
                    items: items.map(item => ({
                        id: item._id,
                        serviceId: (item.serviceId as any)._id || item.serviceId,
                        serviceName: item.serviceName,
                        variantName: item.variantName,
                        quantity: item.quantity,
                        finalPrice: item.finalPrice,
                        originalPrice: item.originalPrice,
                        estimatedTimeMinutes: item.estimatedTimeMinutes,
                        status: item.status,
                        startJobOtp: item.startJobOtp,
                        endJobOtp: item.endJobOtp,
                        assignedPartner: item.assignedPartnerId ? {
                            id: (item.assignedPartnerId as any)._id,
                            name: (item.assignedPartnerId as any).name,
                            phone: (item.assignedPartnerId as any).phone,
                            email: (item.assignedPartnerId as any).email
                        } : null,
                        customerVisitRequired: item.customerVisitRequired,
                        paidWithCredits: item.paidWithCredits || false
                    })),
                    address: booking.address,
                    bookingType: booking.bookingType,
                    scheduledDate: booking.scheduledDate,
                    scheduledTime: booking.scheduledTime,
                    totalAmount: booking.totalAmount,
                    status: booking.status,
                    paymentStatus: booking.paymentStatus,
                    createdAt: booking.createdAt,
                    updatedAt: booking.updatedAt
                };
            }
        }

        const alertData = alert.toObject();
        (alertData as any).bookingId = bookingData;

        res.status(200).json({ success: true, data: alertData });
    } catch (error) {
        console.error('Error fetching SOS details:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
