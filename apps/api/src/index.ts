import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
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
import notificationsRouter from './routes/notifications.js';
import { duplicatesRouter } from './routes/duplicates.js';
import { ssoRouter } from './routes/sso.js';
import { setupPassport, sessionMiddleware } from './auth/passport.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { initializeScheduler } from './jobs/scheduler.js';
import { redis } from './lib/redis.js';
// Import workers to start them
import './jobs/subscription-worker.js';
import './jobs/import-worker.js';

// Validate required environment variables in production
const sessionSecret = process.env.SESSION_SECRET;
if (process.env.NODE_ENV === 'production' && (!sessionSecret || sessionSecret === 'dev-secret-change-in-production')) {
  console.error('FATAL: SESSION_SECRET must be set to a secure value in production');
  process.exit(1);
}

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(requestLogger);

// Passport authentication (includes session middleware)
setupPassport(app);

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
app.use('/api/notifications', notificationsRouter);
app.use('/api/duplicates', duplicatesRouter);
app.use('/api/sso', ssoRouter);

// Error handler
app.use(errorHandler);

// WebSocket connections with authentication
io.use((socket, next) => {
  // Parse session from handshake
  sessionMiddleware(socket.request as any, {} as any, () => {
    const session = (socket.request as any).session;
    if (session?.passport?.user) {
      // Attach user ID to socket for filtering events
      (socket as any).userId = session.passport.user;
      next();
    } else {
      next(new Error('Authentication required'));
    }
  });
});

io.on('connection', (socket) => {
  const userId = (socket as any).userId;
  // Join a room for this user so we can send targeted events
  socket.join(`user:${userId}`);
  console.log(`Client connected: ${socket.id} (user: ${userId})`);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3010;

httpServer.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
  
  // Initialize job scheduler
  initializeScheduler();
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down gracefully...`);
  
  // Stop accepting new connections
  httpServer.close(() => {
    console.log('HTTP server closed');
  });
  
  // Close Redis connection
  try {
    await redis.quit();
    console.log('Redis connection closed');
  } catch (err) {
    console.error('Error closing Redis:', err);
  }
  
  // Give time for cleanup
  setTimeout(() => {
    console.log('Shutdown complete');
    process.exit(0);
  }, 1000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { app, io };
