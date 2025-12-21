import { Response } from 'express';
import { SOSAlert, SOSStatus } from '../models/SOSAlert';
import mongoose from 'mongoose';
import Booking from '../models/Booking';
import OrderItem from '../models/OrderItem';
import { socketService } from '../services/socketService';
import { AuthRequest } from '../middleware/auth';
import { getSOSService } from '../utils/systemServices';
import { syncBookingStatus, autoAssignServicePartner } from '../services/bookingService';

export const triggerSOS = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { location, familyMemberId, serviceId } = req.body;

        if (!userId || !location || !location.latitude || !location.longitude) {
            res.status(400).json({ success: false, error: 'User ID and Location are required' });
            return;
        }

        // Check if there is already an active SOS for this user
        const existingAlert = await SOSAlert.findOne({
            user: userId,
            status: { $in: [SOSStatus.TRIGGERED, SOSStatus.ACKNOWLEDGED] }
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
            logs: [{
                action: 'TRIGGERED',
                timestamp: new Date(),
                performedBy: userId,
                details: 'User initiated SOS'
            }]
        });

        // --- NEW: Create Booking and OrderItem for SOS ---
        try {
            const { service, variant } = await getSOSService();

            // Generate booking ID
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
            const count = await Booking.countDocuments({
                bookingId: { $regex: new RegExp(`^BOOK-${dateStr}-`) }
            });
            const bIdStr = `BOOK-${dateStr}-${String(count + 1).padStart(3, '0')}`;

            const booking = await Booking.create({
                userId: new mongoose.Types.ObjectId(userId),
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
                itemTotal: 0,
                totalAmount: 0,
                totalOriginalAmount: 0,
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
                originalPrice: 0,
                finalPrice: 0,
                creditValue: 0,
                estimatedTimeMinutes: 30,
                customerVisitRequired: true,
                paidWithCredits: false,
                status: 'confirmed',
                startJobOtp: 'NONE', // Special case for SOS
                endJobOtp: generatedOtp, // Use the SOS OTP as the completion OTP
            });

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
                status: { $in: [SOSStatus.TRIGGERED, SOSStatus.ACKNOWLEDGED] }
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
        if (alert.bookingId) {
            await OrderItem.updateMany({ bookingId: alert.bookingId }, { status: 'cancelled' });
            await syncBookingStatus(alert.bookingId);
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
        if (alert.bookingId) {
            await OrderItem.updateMany({ bookingId: alert.bookingId }, { status: 'assigned' });
            await syncBookingStatus(alert.bookingId);
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
        if (alert.bookingId) {
            await OrderItem.updateMany({ bookingId: alert.bookingId }, { status: 'completed' });
            await syncBookingStatus(alert.bookingId);
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
            status: { $in: [SOSStatus.TRIGGERED, SOSStatus.ACKNOWLEDGED] }
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
    try {
        const { bookingId } = req.params;
        const alert = await SOSAlert.findOne({ bookingId })
            .populate('user', 'name phone email')
            .populate('familyMemberId', 'name relationship phone');

        if (!alert) {
            res.status(404).json({ success: false, error: 'SOS alert not found for this booking' });
            return;
        }

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
