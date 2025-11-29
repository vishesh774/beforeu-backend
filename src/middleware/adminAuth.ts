import { Request, Response, NextFunction } from 'express';
import { protect, AuthRequest } from './auth';
import User from '../models/User';
import { AppError } from './errorHandler';

export interface AdminRequest extends AuthRequest {
  adminUser?: {
    id: string;
    email: string;
    role: string;
  };
}

/**
 * Middleware to protect admin routes
 * Requires authentication AND admin role (Admin, Supervisor, or Incharge)
 */
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // First check authentication
  await protect(req as AuthRequest, res, async () => {
    try {
      const authReq = req as AuthRequest;
      
      if (!authReq.user) {
        return next(new AppError('Not authorized to access this route', 401));
      }

      // Get full user details including role
      const user = await User.findById(authReq.user.id);
      if (!user) {
        return next(new AppError('User not found', 404));
      }

      // Check if user is active
      if (!user.isActive) {
        return next(new AppError('Your account has been deactivated', 403));
      }

      // Check if user has admin role
      const adminRoles: Array<'Admin' | 'Supervisor' | 'Incharge'> = ['Admin', 'Supervisor', 'Incharge'];
      if (!adminRoles.includes(user.role as 'Admin' | 'Supervisor' | 'Incharge')) {
        return next(new AppError('Admin privileges required', 403));
      }

      // Attach admin user to request
      (req as AdminRequest).adminUser = {
        id: user._id.toString(),
        email: user.email,
        role: user.role
      };

      next();
    } catch (error) {
      next(error);
    }
  });
};

