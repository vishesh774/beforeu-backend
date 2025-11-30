# Quick Deployment Reference

> **📋 For Production**: See [`DASHBOARD_DEPLOYMENT_GUIDE.md`](./DASHBOARD_DEPLOYMENT_GUIDE.md) for dashboard-based deployment with GitHub CI/CD.

## Deployment Methods

1. **Dashboard + GitHub (Recommended for Production)**: See `DASHBOARD_DEPLOYMENT_GUIDE.md`
2. **CLI Method (Development/Quick Deploy)**: See below

## One-Time Setup

```bash
# 1. Install Fly CLI
curl -L https://fly.io/install.sh | sh

# 2. Login
fly auth login

# 3. Create app (if needed)
fly apps create beforeu-backend
```

## Configure Secrets (One-Time)

```bash
# MongoDB Connection String
fly secrets set MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/beforeu?retryWrites=true&w=majority"

# JWT Secret (generate with: openssl rand -base64 32)
fly secrets set JWT_SECRET="your-secure-random-string"

# Environment
fly secrets set NODE_ENV="production"

# CORS Origins (comma-separated, no spaces)
fly secrets set CORS_ORIGIN="https://your-frontend.com,https://your-admin.com"
```

## Deploy

### Option 1: Use Deployment Script
```bash
cd backend
./deploy.sh
```

### Option 2: Manual Deploy
```bash
cd backend
fly deploy
```

## Verify

```bash
# Check status
fly status

# View logs
fly logs

# Test health
curl https://beforeu-backend.fly.dev/health
```

## Port Configuration Summary

- **Application Port**: `5000` (set in `app.ts`, `Dockerfile`, `fly.toml`)
- **Server Binding**: `0.0.0.0:5000` (allows external connections)
- **Fly.io Internal Port**: `5000` (matches app port)
- **Public Ports**: `80` (HTTP) and `443` (HTTPS)

## Key Files

- `Dockerfile` - Container build configuration
- `fly.toml` - Fly.io app configuration
- `src/app.ts` - Server code (binds to 0.0.0.0:5000)
- `src/config/database.ts` - MongoDB connection (waits before server starts)

## Troubleshooting

```bash
# View logs
fly logs

# Check secrets
fly secrets list

# Restart app
fly apps restart beforeu-backend

# SSH into machine
fly ssh console

# Check machine status
fly machines list
```

## Common Issues Fixed

✅ **MongoDB Connection**: Waits for DB before starting server  
✅ **Port Binding**: Explicitly binds to `0.0.0.0:5000`  
✅ **Proxy Errors**: Health checks configured, machine always running  
✅ **TypeScript Build**: Proper Dockerfile with dev dependencies  
✅ **Environment Variables**: All set via Fly secrets  

---

For detailed guide, see `DEPLOYMENT_GUIDE.md`

