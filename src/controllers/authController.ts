import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import Address from '../models/Address';
import FamilyMember from '../models/FamilyMember';
import { asyncHandler } from '../middleware/asyncHandler';
import { generateToken } from '../utils/generateToken';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import UserPlan from '../models/UserPlan';
import Plan from '../models/Plan';
import { aggregateUserData, initializeUserRecords, getPlanHolderId } from '../utils/userHelpers';
import { sendAddedAsFamilyMessage } from '../services/whatsappService';
import Role from '../models/Role';
import { createCRMLead } from '../services/crmService';
import { assignCRMTask } from '../services/crmTaskService';

interface SignupRequest extends Request {
  body: {
    name: string;
    email: string;
    phone: string;
    password: string;
  };
}

// @desc    Register a new user
// @route   POST /api/auth/signup
// @access  Public
export const signup = asyncHandler(async (req: SignupRequest, res: Response, next: NextFunction) => {
  const { name, email, phone, password } = req.body;

  // Check if user already exists (case-insensitive)
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    return next(new AppError('User already exists with this email', 400));
  }

  // Check if phone number is already registered
  const existingPhone = await User.findOne({ phone });
  if (existingPhone) {
    return next(new AppError('User already exists with this phone number', 400));
  }

  // Create user with default role as 'customer'
  const user = await User.create({
    name,
    email,
    phone,
    password,
    role: 'customer' // Default role for signups
  });

  // Initialize user-related records (credits and plan)
  await initializeUserRecords(user._id);

  // Aggregate user data
  const userData = await aggregateUserData(user._id);
  if (!userData) {
    return next(new AppError('Failed to create user data', 500));
  }

  // --- CRM & Task Integration ---
  try {
    // 1. Create Lead in CRM
    const nameParts = name.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    await createCRMLead({
      firstName,
      lastName,
      email,
      phone,
      description: 'New user signed up via mobile app',
      companyName: 'B2C Customer'
    });

    // 2. Assign Verification Task to GuestCare Agent
    const guestCareUsers = await User.find({
      role: 'GuestCare',
      crmId: { $exists: true, $ne: '' },
      isActive: true
    });

    if (guestCareUsers.length > 0) {
      // Round-robin or random assignment
      const assignee = guestCareUsers[Math.floor(Math.random() * guestCareUsers.length)];
      const assigneeCrmId = assignee.crmId; // Typed as string usually

      if (assigneeCrmId) {
        // Use configured admin ID or fallback to assignee themselves
        const adminAssignerId = process.env.CRM_ADMIN_ASSIGNER_ID || assigneeCrmId;

        await assignCRMTask({
          title: `New Signup Verification: ${name}`,
          description: `A new customer ${name} (${phone}) has just signed up. Please verify and welcome them.`,
          assignedById: adminAssignerId,
          assignedToId: assigneeCrmId,
          priority: 'High',
          targetDate: new Date().toISOString().split('T')[0]
        });
      }
    } else {
      console.log('[AuthController] No GuestCare users found for CRM task assignment.');
    }
  } catch (error) {
    console.error('[AuthController] CRM integration failed:', error);
    // We suppress this error to ensure signup success
  }
  // ------------------------------

  // Generate token
  const token = generateToken({
    userId: user._id.toString(),
    email: user.email
  });

  // Send response
  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: {
      user: userData,
      token
    }
  });
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  // Find user and include password (case-insensitive)
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) {
    return next(new AppError('Invalid credentials', 401));
  }

  // Check password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    return next(new AppError('Invalid credentials', 401));
  }

  // Check if user is active
  if (!user.isActive) {
    return next(new AppError('Your account has been deactivated. Please contact support.', 403));
  }

  // Aggregate user data
  const userData = await aggregateUserData(user._id);
  if (!userData) {
    return next(new AppError('Failed to load user data', 500));
  }

  // Generate token
  const token = generateToken({
    userId: user._id.toString(),
    email: user.email
  });

  // Send response
  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: {
      user: userData,
      token
    }
  });
});

