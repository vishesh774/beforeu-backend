import mongoose, { Document, Schema } from 'mongoose';
import { BookingStatus } from '../constants/bookingStatus';

export interface IBooking extends Document {
  userId: mongoose.Types.ObjectId;
  bookingId: string; // Custom ID for frontend reference (e.g., 'BOOK-20240101-001')
  addressId: string; // Reference to user's address ID
  address: {
    label: string;
    fullAddress: string;
    area?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  bookingType: 'ASAP' | 'SCHEDULED' | 'SOS' | 'PLAN_PURCHASE';
  scheduledDate?: Date;
  scheduledTime?: string;
  totalAmount: number; // Final amount paid (includes all checkout fields)
  totalOriginalAmount: number; // Before discounts
  itemTotal: number; // Sum of item prices before checkout fields
  creditsUsed: number;
  paymentBreakdown?: Array<{
    fieldName: string;
    fieldDisplayName: string;
    chargeType: 'fixed' | 'percentage';
    value: number;
    amount: number;
  }>; // Breakdown of checkout fields applied
  rescheduleCount: number;
  refundAmount: number;
  cancellationReason?: string;
  actionLog: Array<{
    action: string;
    performedBy: string;
    timestamp: Date;
    details?: string;
  }>;
  status: 'pending' | 'confirmed' | 'assigned' | 'en_route' | 'reached' | 'in_progress' | 'completed' | 'cancelled' | 'refund_initiated' | 'refunded';
  paymentStatus: 'pending' | 'paid' | 'refunded';
  paymentId?: string; // Razorpay payment ID
  orderId?: string; // Razorpay order ID
  paymentDetails?: any; // Raw Razorpay response object
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BookingSchema = new Schema<IBooking>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    bookingId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    addressId: {
      type: String,
      required: true
    },
    address: {
      label: {
        type: String,
        required: true
      },
      fullAddress: {
        type: String,
        required: true
      },
      area: {
        type: String,
        default: undefined
      },
      coordinates: {
        lat: { type: Number },
        lng: { type: Number }
      }
    },
    bookingType: {
      type: String,
      enum: ['ASAP', 'SCHEDULED', 'SOS', 'PLAN_PURCHASE'],
      required: true
    },
    scheduledDate: {
      type: Date,
      required: function (this: IBooking) {
        return this.bookingType === 'SCHEDULED';
      }
    },
    scheduledTime: {
      type: String,
      required: function (this: IBooking) {
        return this.bookingType === 'SCHEDULED';
      }
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0
    },
    totalOriginalAmount: {
      type: Number,
      required: true,
      min: 0
    },
    itemTotal: {
      type: Number,
      required: true,
      min: 0
    },
    creditsUsed: {
      type: Number,
      default: 0,
      min: 0
    },
    paymentBreakdown: {
      type: [{
        fieldName: { type: String, required: true },
        fieldDisplayName: { type: String, required: true },
        chargeType: { type: String, enum: ['fixed', 'percentage'], required: true },
        value: { type: Number, required: true },
        amount: { type: Number, required: true }
      }],
      default: undefined
    },
    rescheduleCount: {
      type: Number,
      default: 0
    },
    refundAmount: {
      type: Number,
      default: 0
    },
    cancellationReason: {
      type: String,
      trim: true
    },
    actionLog: {
      type: [{
        action: { type: String, required: true },
        performedBy: { type: String, required: true }, // Username or 'System' or 'User'
        timestamp: { type: Date, default: Date.now },
        details: { type: String }
      }],
      default: []
    },


    // ...

    status: {
      type: String,
      enum: Object.values(BookingStatus),
      default: BookingStatus.PENDING,
      required: true
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'refunded'],
      default: 'pending',
      required: true
    },
    paymentId: {
      type: String,
      trim: true
    },
    orderId: {
      type: String,
      trim: true
    },
    paymentDetails: {
      type: Schema.Types.Mixed, // Store raw Razorpay response
      default: {}
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters']
    }
  },
  {
    timestamps: true
  }
);

// Indexes
BookingSchema.index({ userId: 1 });
BookingSchema.index({ bookingId: 1 });
BookingSchema.index({ status: 1 });
BookingSchema.index({ createdAt: -1 });
BookingSchema.index({ userId: 1, status: 1 });

// Generate booking ID before saving
BookingSchema.pre('save', async function () {
  if (!this.bookingId) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');

    // Count bookings with today's date pattern in bookingId
    // This works even for new documents since we're querying by bookingId pattern
    const count = await mongoose.model('Booking').countDocuments({
      bookingId: {
        $regex: new RegExp(`^BOOK-${dateStr}-`)
      }
    });
    this.bookingId = `BOOK-${dateStr}-${String(count + 1).padStart(3, '0')}`;
  }
});

const Booking = mongoose.model<IBooking>('Booking', BookingSchema);

export default Booking;

