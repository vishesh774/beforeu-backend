import mongoose from 'mongoose';

const connectDB = async (): Promise<void> => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      console.warn('⚠️  MONGODB_URI is not defined in environment variables');
      console.warn('⚠️  Server will start but database operations will fail');
      return;
    }

    const conn = await mongoose.connect(mongoURI);

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error);
    console.warn('⚠️  Server will continue but database operations will fail');
    // Don't exit - allow server to start for testing
    // process.exit(1);
  }
};

export default connectDB;

