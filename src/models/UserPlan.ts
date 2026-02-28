import mongoose, { Document, Schema } from 'mongoose';

export interface IUserPlan extends Document {
  userId: mongoose.Types.ObjectId;
  activePlanId?: string;
  referralCode?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserPlanSchema = new Schema<IUserPlan>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    activePlanId: {
      type: String,
      default: null
    },
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true
    },
    expiresAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

const UserPlan = mongoose.model<IUserPlan>('UserPlan', UserPlanSchema);

export default UserPlan;

