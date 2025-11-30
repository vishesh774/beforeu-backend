# Fly.io Deployment Guide for Backend

This guide covers deploying the backend to Fly.io.

## Prerequisites

1. Fly.io account (sign up at [fly.io](https://fly.io))
2. Fly CLI installed: `curl -L https://fly.io/install.sh | sh`
3. MongoDB Atlas account (or your MongoDB instance)
4. Git repository

## Initial Setup

### 1. Login to Fly.io

```bash
fly auth login
```

### 2. Initialize Fly.io App (if not already done)

```bash
cd backend
fly launch
```

Follow the prompts:
- **App name**: `beforeu-backend` (or your preferred name)
- **Region**: Choose closest to your users (e.g., `bom` for Mumbai)
- **Postgres/Redis**: No (we use MongoDB)
- **Dockerfile**: Yes (use existing)

### 3. Configure Environment Variables

Set required environment variables:

```bash
# MongoDB connection string
fly secrets set MONGODB_URI="your-mongodb-connection-string"

# JWT secret for token signing
fly secrets set JWT_SECRET="your-secure-random-string"

# Node environment
fly secrets set NODE_ENV="production"

# CORS Origins - IMPORTANT: Set your frontend URLs here
# For multiple origins, separate with commas (no spaces)
# Example: "https://your-app.vercel.app,https://admin.vercel.app"
fly secrets set CORS_ORIGIN="https://your-customer-platform.vercel.app,https://your-admin-panel.vercel.app"

# Port (optional, defaults to 5000)
fly secrets set PORT="5000"
```

Or set them via the Fly.io dashboard:
1. Go to your app dashboard
2. Navigate to "Secrets"
3. Add each secret

## Configuration Files

### fly.toml

The `fly.toml` file is already configured with:
- **App name**: `beforeu-backend`
- **Primary region**: `bom` (Mumbai)
- **Internal port**: `5000` (matches your app)
- **Memory**: 1GB
- **CPU**: 1 shared CPU

### Dockerfile

The Dockerfile:
1. Uses Node.js 20.18.0
2. Installs dev dependencies (including TypeScript) for build
3. Builds the TypeScript code
4. Removes dev dependencies after build
5. Exposes port 5000
6. Runs `npm start` which executes `node dist/app.js`

## Deployment

### Deploy to Fly.io

```bash
fly deploy
```

This will:
1. Build the Docker image
2. Run `npm ci --include=dev` (installs TypeScript)
3. Run `npm run build` (compiles TypeScript)
4. Remove dev dependencies
5. Deploy the app

### View Logs

```bash
fly logs
```

### Check App Status

```bash
fly status
```

### Open App in Browser

```bash
fly open
```

## Troubleshooting

### Error: "tsc: not found"

**Solution**: The Dockerfile already includes `npm ci --include=dev` which installs devDependencies including TypeScript. If you still get this error:

1. Check the Dockerfile has `npm ci --include=dev` (not just `npm ci`)
2. Verify `package.json` has TypeScript in `devDependencies`
3. Check build logs: `fly logs`

### Port Mismatch Error

**Symptoms**: App starts but not accessible

**Solution**: 
- Ensure `fly.toml` has `internal_port = 5000`
- Ensure `Dockerfile` has `EXPOSE 5000` and `ENV PORT=5000`
- Ensure your app reads `process.env.PORT || 5000`

### MongoDB Connection Failed

**Symptoms**: App starts but database operations fail

**Solution**:
1. Verify `MONGODB_URI` is set: `fly secrets list`
2. Check MongoDB Atlas allows connections from Fly.io IPs (or use 0.0.0.0/0 for testing)
3. Check logs: `fly logs`

### Build Fails

**Check build logs**:
```bash
fly logs --app beforeu-backend
```

**Common issues**:
- TypeScript errors: Fix compilation errors in your code
- Missing dependencies: Ensure all dependencies are in `package.json`
- Memory issues: Increase VM memory in `fly.toml`

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `MONGODB_URI` | Yes | MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/dbname` |
| `JWT_SECRET` | Yes | Secret for JWT signing | Random secure string |
| `NODE_ENV` | Yes | Environment | `production` |
| `CORS_ORIGIN` | Yes | Comma-separated frontend URLs | `https://app.vercel.app,https://admin.vercel.app` |
| `PORT` | No | Server port (defaults to 5000) | `5000` |

## Scaling

### Scale Vertically (More Resources)

```bash
fly scale vm shared-cpu-2x --memory 2048
```

### Scale Horizontally (More Instances)

```bash
fly scale count 2
```

### Auto-scaling

The `fly.toml` is configured with:
- `auto_stop_machines = 'stop'` - Stops machines when idle
- `auto_start_machines = true` - Starts machines on request
- `min_machines_running = 0` - No machines running when idle

To keep at least 1 machine running:
```bash
fly scale count 1
```

## Health Checks

Add a health check endpoint in your app (already exists at `/health`):

```bash
# Test health endpoint
curl https://your-app.fly.dev/health
```

## Monitoring

### View Metrics

```bash
fly metrics
```

### View Logs in Real-time

```bash
fly logs
```

## Database Setup

### MongoDB Atlas Setup

1. Create a MongoDB Atlas account
2. Create a cluster (free tier available)
3. Create a database user
4. Whitelist IP addresses:
   - For Fly.io: Use `0.0.0.0/0` (allows all IPs) for testing
   - Or add specific Fly.io IPs
5. Get connection string and set as `MONGODB_URI`

## Post-Deployment Checklist

- [ ] App deploys successfully
- [ ] Health endpoint responds: `curl https://your-app.fly.dev/health`
- [ ] MongoDB connection works (check logs)
- [ ] API endpoints are accessible
- [ ] CORS is configured for frontend domain
- [ ] Environment variables are set correctly
- [ ] Logs show no errors

## Useful Commands

```bash
# Deploy
fly deploy

# View logs
fly logs

# SSH into machine
fly ssh console

# Check status
fly status

# List secrets
fly secrets list

# Set secret
fly secrets set KEY=value

# Unset secret
fly secrets unset KEY

# Open app
fly open

# View metrics
fly metrics

# Scale app
fly scale count 2
fly scale vm shared-cpu-2x --memory 2048
```

## Additional Resources

- [Fly.io Documentation](https://fly.io/docs/)
- [Fly.io Node.js Guide](https://fly.io/docs/languages-and-frameworks/node/)
- [Fly.io Dockerfile Reference](https://fly.io/docs/reference/dockerfile/)

