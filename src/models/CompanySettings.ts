import mongoose, { Document, Schema } from 'mongoose';

export interface ICompanySettings extends Document {
    name: string;
    address: string;
    phone: string;
    email: string;
    gstNumber?: string;
    logoUrl?: string; // Base64 or URL
    invoicePrefix: string;
    eula?: string;
    privacyPolicy?: string;
    createdAt: Date;
    updatedAt: Date;
}

const CompanySettingsSchema = new Schema<ICompanySettings>(
    {
        name: {
            type: String,
            required: true,
            default: "BeforeU"
        },
        address: {
            type: String,
            default: ""
        },
        phone: {
            type: String,
            default: ""
        },
        email: {
            type: String,
            default: ""
        },
        gstNumber: {
            type: String,
            default: ""
        },
        logoUrl: {
            type: String,
            default: "" // We will store base64 for simplicity in this task if needed, or a URL
        },
        invoicePrefix: {
            type: String,
            default: "BU"
        },
        eula: {
            type: String,
            default: ""
        },
        privacyPolicy: {
            type: String,
            default: ""
        }
    },
    {
        timestamps: true
    }
);

const CompanySettings = mongoose.model<ICompanySettings>('CompanySettings', CompanySettingsSchema);

export default CompanySettings;
