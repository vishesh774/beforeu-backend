import mongoose, { Document, Schema } from 'mongoose';

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
  bookingType: 'ASAP' | 'SCHEDULED';
  scheduledDate?: Date;
  scheduledTime?: string;
  totalAmount: number;
  totalOriginalAmount: number; // Before discounts
  creditsUsed: number;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'refund_initiated'
  paymentStatus: 'pending' | 'paid' | 'refunded';
  paymentId?: string; // Razorpay payment ID
  orderId?: string; // Razorpay order ID
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
      enum: ['ASAP', 'SCHEDULED'],
      required: true
    },
    scheduledDate: {
      type: Date,
      required: function(this: IBooking) {
        return this.bookingType === 'SCHEDULED';
      }
    },
    scheduledTime: {
      type: String,
      required: function(this: IBooking) {
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
    creditsUsed: {
      type: Number,
      default: 0,
      min: 0
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'refund_initiated'],
      default: 'pending',
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
BookingSchema.pre('save', async function() {
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

