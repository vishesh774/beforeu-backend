import User from '../models/User';
import FamilyMember from '../models/FamilyMember';
import Address from '../models/Address';
import UserCredits from '../models/UserCredits';
import UserPlan from '../models/UserPlan';
import Plan from '../models/Plan';
import mongoose from 'mongoose';

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
}

/**
 * Find the primary user ID if the current user is a family member of an active plan holder
 */
export const getPlanHolderId = async (userId: string | mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId> => {
  const user = await User.findById(userId);
  if (!user) {
    return new mongoose.Types.ObjectId(userId);
  }

  // Check if this user is a family member of someone who has an active plan
  // We prioritize the primary user if they have an active plan
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
 * Aggregate user data from multiple collections
 */
export const aggregateUserData = async (userId: string | mongoose.Types.ObjectId): Promise<AggregatedUserData | null> => {
  const user = await User.findById(userId);
  if (!user) {
    return null;
  }

  // Find the primary user if this user is a family member sharing a plan
  const planHolderId = await getPlanHolderId(user._id);

  // Fetch related data
  // Family members and addresses are always SPECIFIC to the user
  // Credits and Plans can be SHARED from the primary
  const [familyMembers, addresses, userCredits, userPlan] = await Promise.all([
    FamilyMember.find({ userId: user._id }).sort({ createdAt: 1 }),
    Address.find({ userId: user._id }).sort({ createdAt: 1 }),
    UserCredits.findOne({ userId: planHolderId }), // Use planHolderId for credits
    UserPlan.findOne({ userId: planHolderId })     // Use planHolderId for plan
  ]);

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

  return {
    id: user._id.toString(),
    name: user.name,
    email: user?.email || '',
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    credits: userCredits?.credits || 0,
    activePlanId: userPlan?.activePlanId || undefined,
    activePlan,
    familyMembers: familyMembers.map(fm => ({
      id: fm.id,
      name: fm.name,
      relation: fm.relation,
      phone: fm.phone,
      email: fm.email
    })),
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

