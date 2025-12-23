# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN yarn build

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install production dependencies only
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create a non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Set ownership
RUN chown -R appuser:appgroup /app

USER appuser

# Default command
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]

# Development stage - runs with tsx for hot reload
FROM node:22-alpine AS development

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install all dependencies (including dev)
RUN yarn install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Create a non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Set ownership
RUN chown -R appuser:appgroup /app

USER appuser

ENTRYPOINT ["yarn", "start"]
CMD ["--help"]