// @desc    Admin login (for Admin, Supervisor, Incharge roles only)
// @route   POST /api/auth/admin/login
export const adminLogin = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  // Find user and include password
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) {
    return next(new AppError('Invalid credentials', 401));
  }

  // Check if user has admin role or custom role
  let permissions: any = {};
  let roleName: string = user.role;

  if (user.roleId) {
    const customRole = await Role.findById(user.roleId);
    if (customRole) {
      roleName = customRole.name;
      permissions = customRole.permissions.reduce((acc: any, p: any) => {
        acc[p.resource] = { read: p.read, write: p.write, export: p.export };
        return acc;
      }, {});
    } else {
      // Role ID exists but role not found? Treat as no role?
    }
  }

  // Access Check: Must have a custom role OR be any non-customer role
  const hasCustomRole = !!user.roleId;
  const isNotCustomer = user.role !== 'customer';

  if (!hasCustomRole && !isNotCustomer) {
    return next(new AppError('Access denied. Admin privileges required.', 403));
  }

  // Check if user is active
  if (!user.isActive) {
    return next(new AppError('Your account has been deactivated. Please contact support.', 403));
  }

  // Check password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    return next(new AppError('Invalid credentials', 401));
  }

  // Aggregate user data
  const userData = await aggregateUserData(user._id);
  if (!userData) {
    return next(new AppError('Failed to load user data', 500));
  }

  // Generate token
  const token = generateToken({
    userId: user._id.toString(),
    email: user.email || undefined
  });

  // Send response
  res.status(200).json({
    success: true,
    message: 'Admin login successful',
    data: {
      user: {
        ...userData,
        role: roleName as any, // Override role with custom role name if compatible
        permissions     // Add permissions map
      },
      token
    }
  });
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
export const getMe = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthRequest;

  if (!authReq.user) {
    return next(new AppError('User not authenticated', 401));
  }

  const userData = await aggregateUserData(authReq.user.id);

  if (!userData) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      user: userData
    }
  });
});

// @desc    Add a new address for the authenticated user
// @route   POST /api/auth/addresses
// @access  Private
export const addAddress = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { label, fullAddress, area, coordinates, isDefault } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  if (!label || !fullAddress) {
    return next(new AppError('Label and full address are required', 400));
  }

  // Convert userId string to ObjectId
  const userIdObj = new mongoose.Types.ObjectId(userId);

  // Determine storage user: planHolderId if user has plan, else userId
  // This enables shared address pool for family plan members
  const storageUserId = await getPlanHolderId(userIdObj);

  // Check current address count (limit applies to plan holder's pool)
  const addressCount = await Address.countDocuments({ userId: storageUserId });
  if (addressCount >= 4) {
    return next(new AppError('Maximum limit of 4 addresses reached. Please delete an existing address to add a new one.', 400));
  }

  // Generate unique address ID
  const addressId = `addr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // If this is set as default, unset all other default addresses
  if (isDefault) {
    await Address.updateMany(
      { userId: storageUserId },
      { isDefault: false }
    );
  }

  // Create the address under the storage user (plan holder or self)
  const address = await Address.create({
    userId: storageUserId,
    id: addressId,
    label,
    fullAddress,
    area: area || undefined,
    coordinates: coordinates ? {
      lat: coordinates.lat,
      lng: coordinates.lng
    } : undefined,
    isDefault: isDefault || false
  });

  // Aggregate updated user data
  const userData = await aggregateUserData(userIdObj);

  res.status(201).json({
    success: true,
    data: {
      address: {
        id: address.id,
        label: address.label,
        fullAddress: address.fullAddress,
        area: address.area,
        coordinates: address.coordinates,
        isDefault: address.isDefault
      },
      user: userData
    }
  });
});

// @desc    Update an existing address for the authenticated user
// @route   PUT /api/auth/addresses/:id
// @access  Private
export const updateAddress = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { label, fullAddress, area, coordinates, isDefault } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  if (!label || !fullAddress) {
    return next(new AppError('Label and full address are required', 400));
  }

  // Convert userId string to ObjectId
  const userIdObj = new mongoose.Types.ObjectId(userId);

  // Get storage user for shared address pool
  const storageUserId = await getPlanHolderId(userIdObj);

  // Find the address in the shared pool
  const address = await Address.findOne({ userId: storageUserId, id });
  if (!address) {
    return next(new AppError('Address not found', 404));
  }

  // If this is set as default, unset all other default addresses
  if (isDefault) {
    await Address.updateMany(
      { userId: storageUserId, id: { $ne: id } },
      { isDefault: false }
    );
  }

  // Update the address
  address.label = label;
  address.fullAddress = fullAddress;
  if (area !== undefined) address.area = area;
  if (coordinates) {
    address.coordinates = {
      lat: coordinates.lat,
      lng: coordinates.lng
    };
  }
  address.isDefault = isDefault || false;
  await address.save();

  // Aggregate updated user data
  const userData = await aggregateUserData(userIdObj);

  res.status(200).json({
    success: true,
    data: {
      address: {
        id: address.id,
        label: address.label,
        fullAddress: address.fullAddress,
        area: address.area,
        coordinates: address.coordinates,
        isDefault: address.isDefault
      },
      user: userData
    }
  });
});

// @desc    Delete an address for the authenticated user
// @route   DELETE /api/auth/addresses/:id
// @access  Private
export const deleteAddress = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  // Convert userId string to ObjectId
  const userIdObj = new mongoose.Types.ObjectId(userId);

  // Get storage user for shared address pool
  const storageUserId = await getPlanHolderId(userIdObj);

  // Find the address in the shared pool
  const address = await Address.findOne({ userId: storageUserId, id });
  if (!address) {
    return next(new AppError('Address not found', 404));
  }

  // Check if pool has at least one address remaining
  const addressCount = await Address.countDocuments({ userId: storageUserId });
  if (addressCount <= 1) {
    return next(new AppError('Cannot delete the last address. You must have at least one address.', 400));
  }

  // Delete the address from shared pool
  await Address.deleteOne({ userId: storageUserId, id });

  // If deleted address was default, set the first remaining address as default
  if (address.isDefault) {
    const remainingAddress = await Address.findOne({ userId: storageUserId });
    if (remainingAddress) {
      remainingAddress.isDefault = true;
      await remainingAddress.save();
    }
  }

  // Aggregate updated user data
  const userData = await aggregateUserData(userIdObj);

  res.status(200).json({
    success: true,
    data: {
      user: userData
    }
  });
});

// @desc    Add a new family member for the authenticated user
// @route   POST /api/auth/family-members
// @access  Private
export const addFamilyMember = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { name, relation, phone, email } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  if (!name || !relation || !phone) {
    return next(new AppError('Name, relation, and phone are required', 400));
  }

  // Convert userId string to ObjectId
  const userIdObj = new mongoose.Types.ObjectId(userId);

  // Identify the plan holder (Primary account owner)
  const planHolderId = await getPlanHolderId(userIdObj);

  // Check plan limits for the shared pool
  const userPlan = await UserPlan.findOne({ userId: planHolderId });
  if (userPlan?.activePlanId) {
    const plan = await Plan.findById(userPlan.activePlanId);
    if (plan) {
      // Count total members added by the Plan Holder
      const currentMemberCount = await FamilyMember.countDocuments({ userId: planHolderId });
      // totalMembers includes the primary user
      if (currentMemberCount + 1 >= plan.totalMembers) {
        return next(new AppError(`The plan limit of ${plan.totalMembers} members (including primary) has been reached.`, 400));
      }
    }
  } else {
    // Default limit for users without a plan
    const currentMemberCount = await FamilyMember.countDocuments({ userId: planHolderId });
    if (currentMemberCount >= 5) {
      return next(new AppError('The limit of 5 family members has been reached.', 400));
    }
  }

  // Generate unique family member ID
  const memberId = `fam-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Create the family member under the Plan Holder's account
  const familyMember = await FamilyMember.create({
    userId: planHolderId,
    id: memberId,
    name,
    relation,
    phone,
    email: email || undefined
  });

  // Aggregate updated user data for the current user
  const userData = await aggregateUserData(userIdObj);

  // --- WhatsApp Notification (Added as Family) ---
  const referrer = await User.findById(userIdObj).select('name');
  if (referrer && referrer.name) {
    sendAddedAsFamilyMessage(familyMember.phone, familyMember.name, referrer.name)
      .catch(err => console.error('[AuthController] WhatsApp added as family msg failed:', err));
  }
  // ---------------------------------------------

  res.status(201).json({
    success: true,
    data: {
      familyMember: {
        id: familyMember.id,
        name: familyMember.name,
        relation: familyMember.relation,
        phone: familyMember.phone,
        email: familyMember.email
      },
      user: userData
    }
  });
});

