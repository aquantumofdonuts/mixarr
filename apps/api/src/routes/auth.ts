import { Router } from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import prisma from '../lib/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { parseIntParam } from '../utils/params.js';
import { loginLimiter, setupLimiter, createUserLimiter } from '../middleware/rate-limiter.js';
import { SsoProviderService } from '../services/sso-provider.js';
import { createGoogleStrategy } from '../auth/strategies/google.js';
import { createLdapStrategy } from '../auth/strategies/ldap.js';
import { createSamlStrategy } from '../auth/strategies/saml.js';
import { PlexAuthService } from '../auth/strategies/plex.js';

export const authRouter = Router();
const ssoService = new SsoProviderService(prisma);

// Check if setup is required (setup wizard not completed)
// Also returns adminExists and baseUrlExists to help frontend resume at the right step
authRouter.get('/setup-required', async (_req, res) => {
  try {
    const [setupCompleted, userCount, baseUrl] = await Promise.all([
      prisma.globalSetting.findUnique({ where: { key: 'setupCompleted' } }),
      prisma.user.count(),
      prisma.globalSetting.findUnique({ where: { key: 'baseUrl' } }),
    ]);
    res.json({ 
      setupRequired: !setupCompleted?.value,
      adminExists: userCount > 0,
      baseUrlExists: !!baseUrl?.value,
    });
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Mark setup as complete (called after URL configuration step)
// Public endpoint but with safety checks - only works during legitimate setup
authRouter.post('/complete-setup', async (_req, res) => {
  try {
    // Safety check 1: Can only complete setup once
    const setupCompleted = await prisma.globalSetting.findUnique({
      where: { key: 'setupCompleted' },
    });
    if (setupCompleted?.value === true) {
      res.status(400).json({ error: 'Setup already completed' });
      return;
    }
    
    // Safety check 2: Must have at least one admin user
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      res.status(400).json({ error: 'No admin user exists' });
      return;
    }
    
    // Safety check 3: Base URL must be configured
    const baseUrl = await prisma.globalSetting.findUnique({
      where: { key: 'baseUrl' },
    });
    if (!baseUrl?.value) {
      res.status(400).json({ error: 'Base URL not configured' });
      return;
    }
    
    await prisma.globalSetting.upsert({
      where: { key: 'setupCompleted' },
      create: { key: 'setupCompleted', value: true },
      update: { value: true },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete setup' });
  }
});

// Public: Get enabled SSO providers (for login page)
authRouter.get('/sso/enabled', async (_req, res) => {
  try {
    const providers = await ssoService.getEnabled();
    res.json({ providers });
  } catch (error) {
    console.error('Failed to fetch enabled SSO providers:', error);
    res.status(500).json({ error: 'Failed to fetch providers' });
  }
});

// Google OAuth - initiate
authRouter.get('/sso/google', async (req, res, next) => {
  try {
    // Load Google config from database
    const provider = await prisma.ssoProvider.findUnique({
      where: { type: 'google' },
    });
    
    if (!provider?.isEnabled) {
      res.status(400).json({ error: 'Google authentication is not available' });
      return;
    }

    const config = provider.config as { clientId: string; clientSecret: string; allowedDomains?: string };
    const baseUrlSetting = await prisma.globalSetting.findUnique({ where: { key: 'baseUrl' } });
    const baseUrl = (baseUrlSetting?.value as string) || 'http://localhost:3010';
    
    // Register strategy dynamically
    passport.use('google-sso', createGoogleStrategy({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      callbackUrl: `${baseUrl}/api/auth/sso/google/callback`,
      allowedDomains: config.allowedDomains?.split(',').map((d: string) => d.trim()),
    }, prisma));

    passport.authenticate('google-sso', { scope: ['profile', 'email'] })(req, res, next);
  } catch (error) {
    console.error('Google OAuth initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate Google authentication' });
  }
});

// Google OAuth - callback
authRouter.get('/sso/google/callback', (req, res, next) => {
  passport.authenticate('google-sso', (err: Error | null, user: Express.User | false, info: { message?: string }) => {
    if (err) {
      console.error('Google OAuth error:', err);
      return res.redirect('/login?error=auth_failed');
    }
    if (!user) {
      const msg = encodeURIComponent(info?.message || 'Authentication failed');
      return res.redirect(`/login?error=${msg}`);
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return res.redirect('/login?error=login_failed');
      }
      return res.redirect('/');
    });
  })(req, res, next);
});

// LDAP login (POST with username/password in body)
authRouter.post('/sso/ldap', loginLimiter, async (req, res, next) => {
  try {
    const provider = await prisma.ssoProvider.findUnique({
      where: { type: 'ldap' },
    });
    
    if (!provider?.isEnabled) {
      res.status(400).json({ error: 'LDAP authentication is not available' });
      return;
    }

    const config = provider.config as {
      serverUrl: string;
      bindDn: string;
      bindPassword: string;
      searchBaseDn: string;
      searchFilter: string;
      emailAttribute: string;
      displayNameAttribute?: string;
    };
    
    passport.use('ldap-sso', createLdapStrategy(config, prisma));

    passport.authenticate('ldap-sso', (err: Error | null, user: Express.User | false, info: { message?: string }) => {
      if (err) {
        console.error('LDAP auth error:', err);
        return res.status(500).json({ error: 'Authentication failed' });
      }
      if (!user) {
        return res.status(401).json({ error: info?.message || 'Invalid credentials' });
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          return res.status(500).json({ error: 'Login failed' });
        }
        return res.json({ success: true, user });
      });
    })(req, res, next);
  } catch (error) {
    console.error('LDAP login error:', error);
    res.status(500).json({ error: 'LDAP authentication failed' });
  }
});

