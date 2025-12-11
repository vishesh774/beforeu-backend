import { Request, Response, NextFunction } from 'express';
// import jwt from 'jsonwebtoken'; // Unused
import { AppError } from '../middleware/errorHandler';
import ServicePartner from '../models/ServicePartner';
import { verifyToken } from '../utils/generateToken';

export const protectPartner = async (req: Request, _res: Response, next: NextFunction) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return next(new AppError('Not authorized to access this route', 401));
    }

    try {
        const decoded = verifyToken(token);

        const partner = await ServicePartner.findById(decoded.userId);

        if (!partner) {
            return next(new AppError('No partner found with this id', 404));
        }

        if (!partner.isActive) {
            return next(new AppError('This partner account is inactive', 403));
        }

        (req as any).user = partner;
        next();
    } catch (error) {
        return next(new AppError('Not authorized to access this route', 401));
    }
};
