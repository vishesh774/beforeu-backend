import mongoose, { Document, Schema } from 'mongoose';

export interface ICustomerAppSettings extends Document {
    maxFreeSosCount: number;
    createdAt: Date;
    updatedAt: Date;
}

const CustomerAppSettingsSchema = new Schema<ICustomerAppSettings>(
    {
        maxFreeSosCount: {
            type: Number,
            required: true,
            default: 0
        }
    },
    {
        timestamps: true
    }
);

const CustomerAppSettings = mongoose.model<ICustomerAppSettings>('CustomerAppSettings', CustomerAppSettingsSchema);

export default CustomerAppSettings;