// @desc    Delete a family member for the authenticated user
// @route   DELETE /api/auth/family-members/:id
// @access  Private
export const deleteFamilyMember = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  if (!id) {
    return next(new AppError('Family member ID is required', 400));
  }

  // Convert userId string to ObjectId
  const userIdObj = new mongoose.Types.ObjectId(userId);
  const planHolderId = await getPlanHolderId(userIdObj);

  // Find the family member and verify it belongs to the plan holder's group
  const familyMember = await FamilyMember.findOne({ userId: planHolderId, id });
  if (!familyMember) {
    return next(new AppError('Family member not found in your group', 404));
  }

  // Safety: Prevent user from deleting their own entry if they are a family member
  // (They would lose access to the shared plan)
  const currentUser = await User.findById(userIdObj);
  if (currentUser && currentUser.phone === familyMember.phone) {
    return next(new AppError('You cannot remove yourself from the shared plan. Please contact the primary account holder.', 400));
  }

  // Delete the family member
  await FamilyMember.deleteOne({ userId: userIdObj, id });

  // Aggregate updated user data
  const userData = await aggregateUserData(userIdObj);

  res.status(200).json({
    success: true,
    data: {
      user: userData
    }
  });
});

// @desc    Delete user account (Soft delete with anonymization)
// @route   DELETE /api/auth/delete-account
// @access  Private
export const deleteAccount = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  // Convert userId string to ObjectId
  const userIdObj = new mongoose.Types.ObjectId(userId);

  const user = await User.findById(userIdObj);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // 1. Delete all addresses
  await Address.deleteMany({ userId: userIdObj });

  // 2. Delete all family members
  await FamilyMember.deleteMany({ userId: userIdObj });

  // 3. Anonymize and deactivate user
  // We append timestamp to phone/email to allow re-registration with same credentials
  const timestamp = Date.now();

  user.isActive = false;
  user.isDeleted = true;
  user.phone = `deleted_${timestamp}_${user.phone}`;
  if (user.email) {
    user.email = `deleted_${timestamp}_${user.email}`;
  }

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Account deleted successfully'
  });
});

