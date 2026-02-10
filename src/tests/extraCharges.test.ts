import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import crypto from 'crypto';

// Mock asyncHandler BEFORE importing the controller
jest.mock('../middleware/asyncHandler', () => ({
    asyncHandler: (fn: any) => async (req: any, res: any, next: any) => {
        try {
            return await fn(req, res, next);
        } catch (error) {
            next(error);
        }
    }
}));

// Mock paymentController BEFORE importing extraChargesController
jest.mock('../controllers/paymentController', () => ({
    getRazorpayInstance: jest.fn()
}));

import * as extraChargesController from '../controllers/extraChargesController';
import OrderItem from '../models/OrderItem';
import Booking from '../models/Booking';
import ServicePartner from '../models/ServicePartner';
import * as paymentController from '../controllers/paymentController';

// Mock models
jest.mock('../models/OrderItem');
jest.mock('../models/Booking');
jest.mock('../models/ServicePartner');

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('Extra Charges Controller', () => {
    let mockReq: any;
    let mockRes: any;
    let mockNext: any;
    let mockRazorpay: any;

    beforeEach(() => {
        process.env.RAZORPAY_API_SECRET = 'test-secret';
        process.env.RAZORPAY_KEY_ID = 'test-key';

        mockReq = {
            params: {},
            body: {},
            user: { id: 'u1', name: 'User', phone: '123', role: 'customer' }
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        mockNext = jest.fn();

        mockRazorpay = {
            orders: {
                create: (jest.fn() as any).mockResolvedValue({ id: 'order_123', amount: 10000, currency: 'INR' })
            }
        };
        (paymentController.getRazorpayInstance as jest.Mock).mockReturnValue(mockRazorpay);

        (mockFetch as any).mockReset();
        jest.clearAllMocks();
    });

    describe('addExtraCharge', () => {
        it('should add an extra charge successfully', async () => {
            mockReq.params = { id: 'item-1' };
            mockReq.body = { amount: 100, description: 'Test charge' };
            mockReq.user = { id: 'p1', phone: '123', role: 'ServicePartner' };

            const mockJob: any = {
                _id: 'i1',
                status: 'reached',
                extraCharges: [],
                save: (jest.fn() as any).mockResolvedValue(true)
            };
            const mockPartner = { _id: 'p1', name: 'Partner' };
            const mockBooking = { _id: 'b1', actionLog: [], save: (jest.fn() as any).mockResolvedValue(true) };

            (ServicePartner.findOne as any).mockResolvedValue(mockPartner);
            (OrderItem.findOne as any).mockReturnValue({
                populate: (jest.fn() as any).mockResolvedValue(mockJob)
            });
            (Booking.findById as any).mockResolvedValue(mockBooking);

            await extraChargesController.addExtraCharge(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(201);
            expect(mockJob.extraCharges.length).toBe(1);
            expect(mockJob.extraCharges[0].amount).toBe(100);
        });
    });

    describe('createExtraChargeOrder', () => {
        it('should create a Razorpay QR code', async () => {
            mockReq.params = { id: 'item-1', chargeId: 'c1' };
            mockReq.user = { id: 'p1', phone: '123', role: 'ServicePartner' };

            const mockJob: any = {
                _id: 'i1',
                bookingId: { _id: 'b1', bookingId: 'BOOK-123' },
                extraCharges: [{ id: 'c1', status: 'pending', amount: 100, description: 'Test' }],
                save: (jest.fn() as any).mockResolvedValue(true)
            };
            const mockPartner = { _id: 'p1', name: 'Partner' };

            (ServicePartner.findOne as any).mockResolvedValue(mockPartner);
            (OrderItem.findOne as any).mockReturnValue({
                populate: (jest.fn() as any).mockResolvedValue(mockJob)
            });

            (mockFetch as any).mockResolvedValue({
                ok: true,
                json: (jest.fn() as any).mockResolvedValue({
                    id: 'qr_123',
                    image_url: 'http://qr.url',
                    status: 'active'
                })
            } as any);

            await extraChargesController.createExtraChargeOrder(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    qrId: 'qr_123'
                })
            }));
        });
    });

    describe('createCustomerPaymentOrder', () => {
        it('should create order', async () => {
            mockReq.params = { bookingId: 'b1', itemId: 'i1', chargeId: 'c1' };
            mockReq.user = { id: 'u1', name: 'User', phone: '123' };

            const mockBooking = { _id: 'b1', bookingId: 'B-1', userId: 'u1' };
            const mockJob: any = {
                _id: 'i1',
                extraCharges: [{ id: 'c1', status: 'pending', amount: 100, description: 'Test' }],
                save: (jest.fn() as any).mockResolvedValue(true)
            };

            (Booking.findOne as any).mockResolvedValue(mockBooking);
            (OrderItem.findOne as any).mockResolvedValue(mockJob);

            await extraChargesController.createCustomerPaymentOrder(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    orderId: 'order_123'
                })
            }));
        });
    });

    describe('verifyExtraChargePayment', () => {
        it('should verify payment successfully using signature', async () => {
            const orderId = 'order_123';
            const paymentId = 'pay_123';
            const signature = crypto.createHmac('sha256', 'test-secret')
                .update(`${orderId}|${paymentId}`)
                .digest('hex');

            mockReq.params = { id: 'item-1', chargeId: 'c1' };
            mockReq.body = {
                razorpay_order_id: orderId,
                razorpay_payment_id: paymentId,
                razorpay_signature: signature
            };
            mockReq.user = { phone: '123' };

            const mockJob: any = {
                _id: 'i1',
                extraCharges: [{ id: 'c1', status: 'pending', amount: 100, description: 'Test' }],
                save: (jest.fn() as any).mockResolvedValue(true)
            };
            const mockBooking = { _id: 'b1', actionLog: [], save: (jest.fn() as any).mockResolvedValue(true) };

            (ServicePartner.findOne as any).mockResolvedValue({ name: 'Partner' });
            (OrderItem.findOne as any).mockReturnValue({
                populate: (jest.fn() as any).mockResolvedValue(mockJob)
            });
            (Booking.findById as any).mockResolvedValue(mockBooking);

            await extraChargesController.verifyExtraChargePayment(mockReq, mockRes, mockNext);

            expect(mockJob.extraCharges[0].status).toBe('paid');
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        it('should fail if signature is invalid', async () => {
            mockReq.params = { id: 'item-1', chargeId: 'c1' };
            mockReq.body = {
                razorpay_order_id: 'o1',
                razorpay_payment_id: 'p1',
                razorpay_signature: 'invalid'
            };
            (ServicePartner.findOne as any).mockResolvedValue({ name: 'Partner' });
            (OrderItem.findOne as any).mockReturnValue({
                populate: (jest.fn() as any).mockResolvedValue({
                    extraCharges: [{ id: 'c1', status: 'pending' }]
                })
            });

            await extraChargesController.verifyExtraChargePayment(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
        });
    });

    describe('checkPaymentStatus', () => {
        it('should verify polling status successfully', async () => {
            mockReq.params = { id: 'item-1', chargeId: 'c1' };
            mockReq.user = { phone: '123' };
            const mockJob: any = {
                _id: 'i1',
                extraCharges: [{ id: 'c1', status: 'pending', razorpayQrId: 'qr_123', amount: 100, description: 'Test' }],
                save: (jest.fn() as any).mockResolvedValue(true)
            };
            const mockBooking = { _id: 'b1', actionLog: [], save: (jest.fn() as any).mockResolvedValue(true) };

            (ServicePartner.findOne as any).mockResolvedValue({ name: 'Partner' });
            (OrderItem.findOne as any).mockReturnValue({
                populate: (jest.fn() as any).mockResolvedValue(mockJob)
            });
            (Booking.findById as any).mockResolvedValue(mockBooking);

            (mockFetch as any).mockResolvedValue({
                ok: true,
                json: (jest.fn() as any).mockResolvedValue({
                    status: 'closed',
                    payments_count_received: 1
                })
            } as any);

            await extraChargesController.checkPaymentStatus(mockReq, mockRes, mockNext);

            expect(mockJob.extraCharges[0].status).toBe('paid');
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });
    });

    describe('confirmCashPayment', () => {
        it('should confirm cash payment', async () => {
            mockReq.params = { id: 'item-1', chargeId: 'c1' };
            mockReq.body = { confirmation: true };
            mockReq.user = { phone: '123' };

            const mockJob: any = {
                _id: 'i1',
                extraCharges: [{ id: 'c1', status: 'pending', amount: 100, description: 'test' }],
                save: (jest.fn() as any).mockResolvedValue(true)
            };
            const mockPartner = { _id: 'p1', name: 'Partner' };
            const mockBooking = { _id: 'b1', actionLog: [], save: (jest.fn() as any).mockResolvedValue(true) };

            (ServicePartner.findOne as any).mockResolvedValue(mockPartner);
            (OrderItem.findOne as any).mockReturnValue({
                populate: (jest.fn() as any).mockResolvedValue(mockJob)
            });
            (Booking.findById as any).mockResolvedValue(mockBooking);

            await extraChargesController.confirmCashPayment(mockReq, mockRes, mockNext);

            expect(mockJob.extraCharges[0].status).toBe('paid');
            expect(mockJob.extraCharges[0].paymentMethod).toBe('cash');
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });
    });
});
