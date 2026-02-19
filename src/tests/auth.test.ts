import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import mongoose from 'mongoose';

const VALID_ID = new mongoose.Types.ObjectId().toString();

// Mock asyncHandler BEFORE importing the controller
jest.mock('../middleware/asyncHandler', () => ({
    asyncHandler: (fn: any) => async (req: any, res: any, next: any) => {
        try {
            return await fn(req, res, next);
        } catch (error) {
            console.error('AsyncHandler caught error:', error);
            next(error);
        }
    }
}));

// Define standardized mock model factory
const mockModel = () => ({
    find: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockReturnThis(),
    findById: jest.fn().mockReturnThis(),
    findByIdAndUpdate: jest.fn().mockReturnThis(),
    findOneAndUpdate: jest.fn().mockReturnThis(),
    create: jest.fn(),
    save: jest.fn(),
    deleteMany: jest.fn(),
    deleteOne: jest.fn(),
    countDocuments: jest.fn(),
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    aggregate: jest.fn().mockReturnThis(),
    exec: jest.fn(),
});

// Mock models with factory
jest.mock('../models/User', () => mockModel());
jest.mock('../models/Address', () => mockModel());
jest.mock('../models/FamilyMember', () => mockModel());
jest.mock('../models/Role', () => mockModel());
jest.mock('../models/UserPlan', () => mockModel());
jest.mock('../models/Plan', () => mockModel());

// Mock services
jest.mock('../services/whatsappService', () => ({
    sendAddedAsFamilyMessage: jest.fn()
}));
jest.mock('../services/crmService');
jest.mock('../services/crmTaskService');
jest.mock('../utils/userHelpers');
jest.mock('../utils/generateToken');

import * as authController from '../controllers/authController';
import User from '../models/User';
import Address from '../models/Address';
import FamilyMember from '../models/FamilyMember';
import UserPlan from '../models/UserPlan';
import { aggregateUserData, getPlanHolderId } from '../utils/userHelpers';
import { generateToken } from '../utils/generateToken';
import { sendAddedAsFamilyMessage } from '../services/whatsappService';

