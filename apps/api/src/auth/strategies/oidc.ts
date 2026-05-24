import { Issuer, Strategy as OpenIDStrategy } from 'openid-client';
import type { Client, TokenSet, UserinfoResponse } from 'openid-client';
import type { PrismaClient } from '@prisma/client';

const DEFAULT_EMAIL_ATTRIBUTE = 'email';
const DEFAULT_DISPLAY_NAME_ATTRIBUTE = 'name';
const DEFAULT_USERNAME_ATTRIBUTE = 'preferred_username';

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scopes?: string;
  allowedDomains?: string[];
  emailAttribute?: string;
  displayNameAttribute?: string;
  usernameAttribute?: string;
}

type OidcUser = Express.User | false;
type DoneCallback = (err: unknown, user?: OidcUser, info?: { message?: string }) => void;

export async function createOidcStrategy(
  config: OidcConfig,
  prisma: PrismaClient
): Promise<OpenIDStrategy<OidcUser, Client>> {
  const issuer = await Issuer.discover(config.issuerUrl);

  const client = new issuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.callbackUrl],
    response_types: ['code'],
  });

  const emailAttribute = config.emailAttribute || DEFAULT_EMAIL_ATTRIBUTE;
  const displayNameAttribute = config.displayNameAttribute || DEFAULT_DISPLAY_NAME_ATTRIBUTE;
  const usernameAttribute = config.usernameAttribute || DEFAULT_USERNAME_ATTRIBUTE;

  return new OpenIDStrategy<OidcUser, Client>(
    {
      client,
      params: {
        scope: config.scopes || 'openid email profile',
      },
    },
    async (tokenset: TokenSet, userinfo: UserinfoResponse, done: DoneCallback) => {
      try {
        const claims = tokenset.claims();
        const readClaim = (key: string): string | undefined => {
          const value = userinfo[key] ?? claims[key];
          return typeof value === 'string' ? value : undefined;
        };

        const email = readClaim(emailAttribute);
        const sub = readClaim('sub');

        if (!email) {
          return done(null, false, { message: 'No email in OIDC profile' });
        }
        if (!sub) {
          return done(null, false, { message: 'No subject identifier in OIDC profile' });
        }

        if (config.allowedDomains?.length) {
          const domain = email.split('@')[1]?.toLowerCase();
          if (!domain || !config.allowedDomains.includes(domain)) {
            return done(null, false, { message: 'Email domain not allowed' });
          }
        }

        // Find user by email (MySQL is case-insensitive by default for VARCHAR)
        const user = await prisma.user.findFirst({
          where: { email: email.toLowerCase() },
        });

        if (!user) {
          return done(null, false, {
            message: 'No account found for this email. Contact your administrator.',
          });
        }

        if (!user.isActive) {
          return done(null, false, { message: 'Your account has been disabled.' });
        }

        const displayName = readClaim(displayNameAttribute) || readClaim(usernameAttribute);
        const picture = readClaim('picture');

        await prisma.authIdentity.upsert({
          where: {
            provider_providerUserId: {
              provider: 'oidc',
              providerUserId: sub,
            },
          },
          create: {
            userId: user.id,
            provider: 'oidc',
            providerUserId: sub,
            email,
            metadata: {
              displayName,
              picture,
              issuer: issuer.metadata.issuer,
            },
          },
          update: {
            lastUsedAt: new Date(),
            email,
            metadata: {
              displayName,
              picture,
              issuer: issuer.metadata.issuer,
            },
          },
        });

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
