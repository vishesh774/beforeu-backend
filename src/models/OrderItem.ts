import mongoose, { Document, Schema } from 'mongoose';

export interface IOrderItem extends Document {
  bookingId: mongoose.Types.ObjectId;
  serviceId: mongoose.Types.ObjectId;
  serviceVariantId: mongoose.Types.ObjectId;
  serviceName: string;
  variantName: string;
  quantity: number;
  originalPrice: number;
  finalPrice: number;
  creditValue: number;
  estimatedTimeMinutes: number;
  customerVisitRequired: boolean; // Whether customer visit is required for this service variant
  assignedPartnerId?: mongoose.Types.ObjectId; // Service partner assigned to this item
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true
    },
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: 'Service',
      required: true
    },
    serviceVariantId: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceVariant',
      required: true
    },
    serviceName: {
      type: String,
      required: true,
      trim: true
    },
    variantName: {
      type: String,
      required: true,
      trim: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 10
    },
    originalPrice: {
      type: Number,
      required: true,
      min: 0
    },
    finalPrice: {
      type: Number,
      required: true,
      min: 0
    },
    creditValue: {
      type: Number,
      required: true,
      min: 0
    },
    estimatedTimeMinutes: {
      type: Number,
      required: true,
      min: 1
    },
    customerVisitRequired: {
      type: Boolean,
      default: false,
      required: true
    },
    assignedPartnerId: {
      type: Schema.Types.ObjectId,
      ref: 'ServicePartner',
      default: null
    },
    status: {
      type: String,
      enum: ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'],
      default: 'pending',
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes
OrderItemSchema.index({ bookingId: 1 });
OrderItemSchema.index({ assignedPartnerId: 1 });
OrderItemSchema.index({ status: 1 });

const OrderItem = mongoose.model<IOrderItem>('OrderItem', OrderItemSchema);

export default OrderItem;

