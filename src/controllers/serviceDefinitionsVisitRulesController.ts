import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import ServiceDefinitionsVisitRules from '../models/ServiceDefinitionsVisitRules';

// @desc    Get all service definitions & visit rules
// @route   GET /api/admin/service-definitions-visit-rules
// @access  Private/Admin
export const getAllRules = asyncHandler(async (req: Request, res: Response) => {
  const { isActive } = req.query;
  
  const filter: any = {};
  if (isActive !== undefined) {
    filter.isActive = isActive === 'true';
  }

  const rules = await ServiceDefinitionsVisitRules.find(filter)
    .sort({ sequence: 1, createdAt: 1 });

  // Transform _id to id for frontend
  const transformedRules = rules.map(rule => ({
    ...rule.toObject(),
    id: rule._id.toString()
  }));

  res.status(200).json({
    success: true,
    data: {
      rules: transformedRules
    }
  });
});

// @desc    Get single service definition & visit rule
// @route   GET /api/admin/service-definitions-visit-rules/:id
// @access  Private/Admin
export const getRule = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const rule = await ServiceDefinitionsVisitRules.findById(id);

  if (!rule) {
    return next(new AppError('Rule not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      rule: {
        ...rule.toObject(),
        id: rule._id.toString()
      }
    }
  });
});

// @desc    Create service definition & visit rule
// @route   POST /api/admin/service-definitions-visit-rules
// @access  Private/Admin
export const createRule = asyncHandler(async (req: Request, res: Response, next: any) => {
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
    const maxSequenceRule = await ServiceDefinitionsVisitRules.findOne().sort({ sequence: -1 });
    finalSequence = maxSequenceRule ? maxSequenceRule.sequence + 1 : 1;
  }

  if (finalSequence < 1) {
    return next(new AppError('Sequence must be at least 1', 400));
  }

  // Check if target sequence is already taken
  const existingAtSequence = await ServiceDefinitionsVisitRules.findOne({ sequence: finalSequence });
  if (existingAtSequence) {
    // Increment all rules at finalSequence and above
    await ServiceDefinitionsVisitRules.updateMany(
      { sequence: { $gte: finalSequence } },
      { $inc: { sequence: 1 } }
    );
  }

  const rule = await ServiceDefinitionsVisitRules.create({
    question: question.trim(),
    answers: validAnswers.map((answer: string) => answer.trim()),
    sequence: finalSequence,
    isActive: isActive !== undefined ? isActive : true
  });

  res.status(201).json({
    success: true,
    data: {
      rule
    }
  });
});

// @desc    Update service definition & visit rule
// @route   PUT /api/admin/service-definitions-visit-rules/:id
// @access  Private/Admin
export const updateRule = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;
  const { question, answers, sequence, isActive } = req.body;

  const rule = await ServiceDefinitionsVisitRules.findById(id);

  if (!rule) {
    return next(new AppError('Rule not found', 404));
  }

  // Update fields if provided
  if (question !== undefined) {
    rule.question = question.trim();
  }

  if (answers !== undefined) {
    if (!Array.isArray(answers) || answers.length === 0) {
      return next(new AppError('At least one answer is required', 400));
    }
    const validAnswers = answers.filter((answer: string) => answer && answer.trim().length > 0);
    if (validAnswers.length === 0) {
      return next(new AppError('At least one valid answer is required', 400));
    }
    rule.answers = validAnswers.map((answer: string) => answer.trim());
  }

  if (sequence !== undefined && sequence !== null) {
    if (sequence < 1) {
      return next(new AppError('Sequence must be at least 1', 400));
    }

    const oldSequence = rule.sequence;
    const newSequence = sequence;

    if (oldSequence !== newSequence) {
      // Handle sequence conflict resolution
      if (newSequence > oldSequence) {
        // Moving down: decrement sequences between old and new
        await ServiceDefinitionsVisitRules.updateMany(
          {
            _id: { $ne: rule._id },
            sequence: { $gt: oldSequence, $lte: newSequence }
          },
          { $inc: { sequence: -1 } }
        );
      } else {
        // Moving up: increment sequences between new and old
        await ServiceDefinitionsVisitRules.updateMany(
          {
            _id: { $ne: rule._id },
            sequence: { $gte: newSequence, $lt: oldSequence }
          },
          { $inc: { sequence: 1 } }
        );
      }

      // Check if target sequence is already taken
      const existingAtSequence = await ServiceDefinitionsVisitRules.findOne({
        _id: { $ne: rule._id },
        sequence: newSequence
      });

      if (existingAtSequence) {
        // Increment all rules at newSequence and above
        await ServiceDefinitionsVisitRules.updateMany(
          {
            _id: { $ne: rule._id },
            sequence: { $gte: newSequence }
          },
          { $inc: { sequence: 1 } }
        );
      }

      rule.sequence = newSequence;
    }
  }

  if (isActive !== undefined) {
    rule.isActive = isActive;
  }

  await rule.save();

  res.status(200).json({
    success: true,
    data: {
      rule: {
        ...rule.toObject(),
        id: rule._id.toString()
      }
    }
  });
});

// @desc    Delete service definition & visit rule
// @route   DELETE /api/admin/service-definitions-visit-rules/:id
// @access  Private/Admin
export const deleteRule = asyncHandler(async (req: Request, res: Response, next: any) => {
  const { id } = req.params;

  const rule = await ServiceDefinitionsVisitRules.findById(id);

  if (!rule) {
    return next(new AppError('Rule not found', 404));
  }

  await rule.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Rule deleted successfully'
  });
});

// @desc    Update sequence of multiple rules
// @route   PATCH /api/admin/service-definitions-visit-rules/update-sequence
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
    return ServiceDefinitionsVisitRules.findByIdAndUpdate(
      item.id,
      { sequence: item.sequence },
      { new: true }
    );
  });

  const validPromises = updatePromises.filter(p => p !== null);
  await Promise.all(validPromises);

  // Fetch all updated rules
  const updatedRules = await ServiceDefinitionsVisitRules.find()
    .sort({ sequence: 1, createdAt: 1 });

  // Transform _id to id for frontend
  const transformedRules = updatedRules.map(rule => ({
    ...rule.toObject(),
    id: rule._id.toString()
  }));

  res.status(200).json({
    success: true,
    data: {
      rules: transformedRules
    }
  });
});

