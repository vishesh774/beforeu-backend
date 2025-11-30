# Fly.io Dashboard Deployment Guide (Production-Ready)

This guide covers deploying the BeforeU backend to Fly.io using the **dashboard interface** with **GitHub integration** for automated CI/CD deployments.

## Prerequisites

1. **Fly.io Account**: Sign up at [fly.io](https://fly.io)
2. **GitHub Account**: Your code should be in a GitHub repository
3. **MongoDB Atlas Account**: Free tier available at [mongodb.com/atlas](https://www.mongodb.com/cloud/atlas)

## Overview

This guide uses:
- ✅ **Fly.io Dashboard** for configuration (no CLI required)
- ✅ **GitHub Integration** for automated deployments
- ✅ **GitHub Actions** for CI/CD pipeline
- ✅ **Secrets Management** via Fly.io dashboard

---

## Part 1: Initial Setup via Dashboard

### Step 1: Create App in Fly.io Dashboard

1. Go to [Fly.io Dashboard](https://fly.io/dashboard)
2. Click **"Create New App"** or **"New App"**
3. Fill in the details:
   - **App Name**: `beforeu-backend` (or your preferred name)
   - **Organization**: Select your organization
   - **Region**: Choose `bom` (Mumbai) or closest to your users
   - **Machine Type**: Leave default (1GB RAM, 1 shared CPU)
4. Click **"Create App"**

### Step 2: Connect GitHub Repository

1. In your app dashboard, go to **"Source"** or **"GitHub"** tab
2. Click **"Connect GitHub"** or **"Link GitHub Repository"**
3. Authorize Fly.io to access your GitHub account
4. Select your repository (e.g., `your-username/beforeu`)
5. Select the branch (usually `main` or `master`)
6. Set the **Root Directory** to `backend` (since your backend code is in the `backend` folder)
7. Click **"Save"** or **"Link Repository"**

### Step 3: Configure Build Settings

1. In the app dashboard, go to **"Settings"** → **"Build"** or **"Source"** tab
2. **IMPORTANT**: Ensure **Build Type** is set to **"Dockerfile"** (NOT "Buildpacks" or "Auto-detect")
3. Verify **Dockerfile Path** is `backend/Dockerfile` (relative to repo root)
4. **Build Command**: Leave empty (uses Dockerfile)
5. **Buildpacks**: Should be empty/disabled (we use Dockerfile, not buildpacks)
6. Click **"Save"** or **"Update"**

**If you see "Buildpacks" selected:**
- Change it to **"Dockerfile"**
- This prevents Fly.io from trying to use Node.js buildpacks
- The Dockerfile will handle the build process

---

## Part 2: MongoDB Atlas Setup

### Step 2.1: Create MongoDB Atlas Cluster

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Sign in or create an account
3. Click **"Build a Database"**
4. Choose **FREE (M0)** tier
5. Select a **Cloud Provider** (AWS recommended)
6. Choose a **Region** close to your Fly.io region (e.g., Mumbai for `bom`)
7. Click **"Create"**

### Step 2.2: Configure Network Access

1. In MongoDB Atlas dashboard, go to **"Network Access"**
2. Click **"Add IP Address"**
3. Click **"Allow Access from Anywhere"** (adds `0.0.0.0/0`)
   - ⚠️ **For production**, you can restrict to Fly.io IPs later
4. Click **"Confirm"**

### Step 2.3: Create Database User

1. Go to **"Database Access"**
2. Click **"Add New Database User"**
3. Choose **"Password"** authentication
4. Set a **Username** (e.g., `beforeu-admin`)
5. Set a **Password** (use a strong password generator)
6. **Save the password securely!** (you'll need it for the connection string)
7. Under **"Database User Privileges"**, select **"Read and write to any database"**
8. Click **"Add User"**

### Step 2.4: Get Connection String

1. Go to **"Database"** → **"Connect"**
2. Click **"Connect your application"**
3. Choose **"Node.js"** as driver
4. Copy the connection string (looks like):
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
5. Replace `<username>` with your database username
6. Replace `<password>` with your database password
7. Add your database name before the `?`:
   ```
   mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/beforeu?retryWrites=true&w=majority
   ```
8. **Save this connection string** - you'll need it in the next step

---

## Part 3: Configure Secrets via Dashboard

### Step 3.1: Access Secrets Management

1. In Fly.io dashboard, go to your app (`beforeu-backend`)
2. Navigate to **"Secrets"** tab (in the left sidebar)
3. Click **"Add Secret"** or **"Set Secret"**

### Step 3.2: Set Required Secrets

Add each secret one by one:

#### 1. MongoDB Connection String

- **Name**: `MONGODB_URI`
- **Value**: Your MongoDB connection string from Step 2.4
  ```
  mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/beforeu?retryWrites=true&w=majority
  ```
- Click **"Set Secret"**

#### 2. JWT Secret

- **Name**: `JWT_SECRET`
- **Value**: Generate a secure random string:
  - **Mac/Linux**: Run `openssl rand -base64 32` in terminal
  - **Windows**: Use [random.org](https://www.random.org/strings/) or PowerShell: `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))`
  - **Online**: Use any secure random string generator (32+ characters)
- Click **"Set Secret"**

#### 3. Node Environment

- **Name**: `NODE_ENV`
- **Value**: `production`
- Click **"Set Secret"**

#### 4. CORS Origins

- **Name**: `CORS_ORIGIN`
- **Value**: Your frontend URLs, comma-separated (no spaces):
  ```
  https://your-customer-app.vercel.app,https://your-admin-panel.vercel.app
  ```
  - If you don't have frontend URLs yet, use: `*` (allows all origins - change later)
- Click **"Set Secret"**

### Step 3.3: Verify Secrets

1. In the **"Secrets"** tab, you should see all 4 secrets listed:
   - ✅ `MONGODB_URI`
   - ✅ `JWT_SECRET`
   - ✅ `NODE_ENV`
   - ✅ `CORS_ORIGIN`

2. Secrets are encrypted and only visible as `***` for security

---

## Part 4: Configure GitHub Actions (CI/CD)

### Step 4.1: Get Fly.io API Token

1. Go to [Fly.io Dashboard](https://fly.io/dashboard)
2. Click your **profile icon** (top right)
3. Go to **"Access Tokens"** or **"API Tokens"**
4. Click **"Create Token"**
5. Give it a name: `github-actions-deploy`
6. Copy the token **immediately** (you won't see it again!)
7. Save it securely

### Step 4.2: Add Token to GitHub Secrets

1. Go to your **GitHub repository**
2. Click **"Settings"** tab
3. Go to **"Secrets and variables"** → **"Actions"**
4. Click **"New repository secret"**
5. **Name**: `FLY_API_TOKEN`
6. **Value**: Paste your Fly.io API token from Step 4.1
7. Click **"Add secret"**

### Step 4.3: Verify GitHub Actions Workflow

The GitHub Actions workflow file (`.github/workflows/fly-deploy.yml`) should already exist in your repository. If not:

1. Create `.github/workflows/fly-deploy.yml` in your repository root
2. The workflow file is already created in this guide (see file structure)

**Verify the workflow file exists:**
- Path: `.github/workflows/fly-deploy.yml`
- It should trigger on pushes to `main`/`master` branch
- It should deploy from the `backend` directory

---

## Part 5: Initial Deployment

### Option A: Deploy via Dashboard (First Time)

1. In Fly.io dashboard, go to your app
2. Go to **"Deployments"** tab
3. Click **"Deploy Now"** or **"Manual Deploy"**
4. Select your **GitHub repository** and **branch** (`main`)
5. Click **"Deploy"**
6. Watch the deployment logs in real-time

### Option B: Trigger via GitHub (Recommended)

1. Make a small change to your code (or just push existing code)
2. Push to `main` branch:
   ```bash
   git add .
   git commit -m "Initial deployment setup"
   git push origin main
   ```
3. Go to your GitHub repository
4. Click **"Actions"** tab
5. You should see **"Fly.io Deployment"** workflow running
6. Click on it to see deployment progress

### Step 5.1: Monitor Deployment

**In Fly.io Dashboard:**
1. Go to **"Deployments"** tab
2. You'll see the deployment progress
3. Wait for status to show **"Deployed"** (green checkmark)

**In GitHub Actions:**
1. Go to **"Actions"** tab in your repository
2. Click on the running workflow
3. Watch the build and deployment logs

**Expected Timeline:**
- Build: 2-5 minutes
- Deploy: 1-2 minutes
- Total: ~5-7 minutes for first deployment

---

## Part 6: Verify Deployment

### Step 6.1: Check App Status

1. In Fly.io dashboard, go to your app
2. Check **"Overview"** tab:
   - Status should be **"Running"** (green)
   - At least 1 machine should be running
   - Health checks should be passing

### Step 6.2: View Logs

1. In Fly.io dashboard, go to **"Logs"** tab
2. You should see:
   ```
   🔄 Connecting to database...
   ✅ MongoDB Connected: ...
   ✅ Database connection established
   🚀 Server SUCCESSFULLY started!
   📍 Listening on 0.0.0.0:5000
   📍 Database: Connected
   ```

### Step 6.3: Test Health Endpoint

1. In Fly.io dashboard, go to **"Overview"** tab
2. Copy your app URL (e.g., `https://beforeu-backend.fly.dev`)
3. Test the health endpoint:
   ```bash
   curl https://beforeu-backend.fly.dev/health
   ```
   Or open in browser: `https://beforeu-backend.fly.dev/health`

4. Should return:
   ```json
   {
     "success": true,
     "message": "Server is running",
     "timestamp": "2025-11-30T..."
   }
   ```

### Step 6.4: Test Root Endpoint

```bash
curl https://beforeu-backend.fly.dev/
```

Should return API information.

---

## Part 7: Automated Deployments (CI/CD)

### How It Works

Once configured, **every push to `main` branch** will automatically:
1. Trigger GitHub Actions workflow
2. Build your Docker image
3. Deploy to Fly.io
4. Run health checks

### Making Changes

1. **Make code changes** in your local repository
2. **Commit and push** to `main` branch:
   ```bash
   git add .
   git commit -m "Your change description"
   git push origin main
   ```
3. **GitHub Actions automatically deploys** (check Actions tab)
4. **Verify deployment** in Fly.io dashboard

### Manual Deployment Trigger

You can also trigger deployments manually:

1. Go to GitHub repository → **"Actions"** tab
2. Select **"Fly.io Deployment"** workflow
3. Click **"Run workflow"**
4. Select branch and click **"Run workflow"**

---

## Troubleshooting

### Issue: Deployment Fails

**Check:**
1. **GitHub Actions logs**: Go to Actions tab → Failed workflow → Check logs
2. **Fly.io logs**: Dashboard → Logs tab
3. **Build errors**: Check if Dockerfile is correct
4. **Secrets**: Verify all secrets are set in Fly.io dashboard

**Common Causes:**
- Missing secrets
- Dockerfile path incorrect
- Build errors in code
- MongoDB connection string incorrect

### Issue: "launch manifest was created for a app, but this is a NodeJS app"

**Symptoms**: Error during deployment: `Error: launch manifest was created for a app, but this is a NodeJS app`

**Cause**: Fly.io is detecting your app as Node.js and trying to use buildpacks instead of Dockerfile.

**Solutions:**

1. **Configure Build Type in Dashboard**:
   - Go to Fly.io dashboard → Your app → **"Settings"** → **"Build"** or **"Source"**
   - Change **Build Type** from **"Buildpacks"** or **"Auto-detect"** to **"Dockerfile"**
   - Set **Dockerfile Path** to `backend/Dockerfile`
   - **Disable buildpacks** (should be empty/unchecked)
   - Click **"Save"**

2. **Verify fly.toml**:
   - Ensure `fly.toml` does NOT have `[build]` section with buildpacks
   - Dockerfile should be auto-detected
   - If you have `[build]` section, it should only specify `dockerfile = "Dockerfile"`

3. **Reconnect GitHub Repository** (if needed):
   - Go to **"Source"** tab
   - Disconnect and reconnect GitHub repository
   - When reconnecting, ensure **Build Type** is set to **"Dockerfile"**

4. **Manual Deploy via CLI** (to verify):
   ```bash
   cd backend
   fly deploy --remote-only
   ```

### Issue: MongoDB Connection Failed

**Symptoms**: Logs show "Error connecting to MongoDB"

**Solutions:**
1. **Verify MongoDB Atlas**:
   - Network Access allows `0.0.0.0/0`
   - Database user exists and has correct permissions
   - Cluster is running (not paused)

2. **Verify Secret**:
   - Go to Fly.io dashboard → Secrets
   - Check `MONGODB_URI` is set correctly
   - Connection string includes database name

3. **Check Logs**:
   - Fly.io dashboard → Logs tab
   - Look for MongoDB connection errors

### Issue: App Not Accessible

**Symptoms**: Health endpoint returns error or timeout

**Solutions:**
1. **Check Machine Status**:
   - Dashboard → Overview → Machines should be "Running"

2. **Check Health Checks**:
   - Dashboard → Overview → Health checks should be passing

3. **Check Logs**:
   - Dashboard → Logs → Look for errors

4. **Restart App**:
   - Dashboard → Overview → Click "Restart" or "Restart All"

### Issue: GitHub Actions Not Triggering

**Solutions:**
1. **Verify Workflow File**:
   - Check `.github/workflows/fly-deploy.yml` exists
   - Verify it's committed to repository

2. **Check Branch**:
   - Workflow triggers on `main` or `master`
   - Ensure you're pushing to correct branch

3. **Check FLY_API_TOKEN**:
   - GitHub → Settings → Secrets → Verify `FLY_API_TOKEN` exists

4. **Check Permissions**:
   - GitHub → Settings → Actions → Verify workflows are enabled

---

## Dashboard Features

### Monitoring

1. **Metrics**: Dashboard → Metrics tab
   - CPU usage
   - Memory usage
   - Request rate
   - Response times

2. **Logs**: Dashboard → Logs tab
   - Real-time logs
   - Filter by time range
   - Search logs

3. **Machines**: Dashboard → Machines tab
   - View all machines
   - Restart individual machines
   - View machine details

### Scaling

1. **Scale Vertically** (More Resources):
   - Dashboard → Overview → Click "Scale"
   - Increase CPU/Memory
   - Click "Save"

2. **Scale Horizontally** (More Instances):
   - Dashboard → Overview → Click "Scale"
   - Increase machine count
   - Click "Save"

### Secrets Management

1. **Add Secret**: Dashboard → Secrets → Add Secret
2. **Update Secret**: Dashboard → Secrets → Click secret → Update
3. **Delete Secret**: Dashboard → Secrets → Click secret → Delete

**Important**: Changing secrets requires app restart to take effect.

---

## Production Checklist

Before going to production:

- [ ] MongoDB Atlas network access restricted (not `0.0.0.0/0`)
- [ ] Strong JWT secret (32+ characters, random)
- [ ] CORS origins set to specific domains (not `*`)
- [ ] Health checks configured and passing
- [ ] Monitoring and alerts set up
- [ ] Secrets are secure and not in code
- [ ] GitHub Actions workflow is working
- [ ] App is accessible and responding
- [ ] Logs show no errors
- [ ] Database connection is stable

---

## Useful Dashboard Links

- **App Dashboard**: `https://fly.io/dashboard/apps/beforeu-backend`
- **Metrics**: `https://fly.io/dashboard/apps/beforeu-backend/metrics`
- **Logs**: `https://fly.io/dashboard/apps/beforeu-backend/logs`
- **Secrets**: `https://fly.io/dashboard/apps/beforeu-backend/secrets`
- **Deployments**: `https://fly.io/dashboard/apps/beforeu-backend/deployments`

---

## Summary

✅ **Dashboard-Based**: All configuration via Fly.io dashboard  
✅ **GitHub Integration**: Automated deployments on push  
✅ **CI/CD Pipeline**: GitHub Actions handles builds and deploys  
✅ **Secrets Management**: Secure secret storage via dashboard  
✅ **Monitoring**: Built-in metrics and logs  
✅ **Production-Ready**: Scalable and maintainable setup  

---

**Next Steps:**
1. Follow this guide step-by-step
2. Verify deployment works
3. Set up monitoring and alerts
4. Configure custom domain (optional)

For command-line deployment, see `DEPLOYMENT_GUIDE.md`

