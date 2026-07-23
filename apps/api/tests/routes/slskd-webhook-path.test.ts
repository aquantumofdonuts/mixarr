import { describe, it, expect, vi } from 'vitest';

// routes/slskd.ts imports the real prisma client at module scope; mock it so
// importing the module here doesn't require a generated Prisma client.
vi.mock('../../src/lib/db.js', () => ({
  default: {},
  prisma: {},
}));

// routes/slskd.ts also wires up a BullMQ QueueEvents listener at module
// scope, which needs a real Redis connection — mock it out too.
vi.mock('../../src/lib/redis.js', () => ({
  createRedisConnection: () => ({}),
}));

describe('slskd webhook path handling', () => {
  it('extracts the leaf segment from a Windows-style remote path', async () => {
    const { slskdBasename } = await import('../../src/routes/slskd.js');

    expect(slskdBasename('MyMusic\\Tyler Childers\\Can I Take My Hounds to Heaven_\\1-05 track.flac')).toBe(
      '1-05 track.flac'
    );
    expect(slskdBasename('Collections\\The Annual\\CD 2')).toBe('CD 2');
  });

  it('leaves a plain filename with no separators unchanged', async () => {
    const { slskdBasename } = await import('../../src/routes/slskd.js');

    expect(slskdBasename('track.flac')).toBe('track.flac');
  });

  it('discards traversal segments, leaving only the final component', async () => {
    const { slskdBasename } = await import('../../src/routes/slskd.js');

    expect(slskdBasename('../../../etc/cron.d')).toBe('cron.d');
  });

  it('handles POSIX-style separators the same way', async () => {
    const { slskdBasename } = await import('../../src/routes/slskd.js');

    expect(slskdBasename('Artist/Album/track.mp3')).toBe('track.mp3');
  });
});
