import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import FAQ from '../models/FAQ';

// @desc    Get all FAQs
// @route   GET /api/admin/faqs or GET /api/auth/faqs
// @access  Private/Admin (for admin) or Public (for customers - only active FAQs)
export const getAllFAQs = asyncHandler(async (req: Request, res: Response) => {
  const { isActive } = req.query;
  
  const filter: any = {};
  // If accessed via /api/auth/faqs (customer route), only show active FAQs
  const isCustomerRoute = req.path.includes('/auth/faqs');
  if (isCustomerRoute) {
    filter.isActive = true;
  } else if (isActive !== undefined) {
    filter.isActive = isActive === 'true';
  }

  const faqs = await FAQ.find(filter)
    .sort({ sequence: 1, createdAt: 1 });

  // Transform _id to id for frontend
  const transformedFAQs = faqs.map(faq => ({
    ...faq.toObject(),
    id: faq._id.toString()
  }));

  res.status(200).json({
    success: true,
    data: {
      faqs: transformedFAQs
    }
  });
});

// @desc    Get single FAQ
// @route   GET /api/admin/faqs/:id
// @access  Private/Admin
export const getFAQ = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const faq = await FAQ.findById(id);

  if (!faq) {
    return next(new AppError('FAQ not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      faq: {
        ...faq.toObject(),
        id: faq._id.toString()
      }
    }
  });
});

// @desc    Create FAQ
// @route   POST /api/admin/faqs
// @access  Private/Admin
export const createFAQ = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { question, answer, sequence, isActive } = req.body;

  if (!question || !question.trim()) {
    return next(new AppError('Question is required', 400));
  }

  if (!answer || !answer.trim()) {
    return next(new AppError('Answer is required', 400));
  }

  // If sequence is not provided, set it to the highest sequence + 1
  let finalSequence = sequence;
  if (finalSequence === undefined || finalSequence === null) {
    const maxSequenceFAQ = await FAQ.findOne().sort({ sequence: -1 });
    finalSequence = maxSequenceFAQ ? maxSequenceFAQ.sequence + 1 : 1;
  }

  if (finalSequence < 1) {
    return next(new AppError('Sequence must be at least 1', 400));
  }

  // Check if target sequence is already taken
  const existingAtSequence = await FAQ.findOne({ sequence: finalSequence });
  if (existingAtSequence) {
    // Increment all FAQs at finalSequence and above
    await FAQ.updateMany(
      { sequence: { $gte: finalSequence } },
      { $inc: { sequence: 1 } }
    );
  }

  const faq = await FAQ.create({
    question: question.trim(),
    answer: answer.trim(),
    sequence: finalSequence,
    isActive: isActive !== undefined ? isActive : true
  });

  res.status(201).json({
    success: true,
    data: {
      faq
    }
  });
});

// @desc    Update FAQ
// @route   PUT /api/admin/faqs/:id
// @access  Private/Admin
export const updateFAQ = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;
  const { question, answer, sequence, isActive } = req.body;

  const faq = await FAQ.findById(id);

  if (!faq) {
    return next(new AppError('FAQ not found', 404));
  }

  // Update fields if provided
  if (question !== undefined) {
    if (!question.trim()) {
      return next(new AppError('Question cannot be empty', 400));
    }
    faq.question = question.trim();
  }

  if (answer !== undefined) {
    if (!answer.trim()) {
      return next(new AppError('Answer cannot be empty', 400));
    }
    faq.answer = answer.trim();
  }

  if (sequence !== undefined && sequence !== null) {
    if (sequence < 1) {
      return next(new AppError('Sequence must be at least 1', 400));
    }

    const oldSequence = faq.sequence;
    const newSequence = sequence;

    if (oldSequence !== newSequence) {
      // Handle sequence conflict resolution
      if (newSequence > oldSequence) {
        // Moving down: decrement sequences between old and new
        await FAQ.updateMany(
          {
            _id: { $ne: faq._id },
            sequence: { $gt: oldSequence, $lte: newSequence }
          },
          { $inc: { sequence: -1 } }
        );
      } else {
        // Moving up: increment sequences between new and old
        await FAQ.updateMany(
          {
            _id: { $ne: faq._id },
            sequence: { $gte: newSequence, $lt: oldSequence }
          },
          { $inc: { sequence: 1 } }
        );
      }

      // Check if target sequence is already taken
      const existingAtSequence = await FAQ.findOne({
        _id: { $ne: faq._id },
        sequence: newSequence
      });

      if (existingAtSequence) {
        // Increment all FAQs at newSequence and above
        await FAQ.updateMany(
          {
            _id: { $ne: faq._id },
            sequence: { $gte: newSequence }
          },
          { $inc: { sequence: 1 } }
        );
      }

      faq.sequence = newSequence;
    }
  }

  if (isActive !== undefined) {
    faq.isActive = isActive;
  }

  await faq.save();

  res.status(200).json({
    success: true,
    data: {
      faq: {
        ...faq.toObject(),
        id: faq._id.toString()
      }
    }
  });
});

// @desc    Delete FAQ
// @route   DELETE /api/admin/faqs/:id
// @access  Private/Admin
export const deleteFAQ = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const faq = await FAQ.findById(id);

  if (!faq) {
    return next(new AppError('FAQ not found', 404));
  }

  await faq.deleteOne();

  res.status(200).json({
    success: true,
    message: 'FAQ deleted successfully'
  });
});

// @desc    Update sequence of multiple FAQs
// @route   PATCH /api/admin/faqs/update-sequence
// @access  Private/Admin
export const updateSequence = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { sequences } = req.body; // Array of { id: string, sequence: number }

  if (!Array.isArray(sequences)) {
    return next(new AppError('Sequences must be an array', 400));
  }

  // Update all sequences in a transaction
  const updatePromises = sequences.map((item: { id: string; sequence: number }) => {
    if (!item.id || item.sequence === undefined || item.sequence === null) {
      return null;
    }
    return FAQ.findByIdAndUpdate(
      item.id,
      { sequence: item.sequence },
      { new: true }
    );
  });

  const validPromises = updatePromises.filter(p => p !== null);
  await Promise.all(validPromises);

  // Fetch all updated FAQs
  const updatedFAQs = await FAQ.find()
    .sort({ sequence: 1, createdAt: 1 });

  // Transform _id to id for frontend
  const transformedFAQs = updatedFAQs.map(faq => ({
    ...faq.toObject(),
    id: faq._id.toString()
  }));

  res.status(200).json({
    success: true,
    data: {
      faqs: transformedFAQs
    }
  });
});

