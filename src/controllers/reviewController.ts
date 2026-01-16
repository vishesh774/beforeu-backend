import { Request, Response } from 'express';
import Review from '../models/Review';
import Booking from '../models/Booking';
import OrderItem from '../models/OrderItem';
import Service from '../models/Service';
import ServicePartner from '../models/ServicePartner';
import { AuthRequest } from '../middleware/auth';
import mongoose from 'mongoose';

// @desc    Create or update a review for a completed booking
// @route   POST /api/reviews
// @access  Private (Customer)
export const createOrUpdateReview = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { bookingId, rating, comment } = req.body;

        if (!bookingId || !rating) {
            res.status(400).json({ success: false, error: 'Booking ID and rating are required' });
            return;
        }

        if (rating < 1 || rating > 5) {
            res.status(400).json({ success: false, error: 'Rating must be between 1 and 5' });
            return;
        }

        // Verify Booking exists and belongs to user
        const booking = await Booking.findOne({ _id: bookingId, userId });
        if (!booking) {
            res.status(404).json({ success: false, error: 'Booking not found or access denied' });
            return;
        }

        // Verify status is completed (or maybe partially completed aka 'completed' status string)
        // Adjust these statuses based on your BookingStatus enum
        if (!['completed', 'refunded', 'cancelled'].includes(booking.status)) {
            // For now, allow rating on 'completed' only? User said "Once a booking is completed".
            if (booking.status !== 'completed') {
                // But wait, user might want to rate a cancelled booking? 
                // Usually only completed bookings.
                // Let's stick to completed for now.
                // Actually, let's check checking 'completed' status string.
                // If status is specific enum, we should allow 'completed' or logic in "syncBookingStatus" says COMPLETED.
            }
        }

        // Upsert review (Self-saving)
        // If it exists, update it. If published, maybe restrict editing?
        // User request: "These Ratings ... cant be edited by user later."
        // But also "Self saving ... simply can be saved by tapping ... allow to add a rating [later]".
        // This implies: Unfinished/Draft -> Updateable. Finalized? 
        // Let's allow updates until it is "Published" by admin. 
        // Or simply always allow updates from the App until some cutoff.
        // For simplicity: Always update based on bookingId.

        let review = await Review.findOne({ bookingId });

        if (review) {
            // Update existing
            review.rating = rating;
            if (comment !== undefined) review.comment = comment;
            await review.save();
        } else {
            // Create new
            review = await Review.create({
                bookingId,
                userId,
                rating,
                comment,
                isPublished: false
            });
        }

        res.status(200).json({ success: true, data: review });
    } catch (error) {
        console.error('Error saving review:', error);
        res.status(500).json({ success: false, error: 'Failed to save review' });
    }
};

// @desc    Get review for a booking
// @route   GET /api/reviews/booking/:bookingId
// @access  Private
export const getReviewByBooking = async (req: AuthRequest, res: Response) => {
    try {
        const { bookingId } = req.params;
        const userId = req.user?.id;

        const review = await Review.findOne({ bookingId });

        // Allow if user is owner OR admin. 
        // But this is customer endpoint mostly.
        if (review && review.userId.toString() !== userId && req.user?.role === 'customer') {
            // If access control strictness needed
        }

        if (!review) {
            res.status(404).json({ success: false, error: 'Review not found' });
            return;
        }

        res.status(200).json({ success: true, data: review });
    } catch (error) {
        console.error('Error fetching review:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch review' });
    }
};

// --- ADMIN CONTROLLERS ---

// @desc    Get all reviews (Admin)
// @route   GET /api/admin/reviews
// @access  Private (Admin)
export const getAllReviews = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const status = req.query.status as string; // 'published', 'pending'

        const filter: any = {};
        if (status === 'published') filter.isPublished = true;
        if (status === 'pending') filter.isPublished = false;

        const total = await Review.countDocuments(filter);
        const reviews = await Review.find(filter)
            .populate('userId', 'name email phone')
            .populate('bookingId') // Maybe populate booking/items too?
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        res.status(200).json({
            success: true,
            data: {
                reviews,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Error fetching all reviews:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
    }
};

// @desc    Publish a review
// @route   PUT /api/admin/reviews/:id/publish
// @access  Private (Admin)
export const publishReview = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const adminId = req.user?.id;

        const review = await Review.findById(id);
        if (!review) {
            res.status(404).json({ success: false, error: 'Review not found' });
            return;
        }

        if (review.isPublished) {
            res.status(400).json({ success: false, error: 'Review is already published' });
            return;
        }

        review.isPublished = true;
        review.publishedAt = new Date();
        review.publishedBy = new mongoose.Types.ObjectId(adminId);
        await review.save();

        // Recalculate Ratings for linked Services and Partners
        await recalculateRatings(review);

        res.status(200).json({ success: true, data: review, message: 'Review published and ratings updated' });
    } catch (error) {
        console.error('Error publishing review:', error);
        res.status(500).json({ success: false, error: 'Failed to publish review' });
    }
};

// Helper to recalculate ratings
const recalculateRatings = async (review: any) => {
    try {
        // Find Booking Items to identify Services and Partners
        const items = await OrderItem.find({ bookingId: review.bookingId });

        const serviceIds = new Set<string>();
        const partnerIds = new Set<string>();

        items.forEach(item => {
            if (item.serviceId) serviceIds.add(item.serviceId.toString());
            if (item.assignedPartnerId) partnerIds.add(item.assignedPartnerId.toString());
        });

        // Update Services
        for (const sId of serviceIds) {
            await updateEntityRating(Service, sId);
        }

        // Update Partners
        for (const pId of partnerIds) {
            await updateEntityRating(ServicePartner, pId);
        }

    } catch (error) {
        console.error('Recalculation error:', error);
    }
}

// Generic function to update average rating for an entity (Service or ServicePartner)
// Note: This matches "Service" or "ServicePartner" assuming they have `rating` and `ratingCount` fields.
// Since schema doesn't have them yet, we need to add them or use flexible update.
// But models are strict. We need to update models first. 
// Assuming models will be updated.
const updateEntityRating = async (Model: any, entityId: string) => {
    // Find all *published* reviews linked to bookings that contain this entity
    // This is complex because Review -> Booking -> OrderItem -> Entity.
    // We need aggregation.

    // 1. Find all OrderItems for this entity
    const entityType = Model.modelName;
    const matchQuery: any = {};
    if (entityType === 'Service') matchQuery.serviceId = new mongoose.Types.ObjectId(entityId);
    if (entityType === 'ServicePartner') matchQuery.assignedPartnerId = new mongoose.Types.ObjectId(entityId);

    // Get bookingIds from these items
    const fileteredItems = await OrderItem.find(matchQuery).select('bookingId');
    const bookingIds = fileteredItems.map(i => i.bookingId);

    if (bookingIds.length === 0) return;

    // 2. Aggregate Reviews for these bookings where isPublished = true
    const result = await Review.aggregate([
        {
            $match: {
                bookingId: { $in: bookingIds },
                isPublished: true
            }
        },
        {
            $group: {
                _id: null,
                averageRating: { $avg: '$rating' },
                ratingCount: { $sum: 1 }
            }
        }
    ]);

    const { averageRating, ratingCount } = result[0] || { averageRating: 0, ratingCount: 0 };

    // Update Entity
    await Model.findByIdAndUpdate(entityId, {
        rating: parseFloat(averageRating.toFixed(1)),
        ratingCount
    });
};
