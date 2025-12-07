import mongoose, { Document, Schema } from 'mongoose';

export interface ITermsAndConditions extends Document {
  question: string;
  answers: string[]; // Array of strings for the response
  sequence: number; // Order in which questions appear
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TermsAndConditionsSchema = new Schema<ITermsAndConditions>(
  {
    question: {
      type: String,
      required: true,
      trim: true,
      maxlength: [500, 'Question cannot exceed 500 characters']
    },
    answers: {
      type: [String],
      required: true,
      validate: {
        validator: function(answers: string[]) {
          return answers.length > 0 && answers.every(answer => answer.trim().length > 0);
        },
        message: 'At least one answer is required and all answers must be non-empty'
      }
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
TermsAndConditionsSchema.index({ sequence: 1 });
TermsAndConditionsSchema.index({ isActive: 1 });

const TermsAndConditions = mongoose.model<ITermsAndConditions>('TermsAndConditions', TermsAndConditionsSchema);

export default TermsAndConditions;

