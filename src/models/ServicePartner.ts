import mongoose, { Document, Schema } from 'mongoose';

export interface IAvailability {
  day: string; // 'monday', 'tuesday', etc.
  startTime: string; // HH:mm format (e.g., '09:00')
  endTime: string; // HH:mm format (e.g., '17:00')
  isAvailable: boolean;
}

export interface IServicePartner extends Document {
  name: string;
  phone: string;
  email?: string;
  pushToken?: string; // FCM device token for push notifications
  pushTokenUpdatedAt?: Date;
  services: string[]; // Array of service IDs
  serviceRegions: string[]; // Array of service region IDs
  availability: IAvailability[]; // Array of availability for each day
  isActive: boolean;
  rating: number;
  ratingCount: number;
  lastAssignedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AvailabilitySchema = new Schema({
  day: {
    type: String,
    required: true,
    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  },
  startTime: {
    type: String,
    required: true,
    match: [/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, 'Start time must be in HH:mm format']
  },
  endTime: {
    type: String,
    required: true,
    match: [/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, 'End time must be in HH:mm format']
  },
  isAvailable: {
    type: Boolean,
    default: false,
    required: true
  }
}, { _id: false });

const ServicePartnerSchema = new Schema<IServicePartner>(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    phone: {
      type: String,
      required: [true, 'Please provide a phone number'],
      trim: true,
      unique: true,
      match: [/^\+?[1-9]\d{1,14}$/, 'Please provide a valid phone number']
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address']
    },
    pushToken: {
      type: String,
      trim: true
    },
    pushTokenUpdatedAt: {
      type: Date
    },
    services: {
      type: [String],
      required: true,
      validate: {
        validator: function (services: string[]) {
          return services && services.length > 0;
        },
        message: 'At least one service must be selected'
      }
    },
    serviceRegions: {
      type: [String],
      default: []
    },
    availability: {
      type: [AvailabilitySchema],
      default: [
        { day: 'monday', startTime: '09:00', endTime: '17:00', isAvailable: false },
        { day: 'tuesday', startTime: '09:00', endTime: '17:00', isAvailable: false },
        { day: 'wednesday', startTime: '09:00', endTime: '17:00', isAvailable: false },
        { day: 'thursday', startTime: '09:00', endTime: '17:00', isAvailable: false },
        { day: 'friday', startTime: '09:00', endTime: '17:00', isAvailable: false },
        { day: 'saturday', startTime: '09:00', endTime: '17:00', isAvailable: false },
        { day: 'sunday', startTime: '09:00', endTime: '17:00', isAvailable: false }
      ]
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true
    },
    rating: {
      type: Number,
      default: 0
    },
    ratingCount: {
      type: Number,
      default: 0
    },
    lastAssignedAt: {
      type: Date
    },
  },
  {
    timestamps: true
  }
);

// Indexes for faster queries
ServicePartnerSchema.index({ phone: 1 });
ServicePartnerSchema.index({ email: 1 });
ServicePartnerSchema.index({ services: 1 });
ServicePartnerSchema.index({ serviceRegions: 1 });
ServicePartnerSchema.index({ isActive: 1 });
ServicePartnerSchema.index({ name: 'text' });

const ServicePartner = mongoose.model<IServicePartner>('ServicePartner', ServicePartnerSchema);

export default ServicePartner;

