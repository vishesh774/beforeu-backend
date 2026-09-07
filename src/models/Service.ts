import mongoose, { Document, Schema } from 'mongoose';

export interface IService extends Document {
  id: string; // Custom ID field (e.g., 'police-consult', 'home-maintenance')
  name: string;
  icon: string; // LucideReact icon name (e.g., 'Shield', 'Wrench')
  description: string;
  highlight: string;
  rating: number;
  ratingCount: number;
  isActive: boolean;
  /**
   * Who actually delivers the service.
   *
   * `in_house` (default) = fulfilled by a BeforeU service partner, so a booking needs an available
   * partner in the region. `third_party` = delivered by an external provider (a diagnostics lab,
   * an eye-care chain), so bookings are accepted regardless of partner availability and no partner
   * is auto-assigned. Ops coordinates those out of band.
   */
  fulfilmentType: 'in_house' | 'third_party';
  serviceRegions: string[]; // Array of service region IDs
  tags: string[]; // Array of service-level tags
  createdAt: Date;
  updatedAt: Date;
}

const ServiceSchema = new Schema<IService>(
  {
    id: {
      type: String,
      required: [true, 'Please provide a service ID'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9-]+$/, 'Service ID must contain only lowercase letters, numbers, and hyphens']
    },
    name: {
      type: String,
      required: [true, 'Please provide a service name'],
      trim: true,
      minlength: [2, 'Service name must be at least 2 characters'],
      maxlength: [100, 'Service name cannot exceed 100 characters']
    },
    icon: {
      type: String,
      required: [true, 'Please provide an icon name'],
      trim: true
    },
    description: {
      type: String,
      required: false,
      trim: true,
      default: '',
      maxlength: [200, 'Service description cannot exceed 200 characters']
    },
    highlight: {
      type: String,
      required: false,
      trim: true,
      default: '',
      maxlength: [100, 'Service highlight cannot exceed 100 characters']
    },
    rating: {
      type: Number,
      default: 0
    },
    ratingCount: {
      type: Number,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true
    },
    // Defaults keep every existing service in-house — behaviour is unchanged until ops opts one in.
    fulfilmentType: {
      type: String,
      enum: ['in_house', 'third_party'],
      default: 'in_house',
      required: true
    },
    serviceRegions: {
      type: [String],
      default: [],
      validate: {
        validator: function (regions: string[]) {
          return regions.every(region => typeof region === 'string' && region.trim().length > 0);
        },
        message: 'All service region IDs must be non-empty strings'
      }
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: function (tags: string[]) {
          return tags.every(tag => typeof tag === 'string' && tag.trim().length > 0);
        },
        message: 'All tags must be non-empty strings'
      }
    }
  },
  {
    timestamps: true
  }
);

// Index for faster queries
ServiceSchema.index({ id: 1 });
ServiceSchema.index({ name: 'text' });

const Service = mongoose.model<IService>('Service', ServiceSchema);

export default Service;

