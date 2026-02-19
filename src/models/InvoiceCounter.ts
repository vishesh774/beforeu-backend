import mongoose, { Document, Schema } from 'mongoose';

export interface IInvoiceCounter extends Document {
    year: string; // Format: "25-26"
    count: number;
    lastUpdated: Date;
}

const InvoiceCounterSchema = new Schema<IInvoiceCounter>({
    year: {
        type: String,
        required: true,
        unique: true,
    },
    count: {
        type: Number,
        required: true,
        default: 0,
    },
    lastUpdated: {
        type: Date,
        default: Date.now,
    },
});

const InvoiceCounter = mongoose.model<IInvoiceCounter>('InvoiceCounter', InvoiceCounterSchema);

export default InvoiceCounter;
