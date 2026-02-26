import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createUserSchema, updateUserSchema } from '../schemas/user.js';
import { parseIntParam } from '../utils/params.js';
import { hashPassword } from '../auth/passport.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('AdminRoute');

export const adminRouter = Router();

// All admin routes require authentication and admin role
adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

// Get all users
adminRouter.get('/users', async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            connections: true,
            subscriptions: true,
            importSources: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ users });
  } catch (error) {
    logger.error('Failed to fetch users', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get single user
adminRouter.get('/users/:id', async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            connections: true,
            subscriptions: true,
            importSources: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  } catch (error) {
    logger.error('Failed to fetch user', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { targetUserId: req.params?.id },
    });
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Create new user
adminRouter.post('/users', validateBody(createUserSchema), async (req, res) => {
  try {
    const { username, password, displayName, email, role } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    // Check if username already exists
    const existing = await prisma.user.findUnique({
      where: { username },
    });

    if (existing) {
      res.status(400).json({ error: 'Username already exists' });
      return;
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        email: email || null,
        displayName: displayName || username,
        role: role === 'admin' ? 'admin' : 'user',
        isActive: true,
      },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.json({ success: true, user });
  } catch (error) {
    logger.error('Failed to create user', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { username: req.body?.username },
    });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user
adminRouter.put('/users/:id', validateBody(updateUserSchema), async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    const { displayName, email, role, isActive, password } = req.body;

    const existing = await prisma.user.findUnique({
      where: { id },
    });

    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Prevent deactivating or demoting yourself
    if (id === req.user!.id) {
      if (isActive === false) {
        res.status(400).json({ error: 'Cannot deactivate your own account' });
        return;
      }
      if (role === 'user' && existing.role === 'admin') {
        res.status(400).json({ error: 'Cannot demote your own account' });
        return;
      }
    }

    const updateData: any = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (email !== undefined) updateData.email = email || null;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) {
      updateData.passwordHash = await hashPassword(password);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ success: true, user });
  } catch (error) {
    logger.error('Failed to update user', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { targetUserId: req.params?.id },
    });
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user
adminRouter.delete('/users/:id', async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    if (id === req.user!.id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }

    const existing = await prisma.user.findUnique({
      where: { id },
    });

    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Delete user (cascades to all related data)
    await prisma.user.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete user', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { targetUserId: req.params?.id },
    });
    res.status(500).json({ error: 'Failed to delete user' });
  }
});
