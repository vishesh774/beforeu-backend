import mongoose, { Document, Schema } from 'mongoose';

export interface ICheckoutField extends Document {
  fieldName: string; // Unique identifier (e.g., 'tax', 'service_charge', 'discount')
  fieldDisplayName: string; // Display name (e.g., 'GST (18%)', 'Service Charge', 'Discount')
  chargeType: 'fixed' | 'percentage'; // Type of charge
  value: number; // Value (if fixed: amount in rupees, if percentage: percentage value)
  isActive: boolean; // Whether this field is active
  order: number; // Order for display
  createdAt: Date;
  updatedAt: Date;
}

const CheckoutFieldSchema = new Schema<ICheckoutField>(
  {
    fieldName: {
      type: String,
      required: [true, 'Field name is required'],
      trim: true,
      unique: true,
      lowercase: true,
      maxlength: [50, 'Field name cannot exceed 50 characters']
    },
    fieldDisplayName: {
      type: String,
      required: [true, 'Field display name is required'],
      trim: true,
      maxlength: [100, 'Field display name cannot exceed 100 characters']
    },
    chargeType: {
      type: String,
      enum: ['fixed', 'percentage'],
      required: [true, 'Charge type is required']
    },
    value: {
      type: Number,
      required: [true, 'Value is required'],
      min: [0, 'Value cannot be negative']
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true
    },
    order: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Order cannot be negative']
    }
  },
  {
    timestamps: true
  }
);

// Indexes
CheckoutFieldSchema.index({ isActive: 1 });
CheckoutFieldSchema.index({ order: 1 });
CheckoutFieldSchema.index({ fieldName: 1 }, { unique: true });

const CheckoutField = mongoose.model<ICheckoutField>('CheckoutField', CheckoutFieldSchema);

export default CheckoutField;

