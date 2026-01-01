/**
 * Google OAuth Strategy
 * 
 * Authenticates users via Google OAuth 2.0.
 * Users must be pre-provisioned with matching email addresses.
 */

import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import type { PrismaClient } from '@prisma/client';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  allowedDomains?: string[];
}

export function createGoogleStrategy(
  config: GoogleOAuthConfig,
  prisma: PrismaClient
): GoogleStrategy {
  return new GoogleStrategy(
    {
      clientID: config.clientId,
      clientSecret: config.clientSecret,
      callbackURL: config.callbackUrl,
      scope: ['profile', 'email'],
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        
        if (!email) {
          return done(null, false, { message: 'No email in Google profile' });
        }

        // Check domain restriction
        if (config.allowedDomains?.length) {
          const domain = email.split('@')[1];
          if (!config.allowedDomains.includes(domain)) {
            return done(null, false, { message: 'Email domain not allowed' });
          }
        }

        // Find user by email (MySQL is case-insensitive by default for VARCHAR)
        const user = await prisma.user.findFirst({
          where: { email: email.toLowerCase() },
        });

        if (!user) {
          return done(null, false, { 
            message: 'No account found for this email. Contact your administrator.' 
          });
        }

        if (!user.isActive) {
          return done(null, false, { message: 'Your account has been disabled.' });
        }

        // Link or update identity
        await prisma.authIdentity.upsert({
          where: {
            provider_providerUserId: {
              provider: 'google',
              providerUserId: profile.id,
            },
          },
          create: {
            userId: user.id,
            provider: 'google',
            providerUserId: profile.id,
            email: email,
            metadata: {
              displayName: profile.displayName,
              picture: profile.photos?.[0]?.value,
            },
          },
          update: {
            lastUsedAt: new Date(),
            metadata: {
              displayName: profile.displayName,
              picture: profile.photos?.[0]?.value,
            },
          },
        });

        // Update user's last login
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
        });

        return done(null, {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
        });
      } catch (error) {
        return done(error as Error);
      }
    }
  );
}
