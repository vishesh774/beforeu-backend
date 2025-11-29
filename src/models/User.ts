import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'customer' | 'Admin' | 'Supervisor' | 'Incharge';

export interface IUser extends Document {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: UserRole;
  isActive: boolean;
  activePlanId?: string;
  credits: number;
  familyMembers: Array<{
    id: string;
    name: string;
    relation: string;
    phone: string;
    email?: string;
  }>;
  addresses: Array<{
    id: string;
    label: string;
    fullAddress: string;
    isDefault: boolean;
  }>;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const FamilyMemberSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  relation: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String }
}, { _id: false });

const AddressSchema = new Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  fullAddress: { type: String, required: true },
  isDefault: { type: Boolean, default: false }
}, { _id: false });

const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters']
    },
    email: {
      type: String,
      required: false,
      unique: true,
      sparse: true, // Allows multiple null/empty values
      lowercase: true,
      trim: true,
      validate: {
        validator: function(v: string) {
          // Allow empty string, but if provided, must be valid email
          return !v || /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(v);
        },
        message: 'Please provide a valid email'
      },
      default: ''
    },
    phone: {
      type: String,
      required: [true, 'Please provide a phone number'],
      trim: true,
      match: [/^\+?[1-9]\d{1,14}$/, 'Please provide a valid phone number']
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false // Don't return password by default
    },
    role: {
      type: String,
      enum: ['customer', 'Admin', 'Supervisor', 'Incharge'],
      default: 'customer',
      required: true
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true
    },
    activePlanId: {
      type: String,
      default: null
    },
    credits: {
      type: Number,
      default: 0
    },
    familyMembers: {
      type: [FamilyMemberSchema],
      default: []
    },
    addresses: {
      type: [AddressSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

// Hash password before saving
UserSchema.pre('save', async function (this: IUser) {
  // Skip if password hasn't been modified
  if (!this.isModified('password')) {
    return;
  }

  // Hash the password
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare password
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model<IUser>('User', UserSchema);

export default User;

