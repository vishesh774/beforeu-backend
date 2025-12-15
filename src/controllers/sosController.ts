import { Response } from 'express';
import { SOSAlert, SOSStatus } from '../models/SOSAlert';
import { socketService } from '../services/socketService';
import { AuthRequest } from '../middleware/auth';

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

            existingAlert.updatedAt = new Date();
            await existingAlert.save();

            // Emit update event
            const populatedAlert = await existingAlert.populate([
                { path: 'user', select: 'name phoneNumber email' },
                { path: 'familyMemberId' },
                { path: 'serviceId' }
            ]);

            socketService.emitToAdmin('sos:active', populatedAlert);

            res.status(200).json({ success: true, data: existingAlert, message: 'Existing SOS updated' });
            return;
        }

        // Create new SOS Alert
        const newAlert = new SOSAlert({
            user: userId,
            location,
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

        await newAlert.save();

        // Populate user details for the frontend
        const populatedAlert = await newAlert.populate([
            { path: 'user', select: 'name phoneNumber email' },
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

export const cancelSOS = async (req: AuthRequest, res: Response) => { // Changed Request to AuthRequest
    try {
        const userId = req.user?.id; // Changed from _id to id
        // We might accept alertId, or just find the active one for this user
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
            performedBy: userId as any, // Added as any for type compatibility
            details: 'User cancelled SOS'
        });

        await alert.save();

        const populatedAlert = await alert.populate('user', 'name phoneNumber email');

        // Emit Cancellation Event
        socketService.emitToAdmin('sos:cancelled', populatedAlert);

        res.status(200).json({ success: true, data: alert });
    } catch (error) {
        console.error('Error cancelling SOS:', error);
        res.status(500).json({ success: false, error: 'Failed to cancel SOS' });
    }
};

export const acknowledgeSOS = async (req: AuthRequest, res: Response) => { // Changed Request to AuthRequest
    try {
        const adminId = req.user?.id; // Changed from _id to id
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
            performedBy: adminId as any, // Added as any for type compatibility
            details: 'Admin acknowledged request'
        });

        await alert.save();

        const populatedAlert = await alert.populate('user', 'name phoneNumber email');

        // Notify all admins that it's been picked up (to avoid double handling)
        socketService.emitToAdmin('sos:acknowledged', populatedAlert);

        res.status(200).json({ success: true, data: alert });
    } catch (error) {
        console.error('Error acknowledging SOS:', error);
        res.status(500).json({ success: false, error: 'Failed to acknowledge SOS' });
    }
};

export const resolveSOS = async (req: AuthRequest, res: Response) => { // Changed Request to AuthRequest
    try {
        const adminId = req.user?.id; // Changed from _id to id
        const { id } = req.params;

        const alert = await SOSAlert.findById(id);
        if (!alert) {
            res.status(404).json({ success: false, error: 'SOS Alert not found' });
            return;
        }

        alert.status = SOSStatus.RESOLVED;
        alert.resolvedAt = new Date();
        alert.resolvedBy = adminId as any; // Cast if type mismatch
        alert.logs.push({
            action: 'RESOLVED',
            timestamp: new Date(),
            performedBy: adminId as any, // Added as any for type compatibility
            details: 'Admin marked as resolved'
        });

        await alert.save();

        const populatedAlert = await alert.populate('user', 'name phoneNumber email');

        // Notify removal
        socketService.emitToAdmin('sos:resolved', populatedAlert);

        res.status(200).json({ success: true, data: alert });
    } catch (error) {
        console.error('Error resolving SOS:', error);
        res.status(500).json({ success: false, error: 'Failed to resolve SOS' });
    }
};

export const getActiveSOS = async (_req: AuthRequest, res: Response) => { // Changed Request to AuthRequest and req to _req
    try {
        const activeAlerts = await SOSAlert.find({
            status: { $in: [SOSStatus.TRIGGERED, SOSStatus.ACKNOWLEDGED] }
        })
            .populate('user', 'name phoneNumber email')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: activeAlerts });
    } catch (error) {
        console.error('Error fetching active SOS:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch active SOS' });
    }
};

// @desc    Get all SOS alerts (History)
// @route   GET /api/sos/history
// @access  Private/Admin
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
            .populate('user', 'name phoneNumber email')
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
