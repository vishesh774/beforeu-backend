import mongoose, { Document, Schema } from 'mongoose';

export interface IPermission {
    resource: string; // e.g., 'dashboard', 'bookings', 'users', 'roles', 'finance'
    read: boolean;
    write: boolean;
    export: boolean;
}

export interface IRole extends Document {
    name: string;
    description?: string;
    permissions: IPermission[];
    isSystem: boolean; // Pre-defined roles that cannot be deleted
    createdAt: Date;
    updatedAt: Date;
}

const RoleSchema = new Schema<IRole>(
    {
        name: {
            type: String,
            required: [true, 'Please provide a role name'],
            unique: true,
            trim: true
        },
        description: {
            type: String,
            trim: true
        },
        permissions: [{
            resource: { type: String, required: true },
            read: { type: Boolean, default: false },
            write: { type: Boolean, default: false },
            export: { type: Boolean, default: false }
        }],
        isSystem: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true
    }
);

const Role = mongoose.model<IRole>('Role', RoleSchema);
export default Role;
