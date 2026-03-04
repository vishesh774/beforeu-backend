import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import HealthPartner from '../models/HealthPartner';
import User from '../models/User';
import FamilyMember from '../models/FamilyMember';
import UserPlan from '../models/UserPlan';
import PlanTransaction from '../models/PlanTransaction';
import { generateHealthCardBuffer } from '../utils/healthCardGenerator';
import { getPlanHolderId } from '../utils/userHelpers';

// @desc    Get all health partners (Admin)
// @route   GET /api/admin/health-partners
// @access  Admin
export const getAllHealthPartners = asyncHandler(async (_req: any, res: Response) => {
    const partners = await HealthPartner.find().sort({ order: 1, createdAt: -1 });

    res.status(200).json({
        success: true,
        count: partners.length,
        data: partners
    });
});

// @desc    Get active health partners (Public/Customer)
// @route   GET /api/health-partners
// @access  Public
export const getActiveHealthPartners = asyncHandler(async (_req: Request, res: Response) => {
    const partners = await HealthPartner.find({ isActive: true }).sort({ order: 1 });

    res.status(200).json({
        success: true,
        count: partners.length,
        data: partners
    });
});

// @desc    Create health partner
// @route   POST /api/admin/health-partners
// @access  Admin
export const createHealthPartner = asyncHandler(async (req: any, res: Response) => {
    const { name, logo, isActive, order } = req.body;

    if (!name || !logo) {
        throw new AppError('Partner name and logo are required', 400);
    }

    const partner = await HealthPartner.create({
        name,
        logo,
        isActive: isActive !== undefined ? isActive : true,
        order: order || 0
    });

    res.status(201).json({
        success: true,
        data: partner
    });
});

// @desc    Update health partner
// @route   PUT /api/admin/health-partners/:id
// @access  Admin
export const updateHealthPartner = asyncHandler(async (req: any, res: Response) => {
    let partner = await HealthPartner.findById(req.params.id);

    if (!partner) {
        throw new AppError('Health partner not found', 404);
    }

    partner = await HealthPartner.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true
    });

    res.status(200).json({
        success: true,
        data: partner
    });
});

// @desc    Delete health partner
// @route   DELETE /api/admin/health-partners/:id
// @access  Admin
export const deleteHealthPartner = asyncHandler(async (req: any, res: Response) => {
    const partner = await HealthPartner.findById(req.params.id);

    if (!partner) {
        throw new AppError('Health partner not found', 404);
    }

    await partner.deleteOne();

    res.status(200).json({
        success: true,
        data: {}
    });
});

// @desc    Download my health card
// @route   GET /api/health-card/me
// @access  Private
export const downloadMyHealthCard = asyncHandler(async (req: any, res: Response) => {
    const user = await User.findById(req.user.id);
    if (!user) {
        throw new AppError('User not found', 404);
    }

    // Find the primary user if this user is a family member sharing a plan
    const planHolderId = await getPlanHolderId(req.user.id);

    // Check for active plan of the plan holder
    const userPlan = await UserPlan.findOne({ userId: planHolderId });
    if (!userPlan || !userPlan.expiresAt || new Date(userPlan.expiresAt) < new Date()) {
        throw new AppError('No active plan found. An active subscription is required to generate a Health ID.', 403);
    }

    // Get latest invoice number for that plan
    const transaction = await PlanTransaction.findOne({
        userId: planHolderId,
        status: 'completed'
    }).sort({ createdAt: -1 });

    const buffer = await generateHealthCardBuffer({
        name: user.name,
        phone: user.phone,
        gender: user.gender,
        dob: user.dob,
        uhid: transaction?.invoiceNumber,
        emergencyContact: user.emergencyContact,
        validity: userPlan.expiresAt
    });

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=HealthID_${user.name.replace(/\s+/g, '_')}.pdf`);
    res.send(buffer);
});

// @desc    Download family health card
// @route   GET /api/health-card/family/:memberId
// @access  Private
export const downloadFamilyHealthCard = asyncHandler(async (req: any, res: Response) => {
    const member = await FamilyMember.findOne({ userId: req.user.id, id: req.params.memberId });
    if (!member) {
        throw new AppError('Family member not found', 404);
    }

    // Find the plan holder (usually the user who added this family member)
    const planHolderId = await getPlanHolderId(req.user.id);

    // Check for active plan of the plan holder
    const userPlan = await UserPlan.findOne({ userId: planHolderId });
    if (!userPlan || !userPlan.expiresAt || new Date(userPlan.expiresAt) < new Date()) {
        throw new AppError('No active plan found. An active subscription is required to generate a Health ID.', 403);
    }

    // Get latest invoice number
    const transaction = await PlanTransaction.findOne({
        userId: planHolderId,
        status: 'completed'
    }).sort({ createdAt: -1 });

    const buffer = await generateHealthCardBuffer({
        name: member.name,
        phone: member.phone,
        gender: member.gender,
        dob: member.dob,
        uhid: transaction?.invoiceNumber,
        emergencyContact: member.emergencyContact,
        validity: userPlan.expiresAt
    });

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=HealthID_${member.name.replace(/\s+/g, '_')}.pdf`);
    res.send(buffer);
});

// @desc    Download user health card (Admin)
// @route   GET /api/admin/health-card/user/:userId
// @access  Admin
export const adminDownloadUserHealthCard = asyncHandler(async (req: any, res: Response) => {
    const user = await User.findById(req.params.userId);
    if (!user) {
        throw new AppError('User not found', 404);
    }

    // Find the primary user if this user is a family member sharing a plan
    const planHolderId = await getPlanHolderId(req.params.userId);

    // Check for active plan of the plan holder
    const userPlan = await UserPlan.findOne({ userId: planHolderId });
    if (!userPlan || !userPlan.expiresAt || new Date(userPlan.expiresAt) < new Date()) {
        throw new AppError('User does not have an active plan or is not covered by any plan holder.', 400);
    }

    // Get latest invoice number
    const transaction = await PlanTransaction.findOne({
        userId: planHolderId,
        status: 'completed'
    }).sort({ createdAt: -1 });

    const buffer = await generateHealthCardBuffer({
        name: user.name,
        phone: user.phone,
        gender: user.gender,
        dob: user.dob,
        uhid: transaction?.invoiceNumber || 'PENDING',
        emergencyContact: user.emergencyContact,
        validity: userPlan.expiresAt
    });

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Admin_HealthID_${user.name.replace(/\s+/g, '_')}.pdf`);
    res.send(buffer);
});
