import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import TermsAndConditions from '../models/TermsAndConditions';

// @desc    Get all terms and conditions
// @route   GET /api/admin/terms-and-conditions
// @access  Private/Admin
export const getAllTerms = asyncHandler(async (req: Request, res: Response) => {
  const { isActive } = req.query;
  
  const filter: any = {};
  if (isActive !== undefined) {
    filter.isActive = isActive === 'true';
  }

  const terms = await TermsAndConditions.find(filter)
    .sort({ sequence: 1, createdAt: 1 });

  // Transform _id to id for frontend
  const transformedTerms = terms.map(term => ({
    ...term.toObject(),
    id: term._id.toString()
  }));

  res.status(200).json({
    success: true,
    data: {
      terms: transformedTerms
    }
  });
});

// @desc    Get single term and condition
// @route   GET /api/admin/terms-and-conditions/:id
// @access  Private/Admin
export const getTerm = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const term = await TermsAndConditions.findById(id);

  if (!term) {
    return next(new AppError('Term not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      term: {
        ...term.toObject(),
        id: term._id.toString()
      }
    }
  });
});

// @desc    Create term and condition
// @route   POST /api/admin/terms-and-conditions
// @access  Private/Admin
export const createTerm = asyncHandler(async (req: Request, res: Response, next: any) => {
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
    const maxSequenceTerm = await TermsAndConditions.findOne().sort({ sequence: -1 });
    finalSequence = maxSequenceTerm ? maxSequenceTerm.sequence + 1 : 1;
  }

  if (finalSequence < 1) {
    return next(new AppError('Sequence must be at least 1', 400));
  }

  // Check if target sequence is already taken
  const existingAtSequence = await TermsAndConditions.findOne({ sequence: finalSequence });
  if (existingAtSequence) {
    // Increment all terms at finalSequence and above
    await TermsAndConditions.updateMany(
      { sequence: { $gte: finalSequence } },
      { $inc: { sequence: 1 } }
    );
  }

  const term = await TermsAndConditions.create({
    question: question.trim(),
    answers: validAnswers.map((answer: string) => answer.trim()),
    sequence: finalSequence,
    isActive: isActive !== undefined ? isActive : true
  });

  res.status(201).json({
    success: true,
    data: {
      term
    }
  });
});

// @desc    Update term and condition
// @route   PUT /api/admin/terms-and-conditions/:id
// @access  Private/Admin
export const updateTerm = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;
  const { question, answers, sequence, isActive } = req.body;

  const term = await TermsAndConditions.findById(id);

  if (!term) {
    return next(new AppError('Term not found', 404));
  }

  // Update fields if provided
  if (question !== undefined) {
    term.question = question.trim();
  }

  if (answers !== undefined) {
    if (!Array.isArray(answers) || answers.length === 0) {
      return next(new AppError('At least one answer is required', 400));
    }
    const validAnswers = answers.filter((answer: string) => answer && answer.trim().length > 0);
    if (validAnswers.length === 0) {
      return next(new AppError('At least one valid answer is required', 400));
    }
    term.answers = validAnswers.map((answer: string) => answer.trim());
  }

  if (sequence !== undefined && sequence !== null) {
    if (sequence < 1) {
      return next(new AppError('Sequence must be at least 1', 400));
    }

    const oldSequence = term.sequence;
    const newSequence = sequence;

    if (oldSequence !== newSequence) {
      // Handle sequence conflict resolution
      if (newSequence > oldSequence) {
        // Moving down: decrement sequences between old and new
        await TermsAndConditions.updateMany(
          {
            _id: { $ne: term._id },
            sequence: { $gt: oldSequence, $lte: newSequence }
          },
          { $inc: { sequence: -1 } }
        );
      } else {
        // Moving up: increment sequences between new and old
        await TermsAndConditions.updateMany(
          {
            _id: { $ne: term._id },
            sequence: { $gte: newSequence, $lt: oldSequence }
          },
          { $inc: { sequence: 1 } }
        );
      }

      // Check if target sequence is already taken
      const existingAtSequence = await TermsAndConditions.findOne({
        _id: { $ne: term._id },
        sequence: newSequence
      });

      if (existingAtSequence) {
        // Increment all terms at newSequence and above
        await TermsAndConditions.updateMany(
          {
            _id: { $ne: term._id },
            sequence: { $gte: newSequence }
          },
          { $inc: { sequence: 1 } }
        );
      }

      term.sequence = newSequence;
    }
  }

  if (isActive !== undefined) {
    term.isActive = isActive;
  }

  await term.save();

  res.status(200).json({
    success: true,
    data: {
      term: {
        ...term.toObject(),
        id: term._id.toString()
      }
    }
  });
});

// @desc    Delete term and condition
// @route   DELETE /api/admin/terms-and-conditions/:id
// @access  Private/Admin
export const deleteTerm = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const term = await TermsAndConditions.findById(id);

  if (!term) {
    return next(new AppError('Term not found', 404));
  }

  await term.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Term deleted successfully'
  });
});

// @desc    Update sequence of multiple terms
// @route   PATCH /api/admin/terms-and-conditions/update-sequence
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
    return TermsAndConditions.findByIdAndUpdate(
      item.id,
      { sequence: item.sequence },
      { new: true }
    );
  });

  const validPromises = updatePromises.filter(p => p !== null);
  await Promise.all(validPromises);

  // Fetch all updated terms
  const updatedTerms = await TermsAndConditions.find()
    .sort({ sequence: 1, createdAt: 1 });

  // Transform _id to id for frontend
  const transformedTerms = updatedTerms.map(term => ({
    ...term.toObject(),
    id: term._id.toString()
  }));

  res.status(200).json({
    success: true,
    data: {
      terms: transformedTerms
    }
  });
});

