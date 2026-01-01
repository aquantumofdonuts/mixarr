import { Router } from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import prisma from '../lib/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { loginLimiter, setupLimiter, createUserLimiter } from '../middleware/rate-limiter.js';
import { SsoProviderService } from '../services/sso-provider.js';

export const authRouter = Router();
const ssoService = new SsoProviderService(prisma);

// Check if setup is required (no users exist)
authRouter.get('/setup-required', async (_req, res) => {
  try {
    const userCount = await prisma.user.count();
    res.json({ setupRequired: userCount === 0 });
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
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

    // Mark setup as completed
    await prisma.globalSetting.upsert({
      where: { key: 'setupCompleted' },
      create: { key: 'setupCompleted', value: true },
      update: { value: true },
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
  // Check if setup is required
  const userCount = await prisma.user.count();
  const setupRequired = userCount === 0;
  
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
    const id = parseInt(req.params.id, 10);
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
    const id = parseInt(req.params.id, 10);
    
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
