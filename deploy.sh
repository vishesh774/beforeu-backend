#!/bin/bash

# BeforeU Backend - Fly.io Deployment Script
# This script helps deploy the backend to Fly.io

set -e  # Exit on error

echo "🚀 BeforeU Backend - Fly.io Deployment"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if fly CLI is installed
if ! command -v fly &> /dev/null; then
    echo -e "${RED}❌ Fly CLI is not installed${NC}"
    echo "Install it with: curl -L https://fly.io/install.sh | sh"
    exit 1
fi

# Check if user is logged in
if ! fly auth whoami &> /dev/null; then
    echo -e "${YELLOW}⚠️  Not logged in to Fly.io${NC}"
    echo "Logging in..."
    fly auth login
fi

echo -e "${GREEN}✅ Fly CLI is installed and you're logged in${NC}"
echo ""

# Check if app exists
APP_NAME="beforeu-backend"
if fly apps list | grep -q "$APP_NAME"; then
    echo -e "${GREEN}✅ App '$APP_NAME' exists${NC}"
else
    echo -e "${YELLOW}⚠️  App '$APP_NAME' does not exist${NC}"
    read -p "Create new app? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        fly apps create "$APP_NAME"
    else
        echo "Exiting..."
        exit 1
    fi
fi

echo ""
echo "📋 Checking secrets..."
echo ""

# Check required secrets
REQUIRED_SECRETS=("MONGODB_URI" "JWT_SECRET" "NODE_ENV" "CORS_ORIGIN")
MISSING_SECRETS=()

for secret in "${REQUIRED_SECRETS[@]}"; do
    if fly secrets list -a "$APP_NAME" | grep -q "$secret"; then
        echo -e "${GREEN}✅ $secret is set${NC}"
    else
        echo -e "${RED}❌ $secret is NOT set${NC}"
        MISSING_SECRETS+=("$secret")
    fi
done

if [ ${#MISSING_SECRETS[@]} -ne 0 ]; then
    echo ""
    echo -e "${YELLOW}⚠️  Missing required secrets:${NC}"
    for secret in "${MISSING_SECRETS[@]}"; do
        echo "  - $secret"
    done
    echo ""
    echo "Set them with:"
    echo "  fly secrets set MONGODB_URI=\"your-connection-string\" -a $APP_NAME"
    echo "  fly secrets set JWT_SECRET=\"your-secret\" -a $APP_NAME"
    echo "  fly secrets set NODE_ENV=\"production\" -a $APP_NAME"
    echo "  fly secrets set CORS_ORIGIN=\"your-frontend-urls\" -a $APP_NAME"
    echo ""
    read -p "Continue with deployment anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Exiting..."
        exit 1
    fi
fi

echo ""
echo "🔨 Building and deploying..."
echo ""

# Build and deploy
fly deploy -a "$APP_NAME"

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "📊 Checking status..."
fly status -a "$APP_NAME"

echo ""
echo "📝 View logs with:"
echo "  fly logs -a $APP_NAME"
echo ""
echo "🌐 Your app URL:"
fly info -a "$APP_NAME" | grep "Hostname" || echo "  https://$APP_NAME.fly.dev"
echo ""
echo "🧪 Test health endpoint:"
echo "  curl https://$APP_NAME.fly.dev/health"
echo ""

