import mongoose, { Document, Schema } from 'mongoose';

export interface IHealthPartner extends Document {
    name: string;
    logo: string; // Base64 encoded logo
    isActive: boolean;
    order: number;
    createdAt: Date;
    updatedAt: Date;
}

const HealthPartnerSchema = new Schema<IHealthPartner>(
    {
        name: {
            type: String,
            required: [true, 'Partner name is required'],
            trim: true
        },
        logo: {
            type: String,
            required: [true, 'Logo is required']
        },
        isActive: {
            type: Boolean,
            default: true
        },
        order: {
            type: Number,
            default: 0
        }
    },
    {
        timestamps: true
    }
);

// Indexes
HealthPartnerSchema.index({ isActive: 1, order: 1 });

const HealthPartner = mongoose.model<IHealthPartner>('HealthPartner', HealthPartnerSchema);

export default HealthPartner;
