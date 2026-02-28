import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
// import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import connectDB from './config/database';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
import bookingRoutes from './routes/bookingRoutes';
import paymentRoutes from './routes/paymentRoutes';
import partnerRoutes from './routes/partnerRoutes';
import providerRoutes from './routes/providerRoutes';
import sosRoutes from './routes/sosRoutes';
import configRoutes from './routes/configRoutes';
import couponRoutes from './routes/couponRoutes';
import roleRoutes from './routes/roleRoutes';
import reviewRoutes from './routes/reviewRoutes';
import referralRoutes from './routes/referralRoutes';
import { errorHandler, notFound } from './middleware/errorHandler';



// Load environment variables
dotenv.config();

console.log('🚀 Starting BeforeU Backend Server...');
console.log(`📁 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔌 Port: ${process.env.PORT || 5000}`);

// Validate Razorpay environment variables (warn only, don't fail startup)
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_API_SECRET) {
  console.warn('⚠️  WARNING: Razorpay credentials not configured. Payment features will not work.');
  console.warn('   Please set RAZORPAY_KEY_ID and RAZORPAY_API_SECRET environment variables.');
} else {
  console.log('✅ Razorpay credentials configured');
}

const app: Application = express();

// Security middleware
app.use(helmet());

// CORS configuration - Allow both customer platform and admin panel
const defaultOrigins = [
  'https://beforeu-customer-platform.vercel.app',
  'https://beforeu-admin-dashboard.vercel.app',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:19000', // Expo
  'http://localhost:8081'   // React Native/Metro
];

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : defaultOrigins;

// In production, log allowed origins for debugging
if (process.env.NODE_ENV === 'production') {
  console.log('🌐 CORS Allowed Origins:', allowedOrigins);
}

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps, curl requests, or server-to-server)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Log blocked origin in production for debugging
      if (process.env.NODE_ENV === 'production') {
        console.warn(`⚠️ CORS blocked origin: ${origin}`);
        console.warn(`   Allowed origins: ${allowedOrigins.join(', ')}`);
      }
      callback(new Error(`Not allowed by CORS. Origin: ${origin}`));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Body parser middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
// const limiter = rateLimit({
//   windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
//   max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // limit each IP to 100 requests per windowMs
//   message: 'Too many requests from this IP, please try again later.'
// });
// app.use('/api/', limiter);

// Request logging middleware
app.use((req, _res, next) => {
  console.log(`[API-AUDIT] ${req.method} ${req.url}`);
  next();
});

// Routes
console.log('📝 Registering routes...');

// Root route for testing
app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'BeforeU API Server',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth'
    }
  });
});

app.get('/health', (_req, res) => {
  console.log('✅ Health endpoint called');
  res.status(200).json({
    success: true,
    message: 'Server is running - LOCAL_DEBUG_V1',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api', bookingRoutes);
app.use('/api', paymentRoutes);
app.use('/api/partners', partnerRoutes);
app.use('/api/provider', providerRoutes);
app.use('/api/sos', sosRoutes);
app.use('/api', configRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/referral', referralRoutes);
console.log('✅ Routes registered successfully');

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

// Read PORT from environment - fly.io sets this automatically
// Must match internal_port in fly.toml (5000)
// If PORT is set incorrectly (e.g., 5001), force it to 5000 for fly.io compatibility
let PORT = parseInt(process.env.PORT || '5000', 10);

// Log port configuration for debugging
console.log(`🔌 Environment PORT: ${process.env.PORT || 'not set'}`);
console.log(`🔌 Initial PORT: ${PORT}`);

// Force PORT to 5000 if it's not 5000 (fly.io expects 5000 based on internal_port)
if (PORT !== 5000) {
  console.warn(`⚠️  WARNING: PORT is ${PORT}, but fly.io expects 5000. Overriding to 5000.`);
  PORT = 5000;
}

console.log(`🔌 Using PORT: ${PORT}`);

// Verify routes are registered before starting server
console.log('🔍 Verifying route registration...');
const routes = app._router?.stack || [];
console.log(`✅ Found ${routes.length} middleware/routes registered`);

import http from 'http';
import { socketService } from './services/socketService';
import { initScheduler } from './services/schedulerService';

// Connect to database and then start server
const startServer = async () => {
  try {
    console.log('🔄 Connecting to database...');
    await connectDB();
    console.log('✅ Database connection established');

    // Initialize Scheduler
    initScheduler();

    // Create HTTP server wrapping the Express app
    const server = http.createServer(app);

    // Initialize Socket Service
    console.log('🔄 Initializing Socket Service...');
    socketService.initialize(server, allowedOrigins);

    server.listen(PORT, '0.0.0.0', () => {
      // Get the bound address info
      const address = server.address();
      const actualPort = address && typeof address === 'object' ? address.port : PORT;

      console.log(`\n✅ ==========================================`);
      console.log(`🚀 Server SUCCESSFULLY started!`);
      console.log(`📍 Listening on 0.0.0.0:${actualPort}`);
      console.log(`📍 Expected PORT: ${PORT}`);
      console.log(`📍 Actual PORT: ${actualPort}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📍 Database: Connected`);
      console.log(`📍 Socket.io: Active (Room: 'admin_room')`);

      if (actualPort !== PORT) {
        console.warn(`⚠️  WARNING: Port mismatch! Expected ${PORT}, but listening on ${actualPort}`);
      }
    });

    // Handle server errors related to starting (like EADDRINUSE)
    server.on('error', (err: any) => {
      console.error('❌ Server failed to start:', err);
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Kill the process or use a different port.`);
      }
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    console.error('❌ Server cannot start without database connection');
    process.exit(1);
  }
};

startServer();

export default app;

