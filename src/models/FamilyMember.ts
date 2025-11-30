import mongoose, { Document, Schema } from 'mongoose';

export interface IFamilyMember extends Document {
  userId: mongoose.Types.ObjectId;
  id: string; // Custom ID for frontend reference
  name: string;
  relation: string;
  phone: string;
  email?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FamilyMemberSchema = new Schema<IFamilyMember>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    id: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters']
    },
    relation: {
      type: String,
      required: [true, 'Please provide a relation'],
      trim: true
    },
    phone: {
      type: String,
      required: [true, 'Please provide a phone number'],
      trim: true,
      match: [/^\+?[1-9]\d{1,14}$/, 'Please provide a valid phone number']
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      validate: {
        validator: function(v: string) {
          return !v || /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(v);
        },
        message: 'Please provide a valid email'
      }
    }
  },
  {
    timestamps: true
  }
);

// Indexes
FamilyMemberSchema.index({ userId: 1, id: 1 }, { unique: true });
FamilyMemberSchema.index({ userId: 1 });

const FamilyMember = mongoose.model<IFamilyMember>('FamilyMember', FamilyMemberSchema);

export default FamilyMember;

