import User from '../models/User';
import FamilyMember from '../models/FamilyMember';
import Address from '../models/Address';
import UserCredits from '../models/UserCredits';
import UserPlan from '../models/UserPlan';
import Plan from '../models/Plan';
import mongoose from 'mongoose';
import { SOSAlert } from '../models/SOSAlert';
import CustomerAppSettings from '../models/CustomerAppSettings';

export interface AggregatedUserData {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  isActive: boolean;
  credits: number;
  activePlanId?: string;
  activePlan?: {
    id: string;
    planName: string;
    planTitle: string;
    planSubTitle: string;
    planStatus: 'active' | 'inactive';
    allowSOS: boolean;
    totalCredits: number;
    originalPrice: number;
    finalPrice: number;
    totalMembers: number;
    extraDiscount?: number;
    expiresAt?: Date;
  };
  familyMembers: Array<{
    id: string;
    name: string;
    relation: string;
    phone: string;
    email?: string;
  }>;
  pushToken?: string;
  addresses: Array<{
    id: string;
    label: string;
    fullAddress: string;
    area?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
    isDefault: boolean;
  }>;
  createdAt: Date;
  updatedAt: Date;
  sosEligibility: {
    allowed: boolean;
    reason: 'PLAN' | 'FREE_QUOTA' | 'NO_PLAN';
    remainingFree?: number;
    maxFree?: number;
  };
}

/**
 * Find the primary user ID if the current user is a family member of an active plan holder
 */
