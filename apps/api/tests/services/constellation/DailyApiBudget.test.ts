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
  return {
    counts,
    get: async key => counts.has(key) ? String(counts.get(key)) : null,
    incr: async (key) => {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n;
    },
    expire: vi.fn(async () => 1),
  };
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
  it('reads today without charging or setting a TTL, including over-limit reservations', async () => {
    const counter = fakeCounter();
    const budget = new DailyApiBudget(1, counter, at('2026-10-07T12:00:00Z'));
    expect(await budget.used()).toBe(0); expect(counter.expire).not.toHaveBeenCalled();
    await budget.take(); await expect(budget.take()).rejects.toBeInstanceOf(ApiBudgetExhaustedError);
    expect(await budget.used()).toBe(2); expect(counter.counts.get(budget.keyFor())).toBe(2);
    expect(counter.expire).toHaveBeenCalledTimes(1);
    expect(await budget.used(new Date('2026-10-08T00:00:00Z'))).toBe(0);
  });
  it('propagates unavailable and malformed counters instead of returning zero', async () => {
    const counter = { get: vi.fn().mockResolvedValue('oops'), incr: vi.fn(), expire: vi.fn() };
    const budget = new DailyApiBudget(3, counter);
    await expect(budget.used()).rejects.toThrow('Invalid constellation budget counter');
    counter.get.mockRejectedValue(new Error('Redis unavailable'));
    await expect(budget.used()).rejects.toThrow('Redis unavailable');
    expect(counter.incr).not.toHaveBeenCalled(); expect(counter.expire).not.toHaveBeenCalled();
  });
});
