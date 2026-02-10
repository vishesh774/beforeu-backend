import mongoose, { Document, Schema } from 'mongoose';
import { BookingStatus } from '../constants/bookingStatus';

export interface IHoldEntry {
  reason: string;
  customRemark?: string;
  holdStartedAt: Date;
  holdEndedAt?: Date;
  heldBy: string; // Partner name or admin name
}

// Extra charges added by service partner during a job
export interface IExtraCharge {
  id: string; // UUID for unique identification
  amount: number;
  description: string;
  status: 'pending' | 'paid' | 'cancelled';
  paymentMethod?: 'cash' | 'upi' | 'razorpay';
  razorpayOrderId?: string;
  razorpayQrId?: string; // Razorpay QR Code ID for UPI payments
  razorpayPaymentId?: string;
  addedBy: mongoose.Types.ObjectId; // ServicePartner ID
  addedByName: string; // Partner name for display
  addedAt: Date;
  paidAt?: Date;
  notes?: string;
}


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
  customerVisitRequired: boolean;
  assignedPartnerId?: mongoose.Types.ObjectId;
  assignedServiceLocationId?: mongoose.Types.ObjectId;
  paidWithCredits: boolean;
  startJobOtp?: string;
  endJobOtp?: string;
  holdHistory: IHoldEntry[];  // Track hold periods for time calculation
  extraCharges: IExtraCharge[]; // Extra charges added during job
  startedAt?: Date;  // When job started (status became in_progress)
  completedAt?: Date;  // When job completed
  status: 'pending' | 'confirmed' | 'assigned' | 'en_route' | 'reached' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled' | 'refund_initiated' | 'refunded';
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
    assignedServiceLocationId: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceLocation',
      default: null
    },
    paidWithCredits: {
      type: Boolean,
      default: false
    },
    startJobOtp: {
      type: String,
      default: null
    },
    endJobOtp: {
      type: String,
      default: null
    },
    holdHistory: {
      type: [{
        reason: { type: String, required: true },
        customRemark: { type: String },
        holdStartedAt: { type: Date, required: true },
        holdEndedAt: { type: Date },
        heldBy: { type: String, required: true }
      }],
      default: []
    },
    extraCharges: {
      type: [{
        id: { type: String, required: true },
        amount: { type: Number, required: true, min: 1 },
        description: { type: String, required: true, minlength: 3 },
        status: {
          type: String,
          enum: ['pending', 'paid', 'cancelled'],
          default: 'pending'
        },
        paymentMethod: {
          type: String,
          enum: ['cash', 'upi', 'razorpay'],
          default: null
        },
        razorpayOrderId: { type: String },
        razorpayQrId: { type: String }, // Razorpay QR Code ID
        razorpayPaymentId: { type: String },
        addedBy: { type: Schema.Types.ObjectId, ref: 'ServicePartner', required: true },
        addedByName: { type: String, required: true },
        addedAt: { type: Date, default: Date.now },
        paidAt: { type: Date },
        notes: { type: String }
      }],
      default: []
    },

    startedAt: {
      type: Date,
      default: null
    },
    completedAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: Object.values(BookingStatus),
      default: BookingStatus.PENDING,
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Generate OTPs before saving
OrderItemSchema.pre('save', async function () {
  // Only generate startJobOtp if not already set and it's not explicitly skipped
  if (!this.startJobOtp) {
    this.startJobOtp = Math.floor(1000 + Math.random() * 9000).toString();
  }
  if (!this.endJobOtp) {
    this.endJobOtp = Math.floor(1000 + Math.random() * 9000).toString();
  }
});

// Indexes
OrderItemSchema.index({ bookingId: 1 });
OrderItemSchema.index({ assignedPartnerId: 1 });
OrderItemSchema.index({ status: 1 });

const OrderItem = mongoose.model<IOrderItem>('OrderItem', OrderItemSchema);

export default OrderItem;

