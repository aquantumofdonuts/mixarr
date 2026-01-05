import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('JellyfinService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create service instance', async () => {
      const { JellyfinService } = await import('../../src/services/jellyfin.js');
      const service = new JellyfinService();
      expect(service).toBeDefined();
    });
  });
});
