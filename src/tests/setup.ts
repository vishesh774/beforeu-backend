import { jest } from '@jest/globals';

// Mock Constants
jest.mock('../constants/bookingStatus', () => ({
    BookingStatus: {
        PENDING: 'pending',
        CONFIRMED: 'confirmed',
        ASSIGNED: 'assigned',
        EN_ROUTE: 'en_route',
        REACHED: 'reached',
        IN_PROGRESS: 'in_progress',
        ON_HOLD: 'on_hold',
        COMPLETED: 'completed',
        CANCELLED: 'cancelled',
        REFUND_INITIATED: 'refund_initiated',
        REFUNDED: 'refunded'
    },
    COMPLETED_BOOKING_STATUSES: ['completed', 'cancelled', 'refund_initiated', 'refunded'],
    ACTIVE_BOOKING_STATUSES: ['pending', 'confirmed', 'assigned', 'en_route', 'reached', 'in_progress', 'on_hold'],
    ONGOING_BOOKING_STATUSES: ['assigned', 'en_route', 'reached', 'in_progress', 'on_hold']
}));

// Mock uuid
jest.mock('uuid', () => ({
    v4: jest.fn().mockReturnValue('mocked-uuid')
}));

// Mock Mongoose
jest.mock('mongoose', () => {
    const actualMongoose = jest.requireActual('mongoose') as any;
    return {
        ...actualMongoose,
        connect: (jest.fn() as any).mockResolvedValue(actualMongoose),
        connection: {
            on: jest.fn(),
            once: jest.fn(),
            close: (jest.fn() as any).mockResolvedValue(true)
        },
        model: jest.fn().mockImplementation(((_name: string, schema: any) => {
            return {
                find: jest.fn().mockReturnThis(),
                findOne: jest.fn().mockReturnThis(),
                findById: jest.fn().mockReturnThis(),
                findByIdAndUpdate: jest.fn().mockReturnThis(),
                findOneAndUpdate: jest.fn().mockReturnThis(),
                create: jest.fn(),
                save: jest.fn(),
                deleteMany: jest.fn(),
                countDocuments: jest.fn(),
                populate: jest.fn().mockReturnThis(),
                sort: jest.fn().mockReturnThis(),
                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                aggregate: jest.fn().mockReturnThis(),
                exec: jest.fn(),
                schema: schema
            };
        }) as any)
    };
});

// Mock Razorpay
jest.mock('razorpay', () => {
    return jest.fn().mockImplementation(() => ({
        orders: {
            create: jest.fn()
        },
        payments: {
            fetch: jest.fn(),
            capture: jest.fn()
        }
    }));
});

// Mock Firebase Admin
jest.mock('firebase-admin', () => ({
    initializeApp: jest.fn(),
    credential: {
        cert: jest.fn()
    },
    messaging: jest.fn().mockReturnValue({
        send: jest.fn(),
        sendToDevice: jest.fn(),
        sendMulticast: jest.fn()
    }),
    firestore: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        set: jest.fn(),
        get: jest.fn()
    })
}));

// Mock process.env
process.env.JWT_SECRET = 'test-secret';
process.env.RAZORPAY_KEY_ID = 'test-key';
process.env.RAZORPAY_API_SECRET = 'test-secret';
