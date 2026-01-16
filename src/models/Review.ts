import mongoose, { Document, Schema } from 'mongoose';

export enum ReviewSource {
    CUSTOMER_APP = 'CUSTOMER_APP',
    ADMIN_PANEL = 'ADMIN_PANEL'
}

export interface IReview extends Document {
    bookingId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    rating: number; // 1 to 5
    comment?: string;
    isPublished: boolean;
    source: ReviewSource;
    publishedAt?: Date;
    publishedBy?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>(
    {
        bookingId: {
            type: Schema.Types.ObjectId,
            ref: 'Booking',
            required: true,
            unique: true // One review per booking
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5
        },
        comment: {
            type: String,
            trim: true,
            maxlength: [1000, 'Comment cannot exceed 1000 characters']
        },
        isPublished: {
            type: Boolean,
            default: false
        },
        source: {
            type: String,
            enum: Object.values(ReviewSource),
            default: ReviewSource.CUSTOMER_APP
        },
        publishedAt: {
            type: Date
        },
        publishedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        }
    },
    {
        timestamps: true
    }
);

// Indexes
ReviewSchema.index({ bookingId: 1 });
ReviewSchema.index({ userId: 1 });
ReviewSchema.index({ isPublished: 1 });

const Review = mongoose.model<IReview>('Review', ReviewSchema);

export default Review;
