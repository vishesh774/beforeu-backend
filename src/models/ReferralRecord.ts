import mongoose, { Document, Schema } from 'mongoose';

export interface IReferralRecord extends Document {
    referrerId: mongoose.Types.ObjectId; // User who referred (plan holder)
    refereeId: mongoose.Types.ObjectId; // New user who signed up
    referralCode: string;
    status: 'joined' | 'purchased' | 'rewarded';
    purchaseId?: mongoose.Types.ObjectId; // Transaction ID
    rewardedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ReferralRecordSchema = new Schema<IReferralRecord>(
    {
        referrerId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        refereeId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true, // A user can only be referred once
            index: true
        },
        referralCode: {
            type: String,
            required: true,
            index: true
        },
        status: {
            type: String,
            enum: ['joined', 'purchased', 'rewarded'],
            default: 'joined',
            required: true
        },
        purchaseId: {
            type: Schema.Types.ObjectId,
            ref: 'PlanTransaction'
        },
        rewardedAt: {
            type: Date
        }
    },
    {
        timestamps: true
    }
);

const ReferralRecord = mongoose.model<IReferralRecord>('ReferralRecord', ReferralRecordSchema);

export default ReferralRecord;
