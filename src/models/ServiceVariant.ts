import mongoose, { Document, Schema } from 'mongoose';

export interface IServiceVariant extends Document {
  serviceId: mongoose.Types.ObjectId;
  id: string; // Custom ID field (e.g., 'police-consult-basic', 'police-consult-premium')
  name: string;
  description: string;
  icon?: string; // Optional icon name
  inclusions?: string[]; // Included points (optional)
  exclusions?: string[]; // Excluded points (optional)
  originalPrice: number;
  finalPrice: number;
  estimatedTimeMinutes: number; // Estimated time to complete job in minutes
  includedInSubscription: boolean;
  creditValue: number; // Value in credits
  serviceType: 'Virtual' | 'In-Person'; // Service delivery type
  availableForPurchase: boolean; // Whether this variant can be purchased
  extraTimeSlabs: number; // Extra time slabs in minutes (15 min increments)
  extraCharges: number; // Extra charges for additional time
  tags: string[]; // Array of tags
  customerVisitRequired: boolean; // Whether customer visit is required for this service
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceVariantSchema = new Schema<IServiceVariant>(
  {
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
      index: true
    },
    id: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: [true, 'Please provide a variant name'],
      trim: true,
      minlength: [2, 'Variant name must be at least 2 characters'],
      maxlength: [100, 'Variant name cannot exceed 100 characters']
    },
    description: {
      type: String,
      required: [true, 'Please provide a description'],
      trim: true,
      maxlength: [300, 'Description cannot exceed 300 characters']
    },
    icon: {
      type: Schema.Types.Mixed,
      required: false,
      default: undefined,
      set: (value: string | null | undefined) => {
        // Allow null, undefined, or empty string - return undefined to omit field
        if (value === null || value === undefined) {
          return undefined;
        }
        const trimmed = String(value).trim();
        return trimmed === '' ? undefined : trimmed;
      }
    },
    inclusions: {
      type: [String],
      default: [],
      required: false,
      validate: {
        validator: function(items: string[]) {
          return items.every(item => typeof item === 'string' && item.trim().length > 0);
        },
        message: 'All inclusions must be non-empty strings'
      }
    },
    exclusions: {
      type: [String],
      default: [],
      required: false,
      validate: {
        validator: function(items: string[]) {
          return items.every(item => typeof item === 'string' && item.trim().length > 0);
        },
        message: 'All exclusions must be non-empty strings'
      }
    },
    originalPrice: {
      type: Number,
      required: [true, 'Please provide an original price'],
      min: 0
    },
    finalPrice: {
      type: Number,
      required: [true, 'Please provide a final price'],
      min: 0
    },
    estimatedTimeMinutes: {
      type: Number,
      required: [true, 'Please provide estimated time'],
      min: 1
    },
    includedInSubscription: {
      type: Boolean,
      default: false,
      required: true
    },
    creditValue: {
      type: Number,
      required: true,
      min: 0
    },
    serviceType: {
      type: String,
      enum: ['Virtual', 'In-Person'],
      required: [true, 'Service type is required'],
      default: 'In-Person'
    },
    availableForPurchase: {
      type: Boolean,
      default: true,
      required: true
    },
    extraTimeSlabs: {
      type: Number,
      required: false,
      min: 0,
      default: 0
    },
    extraCharges: {
      type: Number,
      required: false,
      min: 0,
      default: 0
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: function(tags: string[]) {
          return tags.every(tag => typeof tag === 'string' && tag.trim().length > 0);
        },
        message: 'All tags must be non-empty strings'
      }
    },
    customerVisitRequired: {
      type: Boolean,
      default: false,
      required: true
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes
ServiceVariantSchema.index({ serviceId: 1, id: 1 }, { unique: true });
ServiceVariantSchema.index({ serviceId: 1 });
ServiceVariantSchema.index({ serviceId: 1, isActive: 1 });
ServiceVariantSchema.index({ name: 'text', description: 'text', tags: 'text' });

const ServiceVariant = mongoose.model<IServiceVariant>('ServiceVariant', ServiceVariantSchema);

export default ServiceVariant;

