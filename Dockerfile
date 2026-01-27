# Tide Commander Dockerfile
# Multi-stage build for optimized production image

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built assets from builder
COPY --from=builder /app/dist ./dist

# Copy server files (TypeScript compiled to JS)
COPY --from=builder /app/src/packages/server ./src/packages/server
COPY --from=builder /app/src/packages/shared ./src/packages/shared

# Create directories for runtime data
RUN mkdir -p /root/.tide-commander

# Expose port
EXPOSE 5174

# Environment variables
ENV NODE_ENV=production
ENV PORT=5174

# Start the server
CMD ["node", "--experimental-specifier-resolution=node", "src/packages/server/index.js"]
