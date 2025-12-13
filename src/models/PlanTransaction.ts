import mongoose, { Document, Schema } from 'mongoose';

export interface IPlanTransaction extends Document {
    userId: mongoose.Types.ObjectId;
    planId: mongoose.Types.ObjectId;
    orderId: string;
    amount: number;
    credits: number;
    planSnapshot: {
        name: string;
        originalPrice: number;
        finalPrice: number;
    };
    status: 'pending' | 'completed' | 'failed';
    paymentId?: string;
    paymentDetails?: any;
    paymentBreakdown?: any[];
    transactionId: string;
    createdAt: Date;
    updatedAt: Date;
}

const PlanTransactionSchema = new Schema<IPlanTransaction>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        planId: {
            type: Schema.Types.ObjectId,
            ref: 'Plan',
            required: true
        },
        orderId: {
            type: String,
            required: true,
            unique: true
        },
        transactionId: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        credits: {
            type: Number,
            required: true,
            min: 0
        },
        planSnapshot: {
            name: { type: String, required: true },
            originalPrice: { type: Number, required: true },
            finalPrice: { type: Number, required: true }
        },
        status: {
            type: String,
            enum: ['pending', 'completed', 'failed'],
            default: 'pending'
        },
        paymentId: {
            type: String
        },
        paymentDetails: {
            type: Schema.Types.Mixed
        },
        paymentBreakdown: {
            type: [Schema.Types.Mixed]
        }
    },
    {
        timestamps: true
    }
);

// Index for getting user's transactions
PlanTransactionSchema.index({ userId: 1, createdAt: -1 });
PlanTransactionSchema.index({ transactionId: 1 });

// Generate transaction ID before saving
PlanTransactionSchema.pre('save', async function () {
    if (!this.transactionId) {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');

        // Count transactions with today's date pattern in transactionId
        const count = await mongoose.model('PlanTransaction').countDocuments({
            transactionId: {
                $regex: new RegExp(`^PTX-${dateStr}-`)
            }
        });
        this.transactionId = `PTX-${dateStr}-${String(count + 1).padStart(3, '0')}`;
    }
});

const PlanTransaction = mongoose.model<IPlanTransaction>('PlanTransaction', PlanTransactionSchema);

export default PlanTransaction;
