/**
 * SAML 2.0 Authentication Strategy
 * 
 * Authenticates users via SAML Identity Providers.
 * Users must be pre-provisioned with matching email addresses.
 */

import { Strategy as SamlStrategy, Profile, SamlConfig as PassportSamlConfig } from '@node-saml/passport-saml';
import type { PrismaClient } from '@prisma/client';

export interface SamlConfig {
  callbackUrl: string;
  entryPoint?: string;     // IdP SSO URL
  idpCertificate?: string;
  idpMetadataUrl?: string; // Alternative to entryPoint + cert
  issuer: string;
  emailAttribute?: string;
  displayNameAttribute?: string;
}

export function createSamlStrategy(
  config: SamlConfig,
  prisma: PrismaClient
): SamlStrategy {
  const strategyOptions: PassportSamlConfig = {
    callbackUrl: config.callbackUrl,
    issuer: config.issuer,
    wantAuthnResponseSigned: false, // Allow unsigned for easier testing
    idpCert: config.idpCertificate || '', // Required by type, can be empty if not validating
  };

  if (config.entryPoint) {
    strategyOptions.entryPoint = config.entryPoint;
  }

  return new SamlStrategy(
    strategyOptions,
    async (profile: Profile | null | undefined, done: (err: Error | null, user?: any, info?: { message: string }) => void) => {
      try {
        if (!profile) {
          return done(null, false, { message: 'No profile received from IdP' });
        }

        const emailAttr = config.emailAttribute || 'email';
        const email = profile[emailAttr] as string || profile.nameID;
        
        if (!email) {
          return done(null, false, { message: 'No email in SAML response' });
        }

        // Find user by email
        const user = await prisma.user.findFirst({
          where: { email },
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
        const displayName = profile[config.displayNameAttribute || 'displayName'];
        await prisma.authIdentity.upsert({
          where: {
            provider_providerUserId: {
              provider: 'saml',
              providerUserId: profile.nameID || email,
            },
          },
          create: {
            userId: user.id,
            provider: 'saml',
            providerUserId: profile.nameID || email,
            email: email,
            metadata: {
              displayName: typeof displayName === 'string' ? displayName : null,
              issuer: profile.issuer,
            },
          },
          update: {
            lastUsedAt: new Date(),
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
    },
    // Logout callback (required by passport-saml)
    async (_profile: Profile | null | undefined, done: (err: Error | null, user?: any) => void) => {
      done(null, null);
    }
  );
}
