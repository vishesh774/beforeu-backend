import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import mongoose from 'mongoose';

const VALID_ID = new mongoose.Types.ObjectId().toString();

// Mock asyncHandler
jest.mock('../middleware/asyncHandler', () => ({
    asyncHandler: (fn: any) => async (req: any, res: any, next: any) => {
        try {
            return await fn(req, res, next);
        } catch (error) {
            console.error('Test Async Handler Caught:', error);
            next(error);
        }
    }
}));

// Mock Model Factory
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
    insertMany: jest.fn(),
});

// Mock ALL Models used in BookingController
jest.mock('../models/Service', () => mockModel());
jest.mock('../models/ServiceVariant', () => mockModel());
jest.mock('../models/ServiceRegion', () => mockModel());
jest.mock('../models/Booking', () => mockModel());
jest.mock('../models/OrderItem', () => mockModel());
jest.mock('../models/Coupon', () => mockModel());
jest.mock('../models/Address', () => mockModel());
jest.mock('../models/UserCredits', () => mockModel());
jest.mock('../models/UserPlan', () => mockModel());
jest.mock('../models/Plan', () => mockModel());
jest.mock('../models/PlanTransaction', () => mockModel());
jest.mock('../models/Review', () => mockModel());
jest.mock('../models/SOSAlert', () => mockModel());
jest.mock('../models/ServicePartner', () => mockModel());
jest.mock('../models/ServiceLocation', () => mockModel());
jest.mock('../models/User', () => mockModel());
jest.mock('../models/FamilyMember', () => mockModel());

// Mock Utils and Services
jest.mock('../utils/checkoutUtils', () => ({
    getActiveCheckoutFields: jest.fn(),
    calculateCheckoutTotal: jest.fn()
}));
jest.mock('../utils/pointInPolygon', () => ({
    isPointInPolygon: jest.fn()
}));
jest.mock('../services/bookingService', () => ({
    autoAssignServicePartner: jest.fn(),
    isPartnerAvailableAtTime: jest.fn(),
    syncBookingStatus: jest.fn()
}));
jest.mock('../utils/userHelpers', () => ({
    getPlanHolderId: jest.fn()
}));
jest.mock('../services/whatsappService', () => ({
    sendBookingAssignmentMessage: jest.fn()
}));
jest.mock('../utils/systemServices', () => ({
    getSOSService: jest.fn()
}));
jest.mock('../services/pushNotificationService', () => ({
    sendSosNotification: jest.fn(),
    sendJobNotification: jest.fn()
}));
jest.mock('../services/socketService', () => ({
    socketService: {
        emit: jest.fn()
    }
}));

import * as bookingController from '../controllers/bookingController';
import Service from '../models/Service';
import ServiceVariant from '../models/ServiceVariant';
import Booking from '../models/Booking';
import { getActiveCheckoutFields, calculateCheckoutTotal } from '../utils/checkoutUtils';
import { getPlanHolderId } from '../utils/userHelpers';
import UserPlan from '../models/UserPlan';
import Address from '../models/Address';
import UserCredits from '../models/UserCredits';
import OrderItem from '../models/OrderItem';


