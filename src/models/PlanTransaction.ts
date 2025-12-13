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
        }
    },
    {
        timestamps: true
    }
);

// Index for getting user's transactions
PlanTransactionSchema.index({ userId: 1, createdAt: -1 });

const PlanTransaction = mongoose.model<IPlanTransaction>('PlanTransaction', PlanTransactionSchema);

export default PlanTransaction;
