import mongoose, { Document, Schema } from 'mongoose';

export interface ICoupon extends Document {
    code: string;
    description?: string;
    type: 'public' | 'restricted'; // public = FreeToUse, restricted = Assigned to phone numbers
    discountType: 'percentage'; // We only support percentage for now (including 100%)
    discountValue: number; // 0-100
    appliesTo: 'plan' | 'service';
    serviceId?: string; // Required if appliesTo === 'service'
    allowedPhoneNumbers: string[]; // Required if type === 'restricted'
    maxUses: number; // Total number of times this coupon can be used globally (or per user allocation?)
    // Request says "single use or even multi-use". 
    // Let's assume this means global limit for now, or we can interpret "activatable against a number" implies specific assignment.
    // If restricted, it's linked to numbers using allowedPhoneNumbers.
    usedCount: number;
    expiryDate?: Date;
    usedBy: Array<{
        userId: mongoose.Types.ObjectId;
        usedAt: Date;
    }>;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const CouponSchema = new Schema<ICoupon>(
    {
        code: {
            type: String,
            required: [true, 'Coupon code is required'],
            unique: true,
            trim: true,
            uppercase: true,
            minlength: [3, 'Coupon code must be at least 3 characters'],
            maxlength: [20, 'Coupon code cannot exceed 20 characters']
        },
        description: {
            type: String,
            trim: true,
            maxlength: [200, 'Description cannot exceed 200 characters']
        },
        type: {
            type: String,
            enum: ['public', 'restricted'],
            required: true,
            default: 'public'
        },
        discountType: {
            type: String,
            enum: ['percentage'],
            required: true,
            default: 'percentage'
        },
        discountValue: {
            type: Number,
            required: true,
            min: [0, 'Discount value cannot be negative'],
            max: [100, 'Discount value cannot exceed 100']
        },
        appliesTo: {
            type: String,
            enum: ['plan', 'service'],
            required: true
        },
        serviceId: {
            type: String,
            trim: true,
            required: function (this: ICoupon) { return this.appliesTo === 'service'; }
        },
        allowedPhoneNumbers: {
            type: [String],
            default: []
        },
        maxUses: {
            type: Number,
            default: -1 // -1 means unlimited
        },
        usedCount: {
            type: Number,
            default: 0
        },
        expiryDate: {
            type: Date
        },
        usedBy: [
            {
                userId: { type: Schema.Types.ObjectId, ref: 'User' },
                usedAt: { type: Date, default: Date.now }
            }
        ],
        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

// Indexes
CouponSchema.index({ code: 1 });
CouponSchema.index({ allowedPhoneNumbers: 1 });
CouponSchema.index({ type: 1 });
CouponSchema.index({ isActive: 1 });

const Coupon = mongoose.model<ICoupon>('Coupon', CouponSchema);

export default Coupon;
