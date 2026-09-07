import mongoose from 'mongoose';
import User from '../models/User';
import Address from '../models/Address';
import FamilyMember from '../models/FamilyMember';
import UserPlan from '../models/UserPlan';
import UserCredits from '../models/UserCredits';

/**
 * Account deletion with a retention window.
 *
 * Deletion used to be immediate and irreversible: addresses, family members, plan and credits were
 * destroyed and the user row anonymised in a single request. That leaves no room for a mis-tap, no
 * win-back window, and no way to answer a billing question after the fact.
 *
 * The flow is now two-step:
 *   1. `requestAccountDeletion` marks the account and deactivates it. Nothing is destroyed.
 *   2. After ACCOUNT_DELETION_RETENTION_DAYS the scheduler calls `purgeAccount`, which does the
 *      irreversible part.
 * The customer can cancel any time before step 2.
 */

/** Retention window in days. Override with ACCOUNT_DELETION_RETENTION_DAYS. */
export const getRetentionDays = (): number => {
    const configured = parseInt(process.env.ACCOUNT_DELETION_RETENTION_DAYS || '', 10);
    return Number.isFinite(configured) && configured > 0 ? configured : 30;
};

/**
 * Irreversibly anonymise an account and drop its personal records.
 *
 * The phone/email are prefixed rather than nulled so the unique indexes stay satisfied and the
 * customer can sign up again with the same number. `runValidators: false` is required because the
 * anonymised phone no longer matches the model's regex.
 */
export const purgeAccount = async (userId: mongoose.Types.ObjectId): Promise<void> => {
    const user = await User.findById(userId);
    if (!user) {
        return;
    }

    await Promise.all([
        Address.deleteMany({ userId }),
        FamilyMember.deleteMany({ userId }),
        UserPlan.deleteMany({ userId }),
        UserCredits.deleteMany({ userId })
    ]);

    const timestamp = Date.now();

    await User.findByIdAndUpdate(userId, {
        isActive: false,
        isDeleted: true,
        phone: `deleted_${timestamp}_${user.phone}`,
        email: user.email ? `deleted_${timestamp}_${user.email}` : undefined,
        name: `Deleted User ${timestamp}`,
        // Clear the schedule so a re-run can't pick the row up again.
        deletionScheduledFor: undefined
    }, { runValidators: false });

    console.log(`[AccountDeletion] Purged account ${userId.toString()}`);
};

/**
 * Purge every account whose retention window has elapsed. Called by the scheduler.
 * Returns the number of accounts purged.
 */
export const purgeExpiredAccounts = async (now: Date = new Date()): Promise<number> => {
    const due = await User.find({
        isDeleted: false,
        deletionScheduledFor: { $ne: null, $lte: now }
    }).select('_id').limit(100);

    for (const user of due) {
        try {
            await purgeAccount(user._id);
        } catch (error) {
            console.error(`[AccountDeletion] Failed to purge ${user._id.toString()}:`, error);
        }
    }

    return due.length;
};
