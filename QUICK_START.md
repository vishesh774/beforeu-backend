# Quick Start Guide

## Prerequisites

1. **MongoDB**: 
   - Install locally: https://www.mongodb.com/try/download/community
   - Or use MongoDB Atlas (free tier): https://www.mongodb.com/cloud/atlas

2. **Node.js**: v18 or higher

## Setup Steps

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Create environment file**:
   ```bash
   cp .env.example .env
   ```

3. **Configure MongoDB**:
   - Edit `.env` file
   - For local MongoDB: `MONGODB_URI=mongodb://localhost:27017/beforeu`
   - For MongoDB Atlas: Use your connection string

4. **Start MongoDB** (if using local):
   ```bash
   # Mac (with Homebrew)
   brew services start mongodb-community

   # Linux
   sudo systemctl start mongod

   # Windows
   # Start MongoDB service from Services panel
   ```

5. **Start the server**:
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:5000`

## Test the API

### Using cURL

**Signup**:
```bash
curl -X POST http://localhost:5000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+919876543210",
    "password": "Password123"
  }'
```

**Login**:
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "Password123"
  }'
```

**Get Current User** (replace YOUR_TOKEN with token from login):
```bash
curl -X GET http://localhost:5000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Using Postman

1. Create a new collection: "BeforeU API"
2. Set base URL: `http://localhost:5000`
3. Create requests:
   - POST `/api/auth/signup`
   - POST `/api/auth/login`
   - GET `/api/auth/me` (add Authorization header)

## Common Issues

### MongoDB Connection Error
- **Solution**: Ensure MongoDB is running
- Check connection string in `.env`
- For Atlas: Ensure IP is whitelisted

### Port Already in Use
- **Solution**: Change `PORT` in `.env` or kill the process using port 5000

### JWT Secret Error
- **Solution**: Ensure `JWT_SECRET` is set in `.env`

## Next Steps

- Test all endpoints
- Connect frontend to backend
- Add more API endpoints as needed

