#!/bin/bash
set -e

echo "🎵 Mixarr (slim) starting..."
echo ""

# ============================================
# 0. Auto-generate SESSION_SECRET if not set
# ============================================
if [ -z "$SESSION_SECRET" ]; then
  export SESSION_SECRET=$(openssl rand -hex 32)
  echo "🔑 Generated random SESSION_SECRET (will change on restart)"
  echo "   Set SESSION_SECRET explicitly for persistent sessions."
  echo ""
fi

# ============================================
# 1. Validate required environment
# ============================================
MISSING_VARS=0

if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL is required"
  echo "   Example: mysql://user:pass@host:3306/mixarr"
  MISSING_VARS=1
fi

if [ -z "$REDIS_URL" ]; then
  echo "❌ ERROR: REDIS_URL is required"
  echo "   Example: redis://host:6379"
  MISSING_VARS=1
fi

if [ "$MISSING_VARS" -eq 1 ]; then
  echo ""
  echo "Please set the required environment variables and try again."
  exit 1
fi

# Mask password in log output
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^/]+)/.*|\1|')
echo "📋 Configuration:"
echo "   Database: ${DB_HOST}"
echo "   Redis:    ${REDIS_URL}"
echo ""

# ============================================
# 2. Wait for database
# ============================================
echo "⏳ Waiting for database..."
MAX_RETRIES=30
RETRY=0

# Note: Must run from /app/api where node_modules and Prisma client are located
until cd /app/api && node -e "
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  prisma.\$connect()
    .then(() => { prisma.\$disconnect(); process.exit(0); })
    .catch(() => process.exit(1));
" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "❌ Database connection timeout after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "   Attempt $RETRY/$MAX_RETRIES..."
  sleep 2
done
echo "✅ Database connected"

# ============================================
# 3. Wait for Redis
# ============================================
echo "⏳ Waiting for Redis..."
RETRY=0

# Note: Must run from /app/api where node_modules are located
until cd /app/api && node -e "
  const Redis = require('ioredis');
  const r = new Redis(process.env.REDIS_URL, { 
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    lazyConnect: true
  });
  r.connect()
    .then(() => r.ping())
    .then(() => { r.disconnect(); process.exit(0); })
    .catch(() => process.exit(1));
" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "❌ Redis connection timeout after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "   Attempt $RETRY/$MAX_RETRIES..."
  sleep 2
done
echo "✅ Redis connected"

# ============================================
# 4. Sync database schema
# ============================================
echo ""
echo "🔄 Syncing database schema..."
cd /app/api
node dist/scripts/deploy-schema.js
echo "✅ Schema sync complete"
echo ""

# ============================================
# 5. Start services
# ============================================
echo "🚀 Starting API server on :3005..."
cd /app/api
PORT=3005 node dist/index.js &
API_PID=$!

echo "🌐 Starting Web server on :3000..."
cd /app/web/apps/web
PORT=3000 HOSTNAME=0.0.0.0 node server.js &
WEB_PID=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Mixarr ready!"
echo ""
echo "   Web UI: http://localhost:3000"
echo "   API:    http://localhost:3005"
echo "   Health: http://localhost:3005/api/health"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================
# 6. Handle signals for graceful shutdown
# ============================================
cleanup() {
  echo ""
  echo "🛑 Shutting down gracefully..."
  kill -TERM $API_PID $WEB_PID 2>/dev/null || true
  wait $API_PID $WEB_PID 2>/dev/null || true
  echo "👋 Goodbye!"
  exit 0
}

trap cleanup SIGTERM SIGINT

# ============================================
# 7. Wait for either process to exit
# ============================================
wait -n $API_PID $WEB_PID
EXIT_CODE=$?

echo ""
echo "❌ Process exited with code $EXIT_CODE, shutting down..."

# Kill the other process gracefully
kill -TERM $API_PID $WEB_PID 2>/dev/null || true
sleep 2
kill -KILL $API_PID $WEB_PID 2>/dev/null || true

exit $EXIT_CODE
