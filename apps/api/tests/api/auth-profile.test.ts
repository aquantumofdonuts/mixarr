/**
 * Self-service profile routes
 *
 * PUT /api/auth/profile and POST /api/auth/password are called by the profile page
 * (apps/web/src/app/users/me/page.tsx) and the Users page password dialog.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';

vi.mock('../../src/lib/db.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    globalSetting: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 7, username: 'kris', displayName: 'Kris', role: 'admin' };
    next();
  }),
  requireAdmin: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../../src/middleware/rate-limiter.js', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return { loginLimiter: pass, setupLimiter: pass, createUserLimiter: pass };
});

import prisma from '../../src/lib/db.js';
import { authRouter } from '../../src/routes/auth.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

describe('Self-service profile routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/auth/profile', () => {
    it('returns the signed-in user with email', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 7, username: 'kris', displayName: 'Kris', email: 'kris@example.com', role: 'admin',
      } as any);

      const res = await request(app).get('/api/auth/profile');

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('kris@example.com');
      expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }));
    });
  });

  describe('PUT /api/auth/profile', () => {
    it('updates display name and email for the signed-in user only', async () => {
      vi.mocked(prisma.user.update).mockResolvedValue({
        id: 7, username: 'kris', displayName: 'Kris A', email: 'kris@example.com', role: 'admin',
      } as any);

      const res = await request(app)
        .put('/api/auth/profile')
        .send({ displayName: 'Kris A', email: 'kris@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 7 },
        data: { displayName: 'Kris A', email: 'kris@example.com' },
      }));
    });

    it('clears the email when null is sent', async () => {
      vi.mocked(prisma.user.update).mockResolvedValue({ id: 7 } as any);

      const res = await request(app).put('/api/auth/profile').send({ email: null });

      expect(res.status).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { email: null } }));
    });

    it('ignores fields other than display name and email', async () => {
      vi.mocked(prisma.user.update).mockResolvedValue({ id: 7 } as any);

      const res = await request(app)
        .put('/api/auth/profile')
        .send({ displayName: 'Kris', role: 'admin', isActive: false, username: 'other' });

      expect(res.status).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { displayName: 'Kris' } }));
    });

    it('rejects an invalid email', async () => {
      const res = await request(app).put('/api/auth/profile').send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('returns 409 when the email belongs to another account', async () => {
      vi.mocked(prisma.user.update).mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));

      const res = await request(app).put('/api/auth/profile').send({ email: 'taken@example.com' });

      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/auth/password', () => {
    it('changes the password when the current password matches', async () => {
      const passwordHash = await bcrypt.hash('old-password', 4);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ passwordHash } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({ id: 7 } as any);

      const res = await request(app)
        .post('/api/auth/password')
        .send({ currentPassword: 'old-password', newPassword: 'new-password-123' });

      expect(res.status).toBe(200);
      const call = vi.mocked(prisma.user.update).mock.calls[0][0] as any;
      expect(call.where).toEqual({ id: 7 });
      expect(await bcrypt.compare('new-password-123', call.data.passwordHash)).toBe(true);
    });

    it('rejects a wrong current password without updating', async () => {
      const passwordHash = await bcrypt.hash('old-password', 4);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ passwordHash } as any);

      const res = await request(app)
        .post('/api/auth/password')
        .send({ currentPassword: 'wrong', newPassword: 'new-password-123' });

      expect(res.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects accounts without a local password', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ passwordHash: null } as any);

      const res = await request(app)
        .post('/api/auth/password')
        .send({ currentPassword: 'x', newPassword: 'new-password-123' });

      expect(res.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a new password shorter than 8 characters', async () => {
      const res = await request(app)
        .post('/api/auth/password')
        .send({ currentPassword: 'old-password', newPassword: 'short' });

      expect(res.status).toBe(400);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
