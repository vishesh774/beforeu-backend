import mongoose, { Document, Schema } from 'mongoose';

export interface IPlanService {
  serviceId: string; // Reference to Service ID
  subServiceId: string; // Reference to Service Variant/SubService ID
  subServiceName: string; // Name of the subservice for reference
  totalCountLimit?: number; // Number of times this subservice can be availed per year (undefined = unlimited)
}

export interface IPlan extends Document {
  planName: string;
  planTitle: string;
  planSubTitle: string;
  planStatus: 'active' | 'inactive';
  allowSOS: boolean;
  totalCredits: number;
  services: IPlanService[];
  originalPrice: number;
  finalPrice: number;
  totalMembers: number;
  extraDiscount?: number; // Optional discount percentage (0-100)
  createdAt: Date;
  updatedAt: Date;
}

const PlanServiceSchema = new Schema<IPlanService>({
  serviceId: {
    type: String,
    required: true,
    trim: true
  },
  subServiceId: {
    type: String,
    required: true,
    trim: true
  },
  subServiceName: {
    type: String,
    required: true,
    trim: true
  },
  totalCountLimit: {
    type: Number,
    required: false,
    min: 0
  }
}, { _id: false });

const PlanSchema = new Schema<IPlan>(
  {
    planName: {
      type: String,
      required: [true, 'Plan name is required'],
      trim: true,
      maxlength: [100, 'Plan name cannot exceed 100 characters']
    },
    planTitle: {
      type: String,
      required: [true, 'Plan title is required'],
      trim: true,
      maxlength: [200, 'Plan title cannot exceed 200 characters']
    },
    planSubTitle: {
      type: String,
      required: [true, 'Plan subtitle is required'],
      trim: true,
      maxlength: [300, 'Plan subtitle cannot exceed 300 characters']
    },
    planStatus: {
      type: String,
      enum: ['active', 'inactive'],
      required: true,
      default: 'active'
    },
    allowSOS: {
      type: Boolean,
      required: true,
      default: false
    },
    totalCredits: {
      type: Number,
      required: [true, 'Total credits is required'],
      min: [0, 'Total credits cannot be negative'],
      default: 0
    },
    services: {
      type: [PlanServiceSchema],
      required: true,
      default: [],
      validate: {
        validator: function(services: IPlanService[]) {
          // Check for duplicate subServiceIds
          const subServiceIds = services.map(s => s.subServiceId);
          return new Set(subServiceIds).size === subServiceIds.length;
        },
        message: 'Each sub-service can only be added once to a plan'
      }
    },
    originalPrice: {
      type: Number,
      required: [true, 'Original price is required'],
      min: [0, 'Original price cannot be negative']
    },
    finalPrice: {
      type: Number,
      required: [true, 'Final price is required'],
      min: [0, 'Final price cannot be negative']
    },
    totalMembers: {
      type: Number,
      required: [true, 'Total members is required'],
      min: [1, 'Total members must be at least 1']
    },
    extraDiscount: {
      type: Number,
      required: false,
      min: [0, 'Extra discount cannot be negative'],
      max: [100, 'Extra discount cannot exceed 100']
    }
  },
  {
    timestamps: true
  }
);

// Indexes
PlanSchema.index({ planStatus: 1 });
PlanSchema.index({ planName: 1 });

const Plan = mongoose.model<IPlan>('Plan', PlanSchema);

export default Plan;

