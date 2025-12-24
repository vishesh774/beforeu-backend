import mongoose, { Document, Schema } from 'mongoose';

export interface IAppConfig extends Document {
    bookingStartDate?: Date; // Global start date for booking slots
    dayStartTime: string; // HH:mm format, e.g., "09:00"
    dayEndTime: string; // HH:mm format, e.g., "17:00"
    slotDuration: number; // in minutes, default 60
    bookingWindowDays: number; // default 7
    latestVersion?: number;
    minSupportedVersion?: number;
    createdAt: Date;
    updatedAt: Date;
}

const AppConfigSchema = new Schema<IAppConfig>(
    {
        bookingStartDate: {
            type: Date,
            default: null
        },
        dayStartTime: {
            type: String,
            default: "09:00"
        },
        dayEndTime: {
            type: String,
            default: "17:00"
        },
        slotDuration: {
            type: Number,
            default: 60
        },
        bookingWindowDays: {
            type: Number,
            default: 7
        },
        latestVersion: {
            type: Number,
            default: 1
        },
        minSupportedVersion: {
            type: Number,
            default: 1
        }
    },
    {
        timestamps: true
    }
);

const AppConfig = mongoose.model<IAppConfig>('AppConfig', AppConfigSchema);

export default AppConfig;