// SAML - initiate
authRouter.get('/sso/saml', async (req, res, next) => {
  const provider = await prisma.ssoProvider.findUnique({
    where: { type: 'saml' },
  });
  
  if (!provider?.isEnabled) {
    res.status(400).json({ error: 'SAML authentication is not available' });
    return;
  }

  const config = provider.config as {
    idpSsoUrl?: string;
    idpCertificate?: string;
    idpMetadataUrl?: string;
    emailAttribute?: string;
    displayNameAttribute?: string;
  };
  
  const baseUrlSetting = await prisma.globalSetting.findUnique({ where: { key: 'baseUrl' } });
  const baseUrl = (baseUrlSetting?.value as string) || 'http://localhost:3010';
  
  // Type assertion required: passport-saml's Strategy type doesn't match passport's expected type
  passport.use('saml-sso', createSamlStrategy({
    callbackUrl: `${baseUrl}/api/auth/sso/saml/callback`,
    entryPoint: config.idpSsoUrl,
    idpCertificate: config.idpCertificate,
    issuer: baseUrl,
    emailAttribute: config.emailAttribute,
    displayNameAttribute: config.displayNameAttribute,
  }, prisma) as any);  // eslint-disable-line @typescript-eslint/no-explicit-any

  passport.authenticate('saml-sso')(req, res, next);
});

// SAML - callback (POST from IdP)
authRouter.post('/sso/saml/callback', (req, res, next) => {
  passport.authenticate('saml-sso', (err: Error | null, user: Express.User | false, info: { message?: string }) => {
    if (err) {
      console.error('SAML auth error:', err);
      return res.redirect('/login?error=auth_failed');
    }
    if (!user) {
      const msg = encodeURIComponent(info?.message || 'Authentication failed');
      return res.redirect(`/login?error=${msg}`);
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return res.redirect('/login?error=login_failed');
      }
      return res.redirect('/');
    });
  })(req, res, next);
});

// Store Plex PINs temporarily (in production, use Redis/session)
const plexPins = new Map<number, number>(); // pinId -> timestamp

// Plex - initiate
authRouter.get('/sso/plex', async (req, res) => {
  const provider = await prisma.ssoProvider.findUnique({
    where: { type: 'plex' },
  });
  
  if (!provider?.isEnabled) {
    res.status(400).json({ error: 'Plex authentication is not available' });
    return;
  }

  const config = provider.config as { restrictToServerId?: string };
  const baseUrlSetting = await prisma.globalSetting.findUnique({ where: { key: 'baseUrl' } });
  const baseUrl = (baseUrlSetting?.value as string) || 'http://localhost:3010';

  const plexService = new PlexAuthService({
    callbackUrl: `${baseUrl}/api/auth/sso/plex/callback`,
    restrictToServerId: config.restrictToServerId,
  }, prisma);

  try {
    const { pinId, authUrl } = await plexService.createAuthUrl();
    plexPins.set(pinId, Date.now());
    
    // Store pinId in session for callback
    req.session.plexPinId = pinId;
    
    res.redirect(authUrl);
  } catch (error) {
    console.error('Plex auth error:', error);
    res.redirect('/login?error=plex_init_failed');
  }
});

