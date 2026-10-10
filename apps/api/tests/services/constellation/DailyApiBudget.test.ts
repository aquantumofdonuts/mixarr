import { describe, it, expect, vi } from 'vitest';
import {
  DailyApiBudget,
  ApiBudgetExhaustedError,
  isApiBudgetExhausted,
  type BudgetCounter,
} from '../../../src/services/constellation/DailyApiBudget.js';

/** In-memory stand-in for the Redis commands the budget uses. */
function fakeCounter(): BudgetCounter & { counts: Map<string, number>; expire: ReturnType<typeof vi.fn> } {
  const counts = new Map<string, number>();
  const counter: BudgetCounter & { counts: Map<string, number>; expire: ReturnType<typeof vi.fn> } = {
    counts,
    get: async key => counts.has(key) ? String(counts.get(key)) : null,
    eval: async (_script, _numberOfKeys, rawKey, rawLimit, rawTtl) => {
      const key = String(rawKey); const n = counts.get(key) ?? 0;
      if (n >= Number(rawLimit)) return 0;
      const fresh = !counts.has(key); counts.set(key, n + 1);
      if (fresh) await counter.expire(key, Number(rawTtl));
      return 1;
    },
    expire: vi.fn(async () => 1),
  };
  return counter;
}

const at = (iso: string) => () => new Date(iso);

describe('DailyApiBudget', () => {
  it('keys the counter by UTC day', () => {
    const budget = new DailyApiBudget(10, fakeCounter(), at('2026-10-07T23:59:59Z'));
    expect(budget.keyFor()).toBe('constellation:discogs:budget:2026-10-07');
    expect(budget.keyFor(new Date('2026-10-08T00:00:00Z'))).toBe('constellation:discogs:budget:2026-10-08');
  });

  it('allows exactly `limit` requests, then throws ApiBudgetExhaustedError', async () => {
    const counter = fakeCounter();
    const budget = new DailyApiBudget(3, counter, at('2026-10-07T12:00:00Z'));

    await budget.take();
    await budget.take();
    await budget.take();
    await expect(budget.take()).rejects.toBeInstanceOf(ApiBudgetExhaustedError);
    await expect(budget.take()).rejects.toThrow(/3 requests on 2026-10-07/);
  });

  it('sets a TTL on the key only when it is created', async () => {
    const counter = fakeCounter();
    const budget = new DailyApiBudget(10, counter, at('2026-10-07T12:00:00Z'));

    await budget.take();
    await budget.take();

    expect(counter.expire).toHaveBeenCalledTimes(1);
    expect(counter.expire).toHaveBeenCalledWith('constellation:discogs:budget:2026-10-07', 2 * 24 * 60 * 60);
  });

  it('starts a fresh count on the next UTC day', async () => {
    const counter = fakeCounter();
    let now = new Date('2026-10-07T23:59:59Z');
    const budget = new DailyApiBudget(1, counter, () => now);

    await budget.take();
    await expect(budget.take()).rejects.toBeInstanceOf(ApiBudgetExhaustedError);

    now = new Date('2026-10-08T00:00:01Z');
    await expect(budget.take()).resolves.toBeUndefined();
  });

  it('isApiBudgetExhausted recognises the error by class and by name', () => {
    expect(isApiBudgetExhausted(new ApiBudgetExhaustedError(1, 'd'))).toBe(true);
    const byName = Object.assign(new Error('x'), { name: 'ApiBudgetExhaustedError' });
    expect(isApiBudgetExhausted(byName)).toBe(true);
    expect(isApiBudgetExhausted(new Error('other'))).toBe(false);
    expect(isApiBudgetExhausted(null)).toBe(false);
  });
});


describe('DailyApiBudget.used', () => {
  it('reads today without charging or setting a TTL, preserving recorded usage above a newly lowered limit', async () => {
    const counter = fakeCounter();
    const budget = new DailyApiBudget(1, counter, at('2026-10-07T12:00:00Z'));
    expect(await budget.used()).toBe(0); expect(counter.expire).not.toHaveBeenCalled();
    await budget.take(); await expect(budget.take()).rejects.toBeInstanceOf(ApiBudgetExhaustedError);
    expect(await budget.used()).toBe(1); expect(counter.counts.get(budget.keyFor())).toBe(1);
    counter.counts.set(budget.keyFor(), 12); expect(await budget.used()).toBe(12);
    expect(counter.expire).toHaveBeenCalledTimes(1);
    expect(await budget.used(new Date('2026-10-08T00:00:00Z'))).toBe(0);
  });
  it('propagates unavailable and malformed counters instead of returning zero', async () => {
    const counter = { get: vi.fn().mockResolvedValue('oops'), eval: vi.fn(), expire: vi.fn() };
    const budget = new DailyApiBudget(3, counter);
    await expect(budget.used()).rejects.toThrow('Invalid constellation budget counter');
    counter.get.mockRejectedValue(new Error('Redis unavailable'));
    await expect(budget.used()).rejects.toThrow('Redis unavailable');
    expect(counter.eval).not.toHaveBeenCalled(); expect(counter.expire).not.toHaveBeenCalled();
  });
});

