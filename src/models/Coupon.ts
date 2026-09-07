import mongoose, { Document, Schema } from 'mongoose';

export interface ICoupon extends Document {
    code: string;
    description?: string;
    type: 'public' | 'restricted'; // public = FreeToUse, restricted = Assigned to phone numbers
    discountType: 'percentage' | 'fixed'; // percentage = 0-100, fixed = flat rupee amount
    discountValue: number; // 0-100 when percentage, a rupee amount when fixed
    appliesTo: 'plan' | 'service';
    /**
     * Services this coupon applies to. Empty means "every service".
     * `serviceId` is the legacy single-service field, kept so existing coupons keep working;
     * read through getCouponServiceIds() rather than either field directly.
     */
    serviceIds: string[];
    serviceId?: string;
    allowedPhoneNumbers: Array<{
        phone: string;
        expiryDate?: Date;
    } | string>; // Required if type === 'restricted'
    maxUses: number; // Total number of times this coupon can be used globally
    usedCount: number;
    expiryDate?: Date; // This acts as the "Current/Default" expiry for new numbers
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
            enum: ['percentage', 'fixed'],
            required: true,
            default: 'percentage'
        },
        discountValue: {
            type: Number,
            required: true,
            min: [0, 'Discount value cannot be negative'],
            validate: {
                validator: function (this: unknown, value: number) {
                    // A percentage is capped at 100; a fixed rupee amount is not.
                    const doc = this as { discountType?: string } | null;
                    return doc?.discountType !== 'percentage' || value <= 100;
                },
                message: 'Percentage discount cannot exceed 100'
            }
        },
        appliesTo: {
            type: String,
            enum: ['plan', 'service'],
            required: true
        },
        // Empty array = applies to every service. One coupon can now cover several services
        // (e.g. a single code for electrician + plumber + carpenter).
        serviceIds: {
            type: [String],
            default: []
        },
        // Legacy single-service field. New writes populate serviceIds; this stays for old documents.
        serviceId: {
            type: String,
            trim: true
        },
        allowedPhoneNumbers: {
            type: [Schema.Types.Mixed],
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
