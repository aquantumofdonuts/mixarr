import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createLogger } from './lib/logger.js';
import { printBanner } from './version.js';
import { startUpdateChecker } from './services/update-checker.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { connectionsRouter } from './routes/connections.js';
import { searchRouter } from './routes/search.js';
import { settingsRouter } from './routes/settings.js';
import { subscriptionsRouter } from './routes/subscriptions.js';
import { importsRouter } from './routes/imports.js';
import { jobsRouter } from './routes/jobs.js';
import { logsRouter } from './routes/logs.js';
import { aiRouter } from './routes/ai.js';
import { dashboardRouter } from './routes/dashboard.js';
import { adminRouter } from './routes/admin.js';
import { discoverRouter } from './routes/discover.js';
import { feedRouter } from './routes/feed.js';
import notificationsRouter from './routes/notifications.js';
import { duplicatesRouter } from './routes/duplicates.js';
import { ssoRouter } from './routes/sso.js';
import { setupPassport, sessionMiddleware, sessionRedis } from './auth/passport.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { correlationMiddleware } from './middleware/correlation.js';
import type { AuthenticatedSocket, SessionIncomingMessage, SocketSessionResponse } from './types/socket.js';
import { apiLimiter } from './middleware/rate-limiter.js';
import { initializeScheduler } from './jobs/scheduler.js';
import { setupJobEventBroadcasting } from './jobs/queue.js';
import { warmLidarrCaches } from './services/lidarr-warmup.js';
import { redis } from './lib/redis.js';
import slskdRouter, { cleanupQueueEvents } from './routes/slskd.js';
import { applyNetworkPreflight } from './lib/network-preflight.js';

// Probe outbound IPv6 connectivity before any worker establishes pools.
// On hosts where v6 is advertised but egress is broken, this falls back to v4.
if (process.env.NODE_ENV !== 'test') {
  await applyNetworkPreflight();
}

// Import workers only in non-test environments to prevent test pollution
if (process.env.NODE_ENV !== 'test') {
  await import('./jobs/subscription-worker.js');
  await import('./jobs/import-worker.js');
  await import('./jobs/slskd-operations-worker.js');
}

// Print startup banner
printBanner();

// Start background update checker (first check 30s after boot)
startUpdateChecker();

// Validate required environment variables in production
const sessionSecret = process.env.SESSION_SECRET;
if (process.env.NODE_ENV === 'production' && (!sessionSecret || sessionSecret === 'dev-secret-change-in-production')) {
  const startupLogger = createLogger('Startup');
  startupLogger.error('FATAL: SESSION_SECRET must be set to a secure value in production');
  process.exit(1);
}

const app = express();

// Trust proxy - required for secure cookies behind reverse proxies (Caddy/Next.js)
// This tells Express to trust X-Forwarded-* headers from the first proxy
app.set('trust proxy', 1);

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
});

