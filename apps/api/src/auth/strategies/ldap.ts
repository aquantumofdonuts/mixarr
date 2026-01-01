/**
 * LDAP Authentication Strategy
 * 
 * Authenticates users via LDAP/Active Directory.
 * Users must be pre-provisioned with matching email addresses.
 */

// Note: @types/passport-ldapauth doesn't exist, using minimal type declarations
import LdapStrategy from 'passport-ldapauth';
import type { PrismaClient } from '@prisma/client';

export interface LdapConfig {
  serverUrl: string;
  bindDn: string;
  bindPassword: string;
  searchBaseDn: string;
  searchFilter: string;
  emailAttribute: string;
  displayNameAttribute?: string;
}

export function createLdapStrategy(
  config: LdapConfig,
  prisma: PrismaClient
): InstanceType<typeof LdapStrategy> {
  return new LdapStrategy(
    {
      server: {
        url: config.serverUrl,
        bindDN: config.bindDn,
        bindCredentials: config.bindPassword,
        searchBase: config.searchBaseDn,
        searchFilter: config.searchFilter || '(uid={{username}})',
        searchAttributes: [config.emailAttribute, config.displayNameAttribute || 'cn'],
      },
    },
    async (ldapUser: Record<string, any>, done: (err: Error | null, user?: any, info?: { message: string }) => void) => {
      try {
        const email = ldapUser[config.emailAttribute];
        
        if (!email) {
          return done(null, false, { message: 'No email in LDAP response' });
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
        await prisma.authIdentity.upsert({
          where: {
            provider_providerUserId: {
              provider: 'ldap',
              providerUserId: ldapUser.dn || email,
            },
          },
          create: {
            userId: user.id,
            provider: 'ldap',
            providerUserId: ldapUser.dn || email,
            email: email,
            metadata: {
              displayName: ldapUser[config.displayNameAttribute || 'cn'],
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
    }
  );
}
