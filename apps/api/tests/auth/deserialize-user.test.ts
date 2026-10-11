import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../../src/lib/db.js';

// Mock the prisma client
vi.mock('../../src/lib/db.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// Exercise the production user deserializer.
import { lookupSessionUser } from '../../src/auth/passport.js';

describe('passport deserializeUser (lookupSessionUser)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return user data for an active user', async () => {
    const mockUser = {
      id: 1,
      username: 'testuser',
      displayName: 'Test User',
      role: 'user',
      isActive: true,
      passwordHash: 'hashed',
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

    const result = await lookupSessionUser(1);

    expect(result).toEqual({
      id: 1,
      username: 'testuser',
      displayName: 'Test User',
      role: 'user',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('should reject when user is not found', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const result = await lookupSessionUser(999);

    expect(result).toBe(false);
  });

  it('should reject when user is deactivated (isActive = false)', async () => {
    const mockUser = {
      id: 2,
      username: 'deactivated',
      displayName: 'Deactivated User',
      role: 'user',
      isActive: false,
      passwordHash: 'hashed',
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

    const result = await lookupSessionUser(2);

    expect(result).toBe(false);
  });

  it('should throw when database errors', async () => {
    const dbError = new Error('DB connection failed');
    vi.mocked(prisma.user.findUnique).mockRejectedValue(dbError);

    await expect(lookupSessionUser(1)).rejects.toThrow('DB connection failed');
  });
});
