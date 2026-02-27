import type { Express, RequestHandler } from 'express';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import RedisStore from 'connect-redis';
import Redis from 'ioredis';
import prisma from '../lib/db.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('Auth');

// Create Redis client for session store
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const sessionRedis = new Redis.default(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 200, 2000),
  lazyConnect: true,
});

sessionRedis.on('error', (err: Error) => {
  logger.error('Session Redis error', { error: err.message });
});

sessionRedis.on('connect', () => {
  logger.info('Session Redis connected');
});

declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      displayName: string;
      role: 'admin' | 'user';
    }
  }
}

// Create session middleware - exported for Socket.IO authentication
// Sessions are stored in Redis for persistence across restarts and horizontal scaling.
//
// CSRF Protection Strategy:
// -------------------------
// This application uses sameSite='lax' cookies as the primary CSRF defense.
// This approach is appropriate because:
// 1. All state-changing operations use POST/PUT/DELETE (not GET)
// 2. Modern browsers (95%+) fully support sameSite cookies
// 3. sameSite='lax' blocks cross-origin POST requests with cookies
// 4. No additional CSRF tokens are needed for this protection level
//
// Note: sameSite='lax' allows cookies on top-level GET navigations, which is
// required for OAuth callbacks (Google, SAML) to work correctly.
// lgtm[js/missing-csrf-protection] - Using sameSite='lax' cookies as CSRF defense (see comments above)
export const sessionMiddleware: RequestHandler = session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  store: new RedisStore({
    client: sessionRedis,
    prefix: 'mixarr:sess:',
  }),
  proxy: true, // Trust the reverse proxy (Caddy/Next.js) for secure cookies
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax', // CSRF protection: blocks cross-site POST/PUT/DELETE with cookies
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
});

// Export for graceful shutdown
export { sessionRedis };

/**
 * Look up a user by ID and verify they are active.
 * Extracted so both passport.deserializeUser and tests use the same logic.
 */
export async function lookupSessionUser(
  id: number
): Promise<Express.User | false> {
  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user || !user.isActive) {
    return false;
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

export function setupPassport(app: Express): void {
  // Use the shared session middleware
  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  // Local strategy for username/password authentication
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await prisma.user.findUnique({
          where: { username },
        });
        
        if (!user) {
          return done(null, false, { message: 'Invalid username or password' });
        }

        // SSO users don't have a password hash
        if (!user.passwordHash) {
          return done(null, false, { message: 'Invalid username or password' });
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);

        if (!isValid) {
          return done(null, false, { message: 'Invalid username or password' });
        }

        return done(null, {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
        });
      } catch (error) {
        return done(error);
      }
    })
  );

  // Serialize user to session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id: number, done) => {
    try {
      const result = await lookupSessionUser(id);
      done(null, result);
    } catch (error) {
      done(error);
    }
  });
}

// Helper to hash passwords
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// Helper to verify passwords
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