describe('Booking Controller', () => {
    let mockReq: any;
    let mockRes: any;
    let mockNext: any;

    beforeEach(() => {
        mockReq = {
            body: {},
            query: {},
            params: {},
            user: { id: VALID_ID }
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        mockNext = jest.fn();
        jest.clearAllMocks();
    });

    describe('getAllServices', () => {
        it('should return all active services with variants', async () => {
            const mockServices = [
                { _id: 's1', id: 's1', name: 'Service 1', isActive: true, icon: 'icon' }
            ];
            const mockVariants = [
                { serviceId: 's1', name: 'Variant 1', isActive: true, price: 100 }
            ];

            (Service.find as any).mockReturnValue({
                sort: (jest.fn() as any).mockResolvedValue(mockServices)
            });
            (ServiceVariant.find as any).mockReturnValue({
                sort: (jest.fn() as any).mockResolvedValue(mockVariants)
            });

            await bookingController.getAllServices(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    services: expect.arrayContaining([
                        expect.objectContaining({
                            id: 's1',
                            subServicesNames: expect.arrayContaining(['Variant 1'])
                        })
                    ])
                })
            }));
        });

        it('should handle empty services list', async () => {
            (Service.find as any).mockReturnValue({
                sort: (jest.fn() as any).mockResolvedValue([])
            });
            (ServiceVariant.find as any).mockReturnValue({
                sort: (jest.fn() as any).mockResolvedValue([])
            });

            await bookingController.getAllServices(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                data: { services: [] }
            }));
        });
    });

    describe('createBooking', () => {
        it('should create a booking successfully', async () => {
            mockReq.body = {
                addressId: 'addr1',
                items: [{ variantId: 'v1', quantity: 1 }],
                bookingType: 'SCHEDULED',
                scheduledDate: '2023-01-01',
                scheduledTime: '10:00'
            };

            const mockVariant = {
                id: 'v1',
                _id: 'v1_obj',
                serviceId: 's1',
                finalPrice: 100,
                creditValue: 10,
                availableForPurchase: true,
                serviceType: 'In-Person',
                estimatedTimeMinutes: 60,
                isActive: true,
                originalPrice: 100
            };

            // Mock dependencies
            (getPlanHolderId as any).mockResolvedValue(VALID_ID);
            (UserPlan.findOne as any).mockResolvedValue(null); // No active plan

            // Mock Address and UserCredits
            (Address.findOne as any).mockResolvedValue({ id: 'addr1' });
            (UserCredits.findOne as any).mockResolvedValue(null);

            // Mock OrderItem.insertMany
            (OrderItem.insertMany as any).mockResolvedValue([]);

            // Mock OrderItem.find with populate chain
            const mockOrderItemsWithDetails = [{
                serviceId: { id: 's1', toString: () => 's1' },
                serviceVariantId: { id: 'v1', toString: () => 'v1' },
                serviceName: 'Service 1',
                variantName: 'Variant 1',
                finalPrice: 100,
                originalPrice: 100,
                creditValue: 10
            }];

            (OrderItem.find as any).mockImplementation(() => ({
                populate: jest.fn().mockReturnValue({
                    populate: (jest.fn() as any).mockResolvedValue(mockOrderItemsWithDetails)
                })
            }));

            (ServiceVariant.findOne as any).mockImplementation(() => ({
                populate: (jest.fn() as any).mockResolvedValue(mockVariant)
            }));
            (Service.findById as any).mockResolvedValue({
                _id: 's1',
                isActive: true,
                name: 'Service 1'
            });

            (getActiveCheckoutFields as any).mockResolvedValue([]);
            (calculateCheckoutTotal as any).mockResolvedValue({
                subTotal: 100,
                taxAmount: 10,
                totalAmount: 110,
                total: 110,
                breakdown: []
            });

            (Booking.create as any).mockResolvedValue({
                id: 'b1',
                bookingId: 'B-123',
                totalAmount: 110,
                createdAt: new Date(),
                status: 'pending',
                paymentStatus: 'pending'
            });

            await bookingController.createBooking(mockReq, mockRes, mockNext);

            if (mockRes.status.mock.calls.length === 0) {
                // Check next calls
                console.log('DEBUG: mockNext called:', mockNext.mock.calls);
            }

            expect(mockRes.status).toHaveBeenCalledWith(201);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    booking: expect.objectContaining({
                        bookingId: 'B-123'
                    })
                })
            }));
        });

        it('should fail if addressId is missing', async () => {
            mockReq.body = {
                items: [{ variantId: 'v1', quantity: 1 }],
                bookingType: 'On-Demand'
            };

            await bookingController.createBooking(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
                statusCode: 400,
                message: 'Address ID and items are required'
            }));
        });
    });
});
