import mongoose from 'mongoose';

const connectDB = async (): Promise<void> => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      const error = new Error('MONGODB_URI is not defined in environment variables');
      console.error('❌', error.message);
      throw error;
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
    
    // Ensure connection is ready before proceeding
    if (mongoose.connection.readyState !== 1) {
      throw new Error('MongoDB connection not ready after connect');
    }
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error);
    throw error; // Re-throw to allow caller to handle
  }
};

export default connectDB;

