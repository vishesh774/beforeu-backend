import mongoose, { Document, Schema } from 'mongoose';

export interface IScheduledNotification extends Document {
    type: string; // e.g., 'whatsapp'
    template: string; // e.g., 'add_family_member'
    payload: any; // Flexible payload for template variables
    scheduledAt: Date;
    status: 'pending' | 'sent' | 'failed';
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
}

const ScheduledNotificationSchema = new Schema<IScheduledNotification>(
    {
        type: {
            type: String,
            required: true,
            default: 'whatsapp'
        },
        template: {
            type: String,
            required: true
        },
        payload: {
            type: Schema.Types.Mixed,
            required: true
        },
        scheduledAt: {
            type: Date,
            required: true,
            index: true
        },
        status: {
            type: String,
            enum: ['pending', 'sent', 'failed'],
            default: 'pending',
            index: true
        },
        errorMessage: {
            type: String
        }
    },
    {
        timestamps: true
    }
);

export default mongoose.model<IScheduledNotification>('ScheduledNotification', ScheduledNotificationSchema);
