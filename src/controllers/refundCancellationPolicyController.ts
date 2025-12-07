import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import RefundCancellationPolicy from '../models/RefundCancellationPolicy';

// @desc    Get all refund & cancellation policies
// @route   GET /api/admin/refund-cancellation-policies
// @access  Private/Admin
export const getAllPolicies = asyncHandler(async (req: Request, res: Response) => {
  const { isActive } = req.query;
  
  const filter: any = {};
  if (isActive !== undefined) {
    filter.isActive = isActive === 'true';
  }

  const policies = await RefundCancellationPolicy.find(filter)
    .sort({ sequence: 1, createdAt: 1 });

  // Transform _id to id for frontend
  const transformedPolicies = policies.map(policy => ({
    ...policy.toObject(),
    id: policy._id.toString()
  }));

  res.status(200).json({
    success: true,
    data: {
      policies: transformedPolicies
    }
  });
});

// @desc    Get single refund & cancellation policy
// @route   GET /api/admin/refund-cancellation-policies/:id
// @access  Private/Admin
export const getPolicy = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const policy = await RefundCancellationPolicy.findById(id);

  if (!policy) {
    return next(new AppError('Policy not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      policy: {
        ...policy.toObject(),
        id: policy._id.toString()
      }
    }
  });
});

// @desc    Create refund & cancellation policy
// @route   POST /api/admin/refund-cancellation-policies
// @access  Private/Admin
export const createPolicy = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { question, answers, sequence, isActive } = req.body;

  if (!question || !answers || !Array.isArray(answers) || answers.length === 0) {
    return next(new AppError('Question and at least one answer are required', 400));
  }

  // Validate answers array
  const validAnswers = answers.filter((answer: string) => answer && answer.trim().length > 0);
  if (validAnswers.length === 0) {
    return next(new AppError('At least one valid answer is required', 400));
  }

  // If sequence is not provided, set it to the highest sequence + 1
  let finalSequence = sequence;
  if (finalSequence === undefined || finalSequence === null) {
    const maxSequencePolicy = await RefundCancellationPolicy.findOne().sort({ sequence: -1 });
    finalSequence = maxSequencePolicy ? maxSequencePolicy.sequence + 1 : 1;
  }

  if (finalSequence < 1) {
    return next(new AppError('Sequence must be at least 1', 400));
  }

  // Check if target sequence is already taken
  const existingAtSequence = await RefundCancellationPolicy.findOne({ sequence: finalSequence });
  if (existingAtSequence) {
    // Increment all questions at finalSequence and above
    await RefundCancellationPolicy.updateMany(
      { sequence: { $gte: finalSequence } },
      { $inc: { sequence: 1 } }
    );
  }

  const policy = await RefundCancellationPolicy.create({
    question: question.trim(),
    answers: validAnswers.map((answer: string) => answer.trim()),
    sequence: finalSequence,
    isActive: isActive !== undefined ? isActive : true
  });

  res.status(201).json({
    success: true,
    data: {
      policy: {
        ...policy.toObject(),
        id: policy._id.toString()
      }
    }
  });
});

// @desc    Update refund & cancellation policy
// @route   PUT /api/admin/refund-cancellation-policies/:id
// @access  Private/Admin
export const updatePolicy = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;
  const { question, answers, sequence, isActive } = req.body;

  const policy = await RefundCancellationPolicy.findById(id);

  if (!policy) {
    return next(new AppError('Policy not found', 404));
  }

  // Update fields if provided
  if (question !== undefined) {
    policy.question = question.trim();
  }

  if (answers !== undefined) {
    if (!Array.isArray(answers) || answers.length === 0) {
      return next(new AppError('At least one answer is required', 400));
    }
    const validAnswers = answers.filter((answer: string) => answer && answer.trim().length > 0);
    if (validAnswers.length === 0) {
      return next(new AppError('At least one valid answer is required', 400));
    }
    policy.answers = validAnswers.map((answer: string) => answer.trim());
  }

  if (sequence !== undefined && sequence !== null) {
    if (sequence < 1) {
      return next(new AppError('Sequence must be at least 1', 400));
    }

    const oldSequence = policy.sequence;
    const newSequence = sequence;

    if (oldSequence !== newSequence) {
      // Handle sequence conflict resolution
      if (newSequence > oldSequence) {
        // Moving down: decrement sequences between old and new
        await RefundCancellationPolicy.updateMany(
          {
            _id: { $ne: policy._id },
            sequence: { $gt: oldSequence, $lte: newSequence }
          },
          { $inc: { sequence: -1 } }
        );
      } else {
        // Moving up: increment sequences between new and old
        await RefundCancellationPolicy.updateMany(
          {
            _id: { $ne: policy._id },
            sequence: { $gte: newSequence, $lt: oldSequence }
          },
          { $inc: { sequence: 1 } }
        );
      }

      // Check if target sequence is already taken
      const existingAtSequence = await RefundCancellationPolicy.findOne({
        _id: { $ne: policy._id },
        sequence: newSequence
      });

      if (existingAtSequence) {
        // Increment all questions at newSequence and above
        await RefundCancellationPolicy.updateMany(
          {
            _id: { $ne: policy._id },
            sequence: { $gte: newSequence }
          },
          { $inc: { sequence: 1 } }
        );
      }

      policy.sequence = newSequence;
    }
  }

  if (isActive !== undefined) {
    policy.isActive = isActive;
  }

  await policy.save();

  res.status(200).json({
    success: true,
    data: {
      policy: {
        ...policy.toObject(),
        id: policy._id.toString()
      }
    }
  });
});

// @desc    Delete refund & cancellation policy
// @route   DELETE /api/admin/refund-cancellation-policies/:id
// @access  Private/Admin
export const deletePolicy = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const policy = await RefundCancellationPolicy.findById(id);

  if (!policy) {
    return next(new AppError('Policy not found', 404));
  }

  await policy.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Policy deleted successfully'
  });
});

// @desc    Update sequence of multiple policies
// @route   PATCH /api/admin/refund-cancellation-policies/update-sequence
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
    return RefundCancellationPolicy.findByIdAndUpdate(
      item.id,
      { sequence: item.sequence },
      { new: true }
    );
  });

  const validPromises = updatePromises.filter(p => p !== null);
  await Promise.all(validPromises);

  // Fetch all updated policies
  const updatedPolicies = await RefundCancellationPolicy.find()
    .sort({ sequence: 1, createdAt: 1 });

  // Transform _id to id for frontend
  const transformedPolicies = updatedPolicies.map(policy => ({
    ...policy.toObject(),
    id: policy._id.toString()
  }));

  res.status(200).json({
    success: true,
    data: {
      policies: transformedPolicies
    }
  });
});