it('orbit denies at 80% while interactive takes the remainder on the same counter', async () => {
  const counter = fakeCounter(); const now = at('2026-10-07T12:00:00Z');
  const orbit = new DailyApiBudget(10, counter, now, 0.8); const full = new DailyApiBudget(10, counter, now);
  await Promise.all(Array.from({ length: 8 }, () => orbit.take()));
  await expect(orbit.take()).rejects.toBeInstanceOf(ApiBudgetExhaustedError);
  expect(await full.used()).toBe(8);
  await full.take(); await full.take();
  await expect(full.take()).rejects.toBeInstanceOf(ApiBudgetExhaustedError);
  expect(await orbit.used()).toBe(10); expect(orbit.keyFor()).toBe(full.keyFor());
});
it.each([0, -1, 1.1, NaN, Infinity])('rejects invalid budget share %s', share => {
  expect(() => new DailyApiBudget(10, fakeCounter(), undefined, share)).toThrow(RangeError);
});
it('a floored zero share threshold admits none and creates no key', async () => {
  const counter = fakeCounter(); const budget = new DailyApiBudget(1, counter, undefined, 0.8);
  await expect(budget.take()).rejects.toBeInstanceOf(ApiBudgetExhaustedError);
  expect(counter.counts.size).toBe(0); expect(counter.expire).not.toHaveBeenCalled();
});
it('captures one UTC date for reservation and exhausted error', async () => {
  const now = vi.fn().mockReturnValueOnce(new Date('2026-10-07T23:59:59Z')).mockReturnValue(new Date('2026-10-08T00:00:01Z'));
  const counter = fakeCounter(); const budget = new DailyApiBudget(0, counter, now);
  await expect(budget.take()).rejects.toMatchObject({ day: '2026-10-07' }); expect(now).toHaveBeenCalledTimes(1);
});

// Explicit opt-in only: this suite cannot connect to the application Redis.
const testRedisUrl = process.env.T32_TEST_REDIS_URL;
function validateTestRedisUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'redis:' || url.hostname !== '127.0.0.1' || url.port !== '16379' || url.pathname !== '/15' || url.username || url.password || url.search || url.hash) throw new Error('T32 Redis must be redis://127.0.0.1:16379/15');
  return value;
}
it.each(['redis://127.0.0.1:6379/15', 'redis://example.com:16379/15', 'redis://127.0.0.1:16379/0'])('rejects unsafe real Redis target %s', url => {
  expect(() => validateTestRedisUrl(url)).toThrow();
});
describe.skipIf(!testRedisUrl)('genuine Redis atomic reservations', () => {
  it('enforces shares under concurrency, preserves TTL, and leaves denials uncharged', async () => {
    const { default: Redis } = await import('ioredis');
    const { randomUUID } = await import('node:crypto');
    const client = new Redis(validateTestRedisUrl(testRedisUrl!), { maxRetriesPerRequest: 0, retryStrategy: () => null });
    const prefix = `t32-test:${randomUUID()}:`; const keys = new Set<string>();
    const namespaced: BudgetCounter = {
      get: key => { keys.add(prefix + key); return client.get(prefix + key); },
      eval: (script, count, key, ...args) => { keys.add(prefix + key); return client.eval(script, count, prefix + key, ...args); },
    };
    const now = at('2026-10-07T12:00:00Z');
    const full = new DailyApiBudget(100, namespaced, now); const orbit = new DailyApiBudget(100, namespaced, now, 0.8);
    try {
      const attempts = await Promise.allSettled(Array.from({ length: 150 }, () => orbit.take()));
      expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(80);
      expect(await full.used()).toBe(80);
      const ttl = await client.ttl(prefix + full.keyFor()); expect(ttl).toBeGreaterThan(172790);
      const remaining = await Promise.allSettled(Array.from({ length: 70 }, () => full.take()));
      expect(remaining.filter(result => result.status === 'fulfilled')).toHaveLength(20);
      expect(await full.used()).toBe(100); expect(await client.ttl(prefix + full.keyFor())).toBeLessThanOrEqual(ttl);
      await client.del(prefix + full.keyFor());
      const mixed = await Promise.allSettled(Array.from({ length: 240 }, (_, index) => index % 2 ? full.take() : orbit.take()));
      expect(mixed.filter(result => result.status === 'fulfilled')).toHaveLength(100);
      expect(mixed.filter((result, index) => index % 2 === 0 && result.status === 'fulfilled')).toHaveLength(40);
      expect(await full.used()).toBe(100);
      // Even a stored zero is an existing key whose TTL must survive admission.
      await client.set(prefix + full.keyFor(), '0', 'EX', 120);
      await full.take(); expect(await client.ttl(prefix + full.keyFor())).toBeLessThanOrEqual(120);
      expect(await client.ttl(prefix + full.keyFor())).toBeGreaterThan(110);
    } finally { if (keys.size) await client.del(...keys); await client.quit(); }
  });
});
