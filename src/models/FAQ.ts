import mongoose, { Document, Schema } from 'mongoose';

export interface IFAQ extends Document {
  question: string;
  answer: string;
  sequence: number; // Order in which FAQs appear
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FAQSchema = new Schema<IFAQ>(
  {
    question: {
      type: String,
      required: true,
      trim: true,
      maxlength: [500, 'Question cannot exceed 500 characters']
    },
    answer: {
      type: String,
      required: true,
      trim: true
    },
    sequence: {
      type: Number,
      required: true,
      default: 1,
      min: 1
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes
FAQSchema.index({ sequence: 1 });
FAQSchema.index({ isActive: 1 });

const FAQ = mongoose.model<IFAQ>('FAQ', FAQSchema);

export default FAQ;

