import mongoose from 'mongoose';

const connectDB = async (): Promise<void> => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      console.warn('⚠️  MONGODB_URI is not defined in environment variables');
      console.warn('⚠️  Server will start but database operations will fail');
      return;
    }

    // Connection options optimized for cloud deployments (Fly.io, etc.)
    const options = {
      serverSelectionTimeoutMS: 60000, // 60 seconds - increased for cloud deployments
      socketTimeoutMS: 45000, // 45 seconds
      connectTimeoutMS: 30000, // 30 seconds
      retryWrites: true,
      retryReads: true,
      maxPoolSize: 10, // Maintain up to 10 socket connections
      minPoolSize: 2, // Maintain at least 2 socket connections
    };

    const conn = await mongoose.connect(mongoURI, options);

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error);
    console.warn('⚠️  Server will continue but database operations will fail');
    // Don't exit - allow server to start for testing
    // process.exit(1);
  }
};

export default connectDB;