// Plex - callback
authRouter.get('/sso/plex/callback', async (req, res) => {
  const pinId = req.session.plexPinId;
  
  if (!pinId) {
    return res.redirect('/login?error=missing_plex_pin');
  }

  const provider = await prisma.ssoProvider.findUnique({
    where: { type: 'plex' },
  });
  
  if (!provider?.isEnabled) {
    return res.redirect('/login?error=plex_not_available');
  }

  const config = provider.config as { restrictToServerId?: string };
  const baseUrlSetting = await prisma.globalSetting.findUnique({ where: { key: 'baseUrl' } });
  const baseUrl = (baseUrlSetting?.value as string) || 'http://localhost:3010';

  const plexService = new PlexAuthService({
    callbackUrl: `${baseUrl}/api/auth/sso/plex/callback`,
    restrictToServerId: config.restrictToServerId,
  }, prisma);

  try {
    const plexAuth = await plexService.handleCallback(pinId);
    
    if (!plexAuth) {
      return res.redirect('/login?error=plex_auth_failed');
    }

    const result = await plexService.authenticateUser(plexAuth.user);
    
    if (!result.success || !result.user) {
      const msg = encodeURIComponent(result.error || 'Authentication failed');
      return res.redirect(`/login?error=${msg}`);
    }

    req.logIn(result.user, (loginErr) => {
      if (loginErr) {
        return res.redirect('/login?error=login_failed');
      }
      // Clean up
      plexPins.delete(pinId);
      delete req.session.plexPinId;
      return res.redirect('/');
    });
  } catch (error) {
    console.error('Plex callback error:', error);
    res.redirect('/login?error=plex_callback_failed');
  }
});

// Create first admin user (setup wizard) - rate limited
authRouter.post('/setup', setupLimiter, async (req, res) => {
  try {
    // Verify no users exist
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      res.status(400).json({ error: 'Setup already completed' });
      return;
    }

    const { username, password, displayName } = req.body;
    
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        displayName: displayName || username,
        role: 'admin',
      },
    });

    // Auto-login the new admin user so they can continue the setup wizard
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('Auto-login after setup failed:', loginErr);
        // Still return success - user can manually login
      }
      
      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
        },
      });
    });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: 'Setup failed' });
  }
});

// Login - rate limited
authRouter.post('/login', loginLimiter, (req, res, next) => {
  passport.authenticate('local', (err: Error | null, user: Express.User | false, info: { message?: string }) => {
    if (err) {
      return res.status(500).json({ error: 'Authentication error' });
    }
    if (!user) {
      return res.status(401).json({ error: info?.message || 'Invalid username or password' });
    }
    req.logIn(user, async (loginErr) => {
      if (loginErr) {
        return res.status(500).json({ error: 'Login failed' });
      }
      // Update lastLogin timestamp
      if (user.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
        });
      }
      return res.json({
        success: true,
        user,
      });
    });
  })(req, res, next);
});

// Logout
authRouter.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      res.status(500).json({ error: 'Logout failed' });
      return;
    }
    res.json({ success: true });
  });
});

// Get current user and setup status (no auth required - returns null user if not authenticated)
authRouter.get('/me', async (req, res) => {
  // Check if setup wizard has been completed
  const setupCompleted = await prisma.globalSetting.findUnique({
    where: { key: 'setupCompleted' },
  });
  const setupRequired = !setupCompleted?.value;
  
  if (req.isAuthenticated() && req.user) {
    res.json({ user: req.user, setupRequired });
  } else {
    res.json({ user: null, setupRequired });
  }
});

// Admin: List all users
authRouter.get('/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Admin: Create new user - rate limited
authRouter.post('/users', requireAuth, requireAdmin, createUserLimiter, async (req, res) => {
  try {
    const { username, password, displayName, role } = req.body;
    
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      res.status(400).json({ error: 'Username already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        displayName: displayName || username,
        role: role === 'admin' ? 'admin' : 'user',
      },
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Admin: Reset user password
authRouter.post('/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    const { newPassword } = req.body;
    
    if (!newPassword) {
      res.status(400).json({ error: 'New password required' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    
    await prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    res.json({ success: true, userId: id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Admin: Delete user
authRouter.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    
    // Prevent deleting yourself
    if (req.user?.id === id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }

    await prisma.user.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Admin: Get user's linked SSO identities
authRouter.get('/users/:userId/identities', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseIntParam(req.params.userId);
    if (userId === null) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const identities = await prisma.authIdentity.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        email: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    res.json({ identities });
  } catch (error) {
    console.error('Failed to fetch user identities:', error);
    res.status(500).json({ error: 'Failed to fetch identities' });
  }
});

// Admin: Unlink a user's SSO identity
authRouter.delete('/users/:userId/identities/:identityId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseIntParam(req.params.userId);
    const identityId = parseIntParam(req.params.identityId);
    
    if (userId === null || identityId === null) {
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }

    // Verify identity belongs to user
    const identity = await prisma.authIdentity.findFirst({
      where: { id: identityId, userId },
    });

    if (!identity) {
      res.status(404).json({ error: 'Identity not found' });
      return;
    }

    await prisma.authIdentity.delete({
      where: { id: identityId },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete identity:', error);
    res.status(500).json({ error: 'Failed to delete identity' });
  }
});
