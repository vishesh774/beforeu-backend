import User from '../models/User';
import FamilyMember from '../models/FamilyMember';
import Address from '../models/Address';
import UserCredits from '../models/UserCredits';
import UserPlan from '../models/UserPlan';
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
    isDefault: boolean;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregate user data from multiple collections
 */
export const aggregateUserData = async (userId: string | mongoose.Types.ObjectId): Promise<AggregatedUserData | null> => {
  const user = await User.findById(userId);
  if (!user) {
    return null;
  }

  // Fetch related data in parallel
  const [familyMembers, addresses, userCredits, userPlan] = await Promise.all([
    FamilyMember.find({ userId: user._id }).sort({ createdAt: 1 }),
    Address.find({ userId: user._id }).sort({ createdAt: 1 }),
    UserCredits.findOne({ userId: user._id }),
    UserPlan.findOne({ userId: user._id })
  ]);

  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    credits: userCredits?.credits || 0,
    activePlanId: userPlan?.activePlanId || undefined,
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