export const getPlanHolderId = async (userId: string | mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId> => {
  const user = await User.findById(userId);
  if (!user) {
    return new mongoose.Types.ObjectId(userId);
  }

  // 1. Check if the user has their own active plan first
  const myPlan = await UserPlan.findOne({ userId: user._id });
  if (myPlan?.activePlanId) {
    if (!myPlan.expiresAt || new Date() < myPlan.expiresAt) {
      return user._id;
    }
  }

  // 2. Check if this user is a family member of someone who has an active plan
  const familyRef = await FamilyMember.findOne({ phone: user.phone });
  if (familyRef) {
    const primaryPlan = await UserPlan.findOne({ userId: familyRef.userId });
    if (primaryPlan?.activePlanId) {
      // Ensure the plan is not expired
      if (!primaryPlan.expiresAt || new Date() < primaryPlan.expiresAt) {
        return familyRef.userId;
      }
    }
  }

  return user._id;
};

/**
 * Get all user IDs in the family group (Shared Pool)
 */
export const getFamilyGroupIds = async (planHolderId: string | mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId[]> => {
  const planHolder = await User.findById(planHolderId);
  if (!planHolder) return [new mongoose.Types.ObjectId(planHolderId)];

  // Find all family members added by this primary user
  const familyMembers = await FamilyMember.find({ userId: planHolderId });

  // Also find any Users that have the same phone as these family members
  // This is how we link family member records to actual User accounts
  const familyPhones = familyMembers.map(fm => fm.phone);
  const secondaryUsers = await User.find({ phone: { $in: familyPhones } });

  const allIds = [
    planHolder._id,
    ...secondaryUsers.map(u => u._id)
  ];

  return allIds;
};

/**
 * Aggregate user data from multiple collections
 */
export const aggregateUserData = async (userId: string | mongoose.Types.ObjectId): Promise<AggregatedUserData | null> => {
  const user = await User.findById(userId);
  if (!user) {
    return null;
  }

  // Find the primary user if this user is a family member sharing a plan
  const planHolderId = await getPlanHolderId(user._id);
  const isSharedPlan = planHolderId.toString() !== user._id.toString();

  // Fetch plan holder user details if different from current user
  let planHolderUser = user;
  if (isSharedPlan) {
    const ph = await User.findById(planHolderId);
    if (ph) planHolderUser = ph;
  }

  // Fetch related data
  // Family members and addresses are always SHARED if plan is shared?
  // User says: "On the family page, we should be able to see all the family members on the family page."
  // This implies the list is shared.
  const [familyMembers, addresses, userCredits, userPlan] = await Promise.all([
    FamilyMember.find({ userId: planHolderId }).sort({ createdAt: 1 }), // Shared list
    Address.find({ userId: user._id }).sort({ createdAt: 1 }),          // Addresses remain specific to the user?
    UserCredits.findOne({ userId: planHolderId }),
    UserPlan.findOne({ userId: planHolderId })
  ]);

  // Map family members
  const mappedFamilyMembers = familyMembers.map(fm => ({
    id: fm.id,
    name: fm.name,
    relation: fm.relation,
    phone: fm.phone,
    email: fm.email
  }));

  // Add the Plan Holder to the family members list as 'Primary'
  // Only if they aren't already included (which they aren't, as they are the userId)
  mappedFamilyMembers.unshift({
    id: 'primary-' + planHolderUser._id.toString(),
    name: planHolderUser.name + ' (Primary)',
    relation: 'Primary Account',
    phone: planHolderUser.phone,
    email: planHolderUser.email
  });

  // Fetch active plan details if activePlanId exists
  let activePlan = undefined;
  if (userPlan?.activePlanId) {
    const plan = await Plan.findById(userPlan.activePlanId);
    if (plan) {
      activePlan = {
        id: plan._id.toString(),
        planName: plan.planName,
        planTitle: plan.planTitle,
        planSubTitle: plan.planSubTitle,
        planStatus: plan.planStatus,
        allowSOS: plan.allowSOS,
        totalCredits: plan.totalCredits,
        originalPrice: plan.originalPrice,
        finalPrice: plan.finalPrice,
        totalMembers: plan.totalMembers,
        extraDiscount: plan.extraDiscount,
        expiresAt: userPlan.expiresAt
      };
    }
  }

  // Calculate SOS Eligibility
  let sosEligibility: {
    allowed: boolean;
    reason: 'PLAN' | 'FREE_QUOTA' | 'NO_PLAN';
    remainingFree?: number;
    maxFree?: number;
  } = {
    allowed: false,
    reason: 'NO_PLAN',
    remainingFree: 0,
    maxFree: 0
  };

  if (activePlan && activePlan.allowSOS) {
    sosEligibility = {
      allowed: true,
      reason: 'PLAN',
      remainingFree: 0,
      maxFree: 0
    };
  } else {
    const settings = await CustomerAppSettings.findOne();
    const maxFree = settings?.maxFreeSosCount || 0;

    if (maxFree > 0) {
      const usedCount = await SOSAlert.countDocuments({
        user: user._id,
        usedFreeQuota: true
      });
      const remaining = Math.max(0, maxFree - usedCount);
      if (remaining > 0) {
        sosEligibility = {
          allowed: true,
          reason: 'FREE_QUOTA',
          remainingFree: remaining,
          maxFree
        };
      } else {
        sosEligibility = {
          allowed: false,
          reason: 'NO_PLAN',
          remainingFree: 0,
          maxFree
        };
      }
    }
  }

  return {
    sosEligibility,
    id: user._id.toString(),
    name: user.name,
    email: user?.email || '',
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    credits: userCredits?.credits || 0,
    activePlanId: userPlan?.activePlanId || undefined,
    activePlan,
    familyMembers: mappedFamilyMembers,
    pushToken: user.pushToken,
    addresses: addresses.map(addr => ({
      id: addr.id,
      label: addr.label,
      fullAddress: addr.fullAddress,
      area: addr.area,
      coordinates: addr.coordinates ? {
        lat: addr.coordinates.lat,
        lng: addr.coordinates.lng
      } : undefined,
      isDefault: addr.isDefault
    })),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
};

/**
 * Initialize user-related records (credits and plan)
 */
export const initializeUserRecords = async (userId: string | mongoose.Types.ObjectId): Promise<void> => {
  await Promise.all([
    UserCredits.findOneAndUpdate(
      { userId },
      { credits: 0 },
      { upsert: true, new: true }
    ),
    UserPlan.findOneAndUpdate(
      { userId },
      { activePlanId: null },
      { upsert: true, new: true }
    )
  ]);
};

/**
 * Update user credits
 */
export const updateUserCredits = async (userId: string | mongoose.Types.ObjectId, credits: number): Promise<void> => {
  await UserCredits.findOneAndUpdate(
    { userId },
    { credits },
    { upsert: true, new: true }
  );
};

/**
 * Update user plan
 */
export const updateUserPlan = async (userId: string | mongoose.Types.ObjectId, activePlanId: string | null): Promise<void> => {
  await UserPlan.findOneAndUpdate(
    { userId },
    { activePlanId },
    { upsert: true, new: true }
  );
};

