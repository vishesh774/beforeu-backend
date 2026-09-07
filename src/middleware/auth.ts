import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/generateToken';
import User from '../models/User';
import { AppError } from './errorHandler';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    phone: string;
    name: string;
    role: string;
  };
}

// Grant access to specific roles
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new AppError(
          `User role ${req.user?.role} is not authorized to access this route`,
          403
        )
      );
    }
    next();
  };
};

export const protect = async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
  try {
    let token: string | undefined;

    // Get token from header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      console.warn(`[AUTH-PROTECT] No token provided for: ${req.method} ${req.url}`);
      throw new AppError('Not authorized to access this route', 401);
    }

    // Verify token
    const decoded = verifyToken(token);
    console.log(`[AUTH-PROTECT] Token verified for user ID: ${decoded.userId}`);

    // Get user from token
    const user = await User.findById(decoded.userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Attach user to request
    req.user = {
      id: user._id.toString(),
      email: user?.email || '',
      phone: user.phone,
      name: user.name || '',
      role: user.role || 'customer'
    };

    next();
  } catch (error) {
    if (error instanceof Error && error.name === 'JsonWebTokenError') {
      next(new AppError('Invalid token', 401));
    } else if (error instanceof Error && error.name === 'TokenExpiredError') {
      next(new AppError('Token expired', 401));
    } else {
      next(error);
    }
  }
};

/**
 * Populates `req.user` when a valid token is present, but never rejects the request.
 *
 * For endpoints that are public but personalise their response — the plans storefront, for example,
 * which must stay reachable to logged-out visitors while still revealing restricted plans to the
 * customers they belong to. An invalid or expired token is treated the same as no token at all.
 */
export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.headers.authorization?.startsWith('Bearer')) {
      return next();
    }

    const token = req.headers.authorization.split(' ')[1];
    if (!token) {
      return next();
    }

    const decoded = verifyToken(token);
    const user = await User.findById(decoded.userId);

    if (user) {
      req.user = {
        id: user._id.toString(),
        email: user?.email || '',
        phone: user.phone,
        name: user.name || '',
        role: user.role || 'customer'
      };
    }
  } catch {
    // Anonymous is a valid outcome here — fall through without a user.
  }

  next();
};

