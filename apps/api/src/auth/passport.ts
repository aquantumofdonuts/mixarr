import type { Express, RequestHandler } from 'express';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import session, { MemoryStore } from 'express-session';
import prisma from '../lib/db.js';

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
// Using explicit MemoryStore to suppress the production warning.
// Sessions are lost on container restart, which is acceptable for this app.
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
export const sessionMiddleware: RequestHandler = session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  store: new MemoryStore(),
  proxy: true, // Trust the reverse proxy (Caddy/Next.js) for secure cookies
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax', // CSRF protection: blocks cross-site POST/PUT/DELETE with cookies
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
});

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
      const user = await prisma.user.findUnique({
        where: { id },
      });
      
      if (!user) {
        return done(null, false);
      }
      
      done(null, {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      });
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
