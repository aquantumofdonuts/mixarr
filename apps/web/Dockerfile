# syntax=docker/dockerfile:1.4
FROM node:20-alpine AS base
WORKDIR /app

# Dependencies stage - cached separately
FROM base AS deps
COPY package*.json ./
COPY turbo.json ./
COPY tsconfig.base.json ./
COPY apps/web/package*.json ./apps/web/
COPY packages/shared-types/package*.json ./packages/shared-types/
COPY packages/config/package*.json ./packages/config/
# Use BuildKit cache mount for npm
RUN --mount=type=cache,target=/root/.npm \
    npm install

# Development stage
FROM deps AS development
COPY . .

# Build stage - Build at runtime to allow env vars
FROM development AS builder

# Build args for API URL
ARG API_URL=http://localhost:3010
ENV API_URL=${API_URL}

RUN npm run build --workspace=@mixarr/web

# Production stage
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
