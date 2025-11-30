import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
// import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import connectDB from './config/database';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
import bookingRoutes from './routes/bookingRoutes';
import { errorHandler, notFound } from './middleware/errorHandler';

// Load environment variables
dotenv.config();

console.log('🚀 Starting BeforeU Backend Server...');
console.log(`📁 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔌 Port: ${process.env.PORT || 5000}`);

const app: Application = express();

// Connect to database (non-blocking - server will start even if DB fails)
connectDB().catch((error) => {
  console.error('Failed to connect to database:', error);
  console.error('Server will continue but database operations will fail');
  // Don't exit - allow server to start for testing
  // process.exit(1);
});

// Security middleware
app.use(helmet());

// CORS configuration - Allow both customer platform and admin panel
const allowedOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : ['http://localhost:3000', 'http://localhost:3001']; // Customer platform and admin panel

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
// const limiter = rateLimit({
//   windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
//   max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // limit each IP to 100 requests per windowMs
//   message: 'Too many requests from this IP, please try again later.'
// });
// app.use('/api/', limiter);

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
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', bookingRoutes);
console.log('✅ Routes registered successfully');

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000

// Verify routes are registered before starting server
console.log('🔍 Verifying route registration...');
const routes = app._router?.stack || [];
console.log(`✅ Found ${routes.length} middleware/routes registered`);

app.listen(PORT, () => {
  console.log(`\n✅ ==========================================`);
  console.log(`🚀 Server SUCCESSFULLY started!`);
  console.log(`📍 Listening on 0.0.0.0:${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
}).on('error', (err: any) => {
  console.error('❌ Server failed to start:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Kill the process or use a different port.`);
  }
  process.exit(1);
});

export default app;

