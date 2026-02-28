import mongoose, { Document, Schema } from 'mongoose';

export interface IReferralConfig extends Document {
    referrerCouponId: mongoose.Types.ObjectId;
    refereeCouponId: mongoose.Types.ObjectId;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ReferralConfigSchema = new Schema<IReferralConfig>(
    {
        referrerCouponId: {
            type: Schema.Types.ObjectId,
            ref: 'Coupon',
            required: true
        },
        refereeCouponId: {
            type: Schema.Types.ObjectId,
            ref: 'Coupon',
            required: true
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

const ReferralConfig = mongoose.model<IReferralConfig>('ReferralConfig', ReferralConfigSchema);

export default ReferralConfig;
