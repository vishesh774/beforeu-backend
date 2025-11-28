# BeforeU Backend API

A Node.js + TypeScript backend server for the BeforeU customer application, built with Express.js and MongoDB.

## Features

- ✅ RESTful API architecture
- ✅ MongoDB with Mongoose ODM
- ✅ TypeScript for type safety
- ✅ User authentication (Signup/Login)
- ✅ JWT token-based authentication
- ✅ Input validation
- ✅ Error handling middleware
- ✅ Security middleware (Helmet, CORS, Rate Limiting)
- ✅ Password hashing with bcrypt

## Prerequisites

- Node.js (v18 or higher)
- MongoDB (local or MongoDB Atlas)
- npm or yarn

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your configuration:
   - MongoDB connection string
   - JWT secret key
   - Server port
   - CORS origin

3. **Start MongoDB**:
   - Local: Ensure MongoDB is running on your machine
   - Atlas: Use your MongoDB Atlas connection string

4. **Run the server**:
   ```bash
   # Development mode (with hot reload)
   npm run dev

   # Production mode
   npm run build
   npm start
   ```

## API Endpoints

### Authentication

#### Signup
- **POST** `/api/auth/signup`
- **Body**:
  ```json
  {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+919876543210",
    "password": "Password123"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "data": {
      "user": {
        "id": "...",
        "name": "John Doe",
        "email": "john@example.com",
        "phone": "+919876543210",
        "credits": 0,
        "activePlanId": null,
        "familyMembers": [],
        "addresses": []
      },
      "token": "jwt_token_here"
    }
  }
  ```

#### Login
- **POST** `/api/auth/login`
- **Body**:
  ```json
  {
    "email": "john@example.com",
    "password": "Password123"
  }
  ```
- **Response**: Same as signup

#### Get Current User
- **GET** `/api/auth/me`
- **Headers**: `Authorization: Bearer <token>`
- **Response**: User object

### Health Check

- **GET** `/health`
- **Response**:
  ```json
  {
    "success": true,
    "message": "Server is running",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
  ```

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── database.ts          # MongoDB connection
│   ├── controllers/
│   │   └── authController.ts     # Auth logic
│   ├── middleware/
│   │   ├── auth.ts               # JWT authentication
│   │   ├── errorHandler.ts       # Error handling
│   │   ├── validate.ts           # Validation middleware
│   │   └── asyncHandler.ts       # Async error handler
│   ├── models/
│   │   └── User.ts               # User model
│   ├── routes/
│   │   └── authRoutes.ts         # Auth routes
│   ├── utils/
│   │   └── generateToken.ts      # JWT utilities
│   ├── validators/
│   │   └── authValidator.ts      # Input validation
│   └── app.ts                    # Express app
├── .env.example                  # Environment variables template
├── tsconfig.json                 # TypeScript configuration
└── package.json                  # Dependencies
```

## Environment Variables

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/beforeu
MONGODB_URI_PROD=mongodb+srv://username:password@cluster.mongodb.net/beforeu

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRE=7d

# CORS Configuration
CORS_ORIGIN=http://localhost:3000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## Security Features

- **Helmet**: Sets various HTTP headers for security
- **CORS**: Configurable cross-origin resource sharing
- **Rate Limiting**: Prevents abuse with request rate limiting
- **Password Hashing**: Uses bcrypt for secure password storage
- **JWT**: Secure token-based authentication
- **Input Validation**: Validates and sanitizes user input

## Development

### Running in Development Mode

```bash
npm run dev
```

This will:
- Watch for file changes
- Automatically restart the server
- Use TypeScript directly (no compilation needed)

### Building for Production

```bash
npm run build
npm start
```

## Testing API Endpoints

### Using cURL

```bash
# Signup
curl -X POST http://localhost:5000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+919876543210",
    "password": "Password123"
  }'

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "Password123"
  }'

# Get Current User
curl -X GET http://localhost:5000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Using Postman

1. Import the collection (if available)
2. Set the base URL: `http://localhost:5000`
3. Test endpoints as described above

## Error Handling

The API uses a consistent error response format:

```json
{
  "success": false,
  "error": "Error message here"
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized
- `404` - Not Found
- `500` - Internal Server Error

## MongoDB Connection

### Local MongoDB

```env
MONGODB_URI=mongodb://localhost:27017/beforeu
```

### MongoDB Atlas

```env
MONGODB_URI_PROD=mongodb+srv://username:password@cluster.mongodb.net/beforeu
```

## Next Steps

- [ ] Add email verification
- [ ] Add password reset functionality
- [ ] Add refresh token mechanism
- [ ] Add API documentation (Swagger/OpenAPI)
- [ ] Add unit and integration tests
- [ ] Add logging (Winston/Morgan)
- [ ] Add request validation for all endpoints
- [ ] Add user profile update endpoints
- [ ] Add booking management endpoints
- [ ] Add address management endpoints

## License

Private - BeforeU

