import mongoose, { Document, Schema } from 'mongoose';

export interface IAddress extends Document {
  userId: mongoose.Types.ObjectId;
  id: string; // Custom ID for frontend reference
  label: string;
  fullAddress: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AddressSchema = new Schema<IAddress>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    id: {
      type: String,
      required: true
    },
    label: {
      type: String,
      required: [true, 'Please provide a label'],
      trim: true,
      minlength: [2, 'Label must be at least 2 characters'],
      maxlength: [50, 'Label cannot exceed 50 characters']
    },
    fullAddress: {
      type: String,
      required: [true, 'Please provide a full address'],
      trim: true
    },
    isDefault: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

// Indexes
AddressSchema.index({ userId: 1, id: 1 }, { unique: true });
AddressSchema.index({ userId: 1 });
AddressSchema.index({ userId: 1, isDefault: 1 });

const Address = mongoose.model<IAddress>('Address', AddressSchema);

export default Address;

