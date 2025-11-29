import mongoose, { Document, Schema } from 'mongoose';

export interface IPoint {
  lat: number;
  lng: number;
}

export interface IServiceRegion extends Document {
  name: string;
  city: string;
  polygon: IPoint[]; // Array of coordinates forming a closed polygon
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PointSchema = new Schema({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true }
}, { _id: false });

const ServiceRegionSchema = new Schema<IServiceRegion>(
  {
    name: {
      type: String,
      required: [true, 'Please provide a region name'],
      trim: true,
      minlength: [2, 'Region name must be at least 2 characters'],
      maxlength: [100, 'Region name cannot exceed 100 characters']
    },
    city: {
      type: String,
      required: [true, 'Please provide a city name'],
      trim: true,
      minlength: [2, 'City name must be at least 2 characters'],
      maxlength: [100, 'City name cannot exceed 100 characters']
    },
    polygon: {
      type: [PointSchema],
      required: [true, 'Please provide polygon coordinates'],
      validate: {
        validator: function(polygon: IPoint[]) {
          // Polygon must have at least 3 points to form a closed shape
          return polygon && polygon.length >= 3;
        },
        message: 'Polygon must have at least 3 points'
      }
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Index for faster queries
ServiceRegionSchema.index({ name: 1, city: 1 });
ServiceRegionSchema.index({ isActive: 1 });

const ServiceRegion = mongoose.model<IServiceRegion>('ServiceRegion', ServiceRegionSchema);

export default ServiceRegion;