describe('Auth Controller', () => {
    let mockReq: any;
    let mockRes: any;
    let mockNext: any;

    beforeEach(() => {
        mockReq = {
            body: {},
            params: {},
            user: { id: VALID_ID, email: 'test@test.com' }
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        mockNext = jest.fn();
        jest.clearAllMocks();

        // Restore default mocks cleared by resetMocks: true
        (UserPlan.findOne as any).mockResolvedValue(null);
        (FamilyMember.countDocuments as any).mockResolvedValue(0);
        (sendAddedAsFamilyMessage as any).mockResolvedValue({});
    });

    describe('signup', () => {
        it('should register a new user successfully', async () => {
            mockReq.body = {
                name: 'Test User',
                email: 'new@test.com',
                phone: '1234567890',
                password: 'password123'
            };

            (User.findOne as any).mockResolvedValue(null);
            (User.create as any).mockResolvedValue({
                _id: VALID_ID,
                email: 'new@test.com',
                name: 'Test User'
            });
            (aggregateUserData as any).mockResolvedValue({ id: VALID_ID, name: 'Test User' });
            (generateToken as any).mockReturnValue('mock-token');

            await authController.signup(mockReq, mockRes, mockNext);
            expect(mockRes.status).toHaveBeenCalledWith(201);
        });

        it('should fail if user already exists', async () => {
            mockReq.body = { email: 'exists@test.com' };
            (User.findOne as any).mockResolvedValue({ _id: 'u1' });

            await authController.signup(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
                statusCode: 400,
                message: 'User already exists with this email'
            }));
        });
    });

    describe('login', () => {
        it('should login successfully', async () => {
            mockReq.body = { email: 'test@test.com', password: 'password123' };
            const mockUser = {
                _id: VALID_ID,
                email: 'test@test.com',
                isActive: true,
                comparePassword: (jest.fn() as any).mockResolvedValue(true)
            };
            (User.findOne as any).mockReturnValue({
                select: (jest.fn() as any).mockResolvedValue(mockUser)
            });
            (aggregateUserData as any).mockResolvedValue({ id: VALID_ID });
            (generateToken as any).mockReturnValue('mock-token');

            await authController.login(mockReq, mockRes, mockNext);
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        it('should fail if user not found', async () => {
            mockReq.body = { email: 'non@test.com', password: 'pass' };
            (User.findOne as any).mockReturnValue({
                select: (jest.fn() as any).mockResolvedValue(null)
            });

            await authController.login(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
        });

        it('should fail if password incorrect', async () => {
            mockReq.body = { email: 'test@test.com', password: 'wrong' };
            const mockUser = {
                comparePassword: (jest.fn() as any).mockResolvedValue(false)
            };
            (User.findOne as any).mockReturnValue({
                select: (jest.fn() as any).mockResolvedValue(mockUser)
            });

            await authController.login(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
        });
    });

    describe('adminLogin', () => {
        it('should login admin successfully', async () => {
            mockReq.body = { email: 'admin@test.com', password: 'password123' };
            const mockUser = {
                _id: VALID_ID,
                email: 'admin@test.com',
                role: 'Admin',
                isActive: true,
                comparePassword: (jest.fn() as any).mockResolvedValue(true)
            };
            (User.findOne as any).mockReturnValue({
                select: (jest.fn() as any).mockResolvedValue(mockUser)
            });
            (aggregateUserData as any).mockResolvedValue({ id: VALID_ID });
            (generateToken as any).mockReturnValue('mock-token');

            await authController.adminLogin(mockReq, mockRes, mockNext);
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        it('should fail if user is not admin', async () => {
            mockReq.body = { email: 'user@test.com', password: 'password123' };
            const mockUser = {
                _id: VALID_ID,
                role: 'customer',
                isActive: true,
                comparePassword: (jest.fn() as any).mockResolvedValue(true)
            };
            (User.findOne as any).mockReturnValue({
                select: (jest.fn() as any).mockResolvedValue(mockUser)
            });

            await authController.adminLogin(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
                statusCode: 403,
                message: 'Access denied. Admin privileges required.'
            }));
        });
    });

    describe('getMe', () => {
        it('should get current user successfully', async () => {
            (aggregateUserData as any).mockResolvedValue({ id: VALID_ID, name: 'Test User' });
            await authController.getMe(mockReq, mockRes, mockNext);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: { user: { id: VALID_ID, name: 'Test User' } }
            }));
        });
    });

    describe('addAddress', () => {
        it('should add address successfully', async () => {
            mockReq.body = { label: 'Home', fullAddress: '123 St' };
            (getPlanHolderId as any).mockResolvedValue(VALID_ID);
            (Address.countDocuments as any).mockResolvedValue(0);
            (Address.create as any).mockResolvedValue({ id: 'a1' });
            (aggregateUserData as any).mockResolvedValue({ id: VALID_ID });

            await authController.addAddress(mockReq, mockRes, mockNext);
            expect(mockRes.status).toHaveBeenCalledWith(201);
        });

        it('should fail if address limit reached', async () => {
            mockReq.body = { label: 'Home', fullAddress: '123 St' };
            (getPlanHolderId as any).mockResolvedValue(VALID_ID);
            (Address.countDocuments as any).mockResolvedValue(4);

            await authController.addAddress(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
                statusCode: 400
            }));
        });
    });

    describe('updateAddress', () => {
        it('should update address successfully', async () => {
            mockReq.params = { id: 'a1' };
            mockReq.body = { label: 'Work', fullAddress: '456 St' };
            const mockAddress = { id: 'a1', save: (jest.fn() as any).mockResolvedValue(true) };
            (getPlanHolderId as any).mockResolvedValue(VALID_ID);
            (Address.findOne as any).mockResolvedValue(mockAddress);
            (aggregateUserData as any).mockResolvedValue({ id: VALID_ID });

            await authController.updateAddress(mockReq, mockRes, mockNext);
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });
    });

    describe('deleteAddress', () => {
        it('should delete address successfully', async () => {
            mockReq.params = { id: 'a1' };
            (getPlanHolderId as any).mockResolvedValue(VALID_ID);
            (Address.findOne as any).mockResolvedValue({ id: 'a1', isDefault: false });
            (Address.countDocuments as any).mockResolvedValue(2);
            (Address.deleteOne as any).mockResolvedValue(true);
            (aggregateUserData as any).mockResolvedValue({ id: VALID_ID });

            await authController.deleteAddress(mockReq, mockRes, mockNext);
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });
    });

    describe('addFamilyMember', () => {
        it('should add family member successfully', async () => {
            mockReq.body = { name: 'Sister', relation: 'Sister', phone: '123' };

            (getPlanHolderId as any).mockResolvedValue(VALID_ID);
            (UserPlan.findOne as any).mockResolvedValue(null);
            (FamilyMember.countDocuments as any).mockResolvedValue(0);

            (FamilyMember.create as any).mockResolvedValue({
                id: 'f1',
                name: 'Sister',
                phone: '123',
                relation: 'Sister',
                email: 'sis@test.com'
            });

            const mockUserQuery = {
                select: (jest.fn() as any).mockResolvedValue({ name: 'Primary' })
            };
            (User.findById as any).mockReturnValue(mockUserQuery);

            (aggregateUserData as any).mockResolvedValue({ id: VALID_ID });

            await authController.addFamilyMember(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(201);
        });
    });

    describe('deleteFamilyMember', () => {
        it('should delete family member', async () => {
            mockReq.params = { id: 'f1' };
            (getPlanHolderId as any).mockResolvedValue(VALID_ID);
            (FamilyMember.findOne as any).mockResolvedValue({ phone: '123' });
            (User.findById as any).mockResolvedValue({ phone: '456' });

            (FamilyMember.deleteOne as any).mockResolvedValue({});
            (aggregateUserData as any).mockResolvedValue({ id: VALID_ID });

            await authController.deleteFamilyMember(mockReq, mockRes, mockNext);
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        it('should fail if family member not found', async () => {
            mockReq.params = { id: 'f1' };
            (getPlanHolderId as any).mockResolvedValue(VALID_ID);
            (FamilyMember.findOne as any).mockResolvedValue(null);

            await authController.deleteFamilyMember(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
                statusCode: 404
            }));
        });
    });

    describe('deleteAccount', () => {
        it('should delete account', async () => {
            const mockUser = { _id: VALID_ID, save: (jest.fn() as any).mockResolvedValue(true) };
            (User.findById as any).mockResolvedValue(mockUser);
            (Address.deleteMany as any).mockResolvedValue({});
            (FamilyMember.deleteMany as any).mockResolvedValue({});
            await authController.deleteAccount(mockReq, mockRes, mockNext);
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        it('should fail if user not found', async () => {
            (User.findById as any).mockResolvedValue(null);
            await authController.deleteAccount(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
                statusCode: 404
            }));
        });
    });
});
