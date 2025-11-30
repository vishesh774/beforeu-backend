import mongoose, { Document, Schema } from 'mongoose';

export interface IUserCredits extends Document {
  userId: mongoose.Types.ObjectId;
  credits: number;
  createdAt: Date;
  updatedAt: Date;
}

const UserCreditsSchema = new Schema<IUserCredits>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    credits: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  {
    timestamps: true
  }
);

const UserCredits = mongoose.model<IUserCredits>('UserCredits', UserCreditsSchema);

export default UserCredits;

