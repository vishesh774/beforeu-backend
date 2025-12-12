import mongoose, { Document, Schema } from 'mongoose';

export interface IWorkingHours {
    day: string;
    startTime: string; // HH:mm
    endTime: string;   // HH:mm
    isOpen: boolean;
}

export interface IServiceLocation extends Document {
    name: string;
    contactNumber: string;
    contactPerson?: string;
    address: {
        street: string;
        city: string;
        state: string;
        zip: string;
        coordinates: {
            lat: number;
            lng: number;
        };
    };
    workingHours: IWorkingHours[];
    services: {
        serviceId: string;
        subServiceIds: string[];
    }[];
    tags: string[];
    remarks?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const WorkingHoursSchema = new Schema({
    day: {
        type: String,
        required: true,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    },
    startTime: { type: String, default: '09:00' },
    endTime: { type: String, default: '17:00' },
    isOpen: { type: Boolean, default: true }
}, { _id: false });

const ServiceLocationSchema = new Schema<IServiceLocation>(
    {
        name: {
            type: String,
            required: [true, 'Please provide a location name'],
            trim: true
        },
        contactNumber: {
            type: String,
            required: [true, 'Please provide a contact number'],
            trim: true
        },
        contactPerson: {
            type: String,
            trim: true
        },
        address: {
            street: { type: String, required: true },
            city: { type: String, required: true },
            state: { type: String, required: true },
            zip: { type: String, required: true },
            coordinates: {
                lat: { type: Number, required: true },
                lng: { type: Number, required: true }
            }
        },
        workingHours: {
            type: [WorkingHoursSchema],
            default: []
        },
        services: [{
            serviceId: { type: String, required: true },
            subServiceIds: [{ type: String }]
        }],
        tags: [{ type: String }],
        remarks: { type: String },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

// Indexes
ServiceLocationSchema.index({ 'address.city': 1 });
ServiceLocationSchema.index({ isActive: 1 });
ServiceLocationSchema.index({ tags: 1 });

const ServiceLocation = mongoose.model<IServiceLocation>('ServiceLocation', ServiceLocationSchema);

export default ServiceLocation;
