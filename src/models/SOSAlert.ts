import mongoose, { Schema, Document } from 'mongoose';

export enum SOSStatus {
    TRIGGERED = 'TRIGGERED',
    ACKNOWLEDGED = 'ACKNOWLEDGED',
    RESOLVED = 'RESOLVED',
    CANCELLED = 'CANCELLED'
}

export interface ISOSLog {
    action: string; // 'TRIGGERED', 'ACKNOWLEDGED', 'PARTNER_ASSIGNED', 'RESOLVED', 'CANCELLED'
    timestamp: Date;
    performedBy?: mongoose.Types.ObjectId; // Admin ID or Customer ID
    details?: string;
}

export interface ISOSAlert extends Document {
    user: mongoose.Types.ObjectId;
    sosId: string;
    location: {
        latitude: number;
        longitude: number;
        address?: string;
        emergencyType?: string;
    };
    partnerLocation?: {
        latitude: number;
        longitude: number;
        updatedAt?: Date;
    };
    familyMemberId?: mongoose.Types.ObjectId;
    serviceId?: mongoose.Types.ObjectId; // E.g., Booking ID or OrderItem ID
    bookingId?: mongoose.Types.ObjectId;
    status: SOSStatus;
    otp: string;
    createdAt: Date;
    updatedAt: Date;
    resolvedAt?: Date;
    resolvedBy?: mongoose.Types.ObjectId;
    logs: ISOSLog[];
}

const SOSLogSchema = new Schema({
    action: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    details: { type: String }
}, { _id: false });

const SOSAlertSchema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sosId: { type: String, required: true, unique: true },
    location: {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
        address: { type: String },
        emergencyType: { type: String }
    },
    partnerLocation: {
        latitude: { type: Number },
        longitude: { type: Number },
        updatedAt: { type: Date }
    },
    familyMemberId: { type: Schema.Types.ObjectId, ref: 'FamilyMember' },
    serviceId: { type: Schema.Types.ObjectId, ref: 'OrderItem' }, // Or Booking
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    status: {
        type: String,
        enum: Object.values(SOSStatus),
        default: SOSStatus.TRIGGERED
    },
    otp: { type: String, required: true },
    resolvedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    usedFreeQuota: { type: Boolean, default: false },
    logs: [SOSLogSchema]
}, {
    timestamps: true
});

// Index for active alerts query
SOSAlertSchema.index({ status: 1, createdAt: -1 });

export const SOSAlert = mongoose.model<ISOSAlert>('SOSAlert', SOSAlertSchema);
