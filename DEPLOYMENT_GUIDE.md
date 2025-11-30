# Complete Fly.io Deployment Guide for BeforeU Backend (CLI Method)

> **⚠️ For Production Deployment**: See [`DASHBOARD_DEPLOYMENT_GUIDE.md`](./DASHBOARD_DEPLOYMENT_GUIDE.md) for dashboard-based deployment with GitHub integration.

This guide provides step-by-step instructions to deploy the BeforeU backend to Fly.io using the **command-line interface (CLI)**, addressing all common issues including MongoDB connectivity, port configuration, and proxy errors.

**For production deployments with GitHub CI/CD, use the Dashboard Deployment Guide instead.**

## Prerequisites

1. **Fly.io Account**: Sign up at [fly.io](https://fly.io)
2. **Fly CLI**: Install the Fly CLI
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```
3. **MongoDB Atlas Account**: Free tier available at [mongodb.com/atlas](https://www.mongodb.com/cloud/atlas)
4. **Git**: Your code should be in a git repository

## Step 1: Install and Login to Fly.io

```bash
# Install Fly CLI (if not already installed)
curl -L https://fly.io/install.sh | sh

# Login to Fly.io
fly auth login
```

## Step 2: MongoDB Atlas Setup

### 2.1 Create MongoDB Atlas Cluster

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free cluster (M0)
3. Choose a region close to your Fly.io region (e.g., Mumbai for `bom` region)

### 2.2 Configure Network Access

1. Go to **Network Access** in MongoDB Atlas dashboard
2. Click **Add IP Address**
3. Add `0.0.0.0/0` to allow all IPs (for production, you can restrict to Fly.io IPs later)
4. Click **Confirm**

### 2.3 Create Database User

1. Go to **Database Access** in MongoDB Atlas dashboard
2. Click **Add New Database User**
3. Choose **Password** authentication
4. Set username and password (save these securely!)
5. Set privileges to **Read and write to any database**
6. Click **Add User**

### 2.4 Get Connection String

1. Go to **Database** → **Connect**
2. Choose **Connect your application**
3. Copy the connection string (it looks like):
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
4. Replace `<username>` and `<password>` with your database user credentials
5. Add your database name at the end (before `?`):
   ```
   mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/beforeu?retryWrites=true&w=majority
   ```

## Step 3: Initialize Fly.io App

```bash
cd backend

# Initialize Fly.io app (choose a unique name)
fly launch --no-deploy

# When prompted:
# - App name: beforeu-backend (or your preferred name)
# - Region: bom (Mumbai) or choose closest to your users
# - Postgres: No (we use MongoDB)
# - Redis: No
# - Dockerfile: Yes (use the Dockerfile we created)
```

**Important**: If you already have a `fly.toml`, you can skip this step or use:
```bash
fly apps create beforeu-backend
```

## Step 4: Configure Environment Variables (Secrets)

Set all required secrets using Fly.io secrets:

```bash
# MongoDB Connection String (REQUIRED)
fly secrets set MONGODB_URI="mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/beforeu?retryWrites=true&w=majority"

# JWT Secret for token signing (REQUIRED)
# Generate a secure random string:
# On Mac/Linux: openssl rand -base64 32
# On Windows: use an online generator
fly secrets set JWT_SECRET="your-super-secure-random-string-here"

# Node Environment (REQUIRED)
fly secrets set NODE_ENV="production"

# CORS Origins (REQUIRED)
# Replace with your actual frontend URLs (comma-separated, no spaces)
fly secrets set CORS_ORIGIN="https://your-customer-app.vercel.app,https://your-admin-panel.vercel.app"

# Port (optional, defaults to 5000 - already set in fly.toml)
# fly secrets set PORT="5000"
```

**Verify secrets are set:**
```bash
fly secrets list
```

## Step 5: Review Configuration Files

### 5.1 Verify Dockerfile

Ensure `backend/Dockerfile` exists and contains:
- Node.js 20.18.0
- Builds TypeScript to JavaScript
- Exposes port 5000
- Sets PORT=5000 environment variable
- Runs `npm run start` which executes `node dist/app.js`

### 5.2 Verify fly.toml

Ensure `backend/fly.toml` contains:
- `internal_port = 5000` (matches your app port)
- `min_machines_running = 1` (keeps at least 1 machine running)
- Health check endpoint configured

### 5.3 Verify Application Code

Ensure `backend/src/app.ts`:
- Parses PORT as number: `parseInt(process.env.PORT || '5000', 10)`
- Binds to `0.0.0.0`: `app.listen(PORT, '0.0.0.0', ...)`
- Waits for database connection before starting server

## Step 6: Build and Deploy

```bash
# Make sure you're in the backend directory
cd backend

# Deploy to Fly.io
fly deploy

# Watch the deployment logs
fly logs
```

## Step 7: Verify Deployment

### 7.1 Check App Status

```bash
fly status
```

### 7.2 Check Logs

```bash
# View real-time logs
fly logs

# You should see:
# ✅ MongoDB Connected: ...
# ✅ Database connection established
# 🚀 Server SUCCESSFULLY started!
# 📍 Listening on 0.0.0.0:5000
```

### 7.3 Test Health Endpoint

```bash
# Get your app URL
fly status

# Test health endpoint
curl https://beforeu-backend.fly.dev/health

# Should return:
# {"success":true,"message":"Server is running","timestamp":"..."}
```

### 7.4 Test API Endpoint

```bash
# Test root endpoint
curl https://beforeu-backend.fly.dev/

# Should return API information
```

## Step 8: Get Your App URL

```bash
fly info

# Your app will be available at:
# https://beforeu-backend.fly.dev
# (or whatever name you chose)
```

## Troubleshooting

### Issue: MongoDB Connection Failed

**Symptoms**: Logs show "Error connecting to MongoDB" or "buffering timed out"

**Solutions**:
1. Verify `MONGODB_URI` is set: `fly secrets list`
2. Check MongoDB Atlas Network Access allows `0.0.0.0/0`
3. Verify connection string format is correct (includes database name)
4. Check MongoDB Atlas cluster is running (not paused)
5. Verify database user credentials are correct

**Check logs**:
```bash
fly logs
```

### Issue: Proxy to Machines Not Found / Connection Refused

**Symptoms**: `[PC01] instance refused connection` or `proxy to machines not found`

**Solutions**:
1. **Verify server binds to 0.0.0.0**:
   - Check `app.ts` has: `app.listen(PORT, '0.0.0.0', ...)`
   - Check logs show: `Listening on 0.0.0.0:5000`

2. **Verify port configuration**:
   - `fly.toml` has `internal_port = 5000`
   - `Dockerfile` has `EXPOSE 5000` and `ENV PORT=5000`
   - App code uses `parseInt(process.env.PORT || '5000', 10)`

3. **Check machine is running**:
   ```bash
   fly status
   fly machines list
   ```

4. **Restart the app**:
   ```bash
   fly apps restart beforeu-backend
   ```

5. **Check health check**:
   ```bash
   fly logs | grep health
   ```

### Issue: Build Fails

**Symptoms**: Deployment fails during build step

**Solutions**:
1. Check TypeScript compilation errors locally:
   ```bash
   npm run build
   ```

2. Verify all dependencies are in `package.json`

3. Check `Dockerfile` includes devDependencies for build:
   ```dockerfile
   RUN npm ci --include=dev
   ```

### Issue: Server Starts But Database Operations Fail

**Symptoms**: Server starts but API calls fail with "buffering timed out"

**Solutions**:
1. Verify database connection completes before server starts (check `app.ts`)
2. Check MongoDB connection options in `database.ts`:
   - `serverSelectionTimeoutMS: 60000`
   - `socketTimeoutMS: 45000`
   - `connectTimeoutMS: 30000`

3. Verify MongoDB Atlas cluster is in same region or close to Fly.io region

### Issue: CORS Errors

**Symptoms**: Frontend can't connect, CORS errors in browser

**Solutions**:
1. Verify `CORS_ORIGIN` secret includes your frontend URLs:
   ```bash
   fly secrets list
   ```

2. Update CORS origins:
   ```bash
   fly secrets set CORS_ORIGIN="https://your-frontend.com,https://your-admin.com"
   ```

3. Restart app:
   ```bash
   fly apps restart beforeu-backend
   ```

## Useful Commands

```bash
# View app status
fly status

# View logs (real-time)
fly logs

# View logs (last 100 lines)
fly logs --limit 100

# SSH into machine
fly ssh console

# List secrets
fly secrets list

# Set a secret
fly secrets set KEY=value

# Unset a secret
fly secrets unset KEY

# Restart app
fly apps restart beforeu-backend

# Scale app
fly scale count 2
fly scale vm shared-cpu-2x --memory 2048

# View metrics
fly metrics

# Open app in browser
fly open

# Check machine status
fly machines list

# Restart a specific machine
fly machines restart <machine-id>
```

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `MONGODB_URI` | ✅ Yes | MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/dbname?retryWrites=true&w=majority` |
| `JWT_SECRET` | ✅ Yes | Secret for JWT signing | Random secure string (32+ chars) |
| `NODE_ENV` | ✅ Yes | Environment | `production` |
| `CORS_ORIGIN` | ✅ Yes | Comma-separated frontend URLs | `https://app.vercel.app,https://admin.vercel.app` |
| `PORT` | ❌ No | Server port (defaults to 5000) | `5000` |

## Post-Deployment Checklist

- [ ] App deploys successfully (`fly status` shows running)
- [ ] Health endpoint responds: `curl https://your-app.fly.dev/health`
- [ ] MongoDB connection works (check logs: `fly logs`)
- [ ] API endpoints are accessible
- [ ] CORS is configured for frontend domains
- [ ] Environment variables are set correctly (`fly secrets list`)
- [ ] Logs show no errors (`fly logs`)
- [ ] Server binds to `0.0.0.0:5000` (check logs)

## Scaling

### Keep Machine Always Running

By default, `min_machines_running = 1` keeps at least one machine running. To allow machines to stop when idle:

```toml
auto_stop_machines = true
min_machines_running = 0
```

### Scale Vertically (More Resources)

```bash
fly scale vm shared-cpu-2x --memory 2048
```

### Scale Horizontally (More Instances)

```bash
fly scale count 2
```

## Monitoring

### View Metrics

```bash
fly metrics
```

### Set Up Alerts

1. Go to Fly.io dashboard
2. Navigate to your app
3. Go to **Alerts** section
4. Configure alerts for:
   - High CPU usage
   - High memory usage
   - Failed health checks

## Security Best Practices

1. **MongoDB Atlas**:
   - Use strong database user passwords
   - Restrict IP whitelist to Fly.io IPs in production (instead of `0.0.0.0/0`)
   - Enable MongoDB Atlas encryption at rest

2. **Secrets**:
   - Never commit secrets to git
   - Use `fly secrets` for all sensitive data
   - Rotate secrets regularly

3. **CORS**:
   - Only allow specific frontend domains
   - Don't use wildcards in production

4. **Helmet**:
   - Already configured in `app.ts` for security headers

## Support

If you encounter issues:

1. Check logs: `fly logs`
2. Check status: `fly status`
3. Verify secrets: `fly secrets list`
4. Review this guide's troubleshooting section
5. Check Fly.io docs: https://fly.io/docs/
6. Check MongoDB Atlas status: https://status.mongodb.com/

## Quick Reference: Complete Deployment Command Sequence

```bash
# 1. Login
fly auth login

# 2. Create app (if needed)
fly apps create beforeu-backend

# 3. Set secrets
fly secrets set MONGODB_URI="your-connection-string"
fly secrets set JWT_SECRET="your-secret"
fly secrets set NODE_ENV="production"
fly secrets set CORS_ORIGIN="your-frontend-urls"

# 4. Deploy
cd backend
fly deploy

# 5. Verify
fly status
fly logs
curl https://beforeu-backend.fly.dev/health
```

---

**Last Updated**: 2025-11-30
**Fly.io Region**: bom (Mumbai)
**Port**: 5000
**Node Version**: 20.18.0

