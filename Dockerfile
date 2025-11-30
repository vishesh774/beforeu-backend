# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=20.18.0
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"

# Node.js app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base AS build

# Temporarily unset NODE_ENV to ensure devDependencies are installed
ENV NODE_ENV=""

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# Install node modules (including devDependencies for build)
COPY package-lock.json package.json ./
RUN npm ci

# Copy application code
COPY . .

# Build application
RUN npm run build

# Remove development dependencies
RUN npm prune --omit=dev

# Set NODE_ENV back to production for final stage
ENV NODE_ENV="production"


# Final stage for app image
FROM base

# Copy package files and production dependencies
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Start the server by default, this can be overwritten at runtime
EXPOSE 5000
ENV PORT=5000
CMD [ "npm", "run", "start" ]
