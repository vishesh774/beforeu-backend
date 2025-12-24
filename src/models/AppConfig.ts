import mongoose, { Document, Schema } from 'mongoose';

export interface IAppConfig extends Document {
    bookingStartDate?: Date; // Global start date for booking slots
    createdAt: Date;
    updatedAt: Date;
}

const AppConfigSchema = new Schema<IAppConfig>(
    {
        bookingStartDate: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

const AppConfig = mongoose.model<IAppConfig>('AppConfig', AppConfigSchema);

export default AppConfig;