// Security Headers via Helmet
// See: https://helmetjs.github.io/
// Provides: X-Content-Type-Options, X-Frame-Options, HSTS, and more
app.use(helmet({
  // Content Security Policy - restrictive policy for JSON-only API
  // The frontend (Next.js) handles its own CSP for web pages
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  
  // X-Frame-Options: DENY - API should never be embedded in iframes
  frameguard: { action: 'deny' },
  
  // HSTS - Enforce HTTPS (maxAge: 1 year, includeSubDomains)
  // Only effective when served over HTTPS (Caddy handles this)
  strictTransportSecurity: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
  },
  
  // Other defaults enabled:
  // - X-Content-Type-Options: nosniff (prevents MIME sniffing)
  // - X-XSS-Protection: 0 (disabled, CSP is modern replacement)
  // - X-DNS-Prefetch-Control: off (privacy protection)
  // - X-Permitted-Cross-Domain-Policies: none (Flash/PDF protection)
  // - Referrer-Policy: no-referrer (privacy protection)
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(correlationMiddleware);
app.use(requestLogger);

// Passport authentication (includes session middleware)
setupPassport(app);

// Warn about weak session secrets
const isDefaultSecret = sessionSecret === 'dev-secret-change-in-production';
const isWeak = sessionSecret && (sessionSecret.length < 32 || /^[a-zA-Z0-9]+$/.test(sessionSecret));
const startupLogger = createLogger('Startup');

if (isDefaultSecret || isWeak) {
  startupLogger.warn('⚠️  SECURITY WARNING: SESSION_SECRET is weak or default');
  startupLogger.warn('   Generate a secure secret with: openssl rand -base64 32');
  startupLogger.warn('   Set SESSION_SECRET in your .env file');
}

// Global rate limiting for all API routes
app.use('/api', apiLimiter);

// Make io available to routes
app.set('io', io);

// Routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/search', searchRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/imports', importsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/logs', logsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/admin', adminRouter);
app.use('/api/discover', discoverRouter);
app.use('/api/feed', feedRouter());
app.use('/api/notifications', notificationsRouter);
app.use('/api/slskd', slskdRouter);
app.use('/api/duplicates', duplicatesRouter);
app.use('/api/sso', ssoRouter);

// Error handler
app.use(errorHandler);

// WebSocket connections with authentication
io.use((socket, next) => {
  const authSocket = socket as AuthenticatedSocket;
  const req = authSocket.request;
  
  // Parse session from handshake
  // Note: sessionMiddleware is typed as Express RequestHandler but works with raw IncomingMessage
  // Using typed function signature via unknown to properly type the middleware call
  type SessionMiddlewareFn = (req: SessionIncomingMessage, res: SocketSessionResponse, next: () => void) => void;
  const middleware = sessionMiddleware as unknown as SessionMiddlewareFn;
  
  middleware(req, {}, () => {
    const session = req.session;
    if (session?.passport?.user) {
      // Attach user ID to socket for filtering events
      authSocket.userId = session.passport.user;
      next();
    } else {
      next(new Error('Authentication required'));
    }
  });
});

const log = createLogger('Server');

io.on('connection', (socket) => {
  const authSocket = socket as AuthenticatedSocket;
  const userId = authSocket.userId;
  // Join a room for this user so we can send targeted events
  socket.join(`user:${userId}`);
  log.debug(`Client connected: ${socket.id} (user: ${userId})`);
  
  socket.on('disconnect', () => {
    log.debug('Client disconnected:', socket.id);
  });
});

// Only start server in non-test environments
// Tests import app directly without starting the HTTP server
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3010;

  httpServer.listen(PORT, () => {
    log.info(`API server running on port ${PORT}`);

    // Initialize job scheduler
    initializeScheduler();

    // Broadcast BullMQ job lifecycle events to connected Socket.IO clients
    setupJobEventBroadcasting(io);

    // Warm shared Lidarr caches in the background (never blocks startup)
    void warmLidarrCaches();
  });
}

// Graceful shutdown
const SHUTDOWN_GRACE_MS = 10_000;

const gracefulShutdown = async (signal: string) => {
  log.info(`Received ${signal}, shutting down gracefully...`);

  // Hard deadline: if cleanup hangs, force-exit. unref() so this timer
  // doesn't keep the process alive once cleanup finishes.
  const forceExit = setTimeout(() => {
    log.warn(`Shutdown grace period (${SHUTDOWN_GRACE_MS}ms) exceeded, forcing exit`);
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forceExit.unref();

  // Stop accepting new connections and wait for in-flight requests to drain
  await new Promise<void>((resolve) => {
    httpServer.close((err) => {
      if (err) {
        log.warn('HTTP server close error', { error: err.message });
      } else {
        log.info('HTTP server closed');
      }
      resolve();
    });
    // Sockets without active requests (e.g. keep-alive) would otherwise
    // hold close() open indefinitely
    httpServer.closeIdleConnections?.();
  });

  // Close slskd QueueEvents connection
  try {
    await cleanupQueueEvents();
    log.info('QueueEvents connection closed');
  } catch (error) {
    log.error('Error closing QueueEvents', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
  
  // Close session Redis connection
  try {
    await sessionRedis.disconnect();
    log.info('Session Redis connection closed');
  } catch (error) {
    log.error('Error closing session Redis', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  // Close Redis connection
  try {
    await redis.quit();
    log.info('Redis connection closed');
  } catch (error) {
    log.error('Error closing Redis', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
  
  clearTimeout(forceExit);
  log.info('Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, _promise) => {
  log.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception — shutting down', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

export { app, io };
