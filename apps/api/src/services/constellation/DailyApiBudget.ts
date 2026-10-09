/**
 * Daily live-API request budget for the constellation (design §4.2 / §12:
 * "daily frontier-API budget = 5000 requests").
 *
 * One Redis counter per UTC day. Every live Discogs HTTP request the
 * constellation makes (orbit warm AND interactive expansion) takes one unit;
 * once the day's limit is spent, {@link DailyApiBudget.take} throws
 * {@link ApiBudgetExhaustedError} BEFORE the request is sent. Callers that run
 * in the background (the orbit crawl) stop and resume the next day; interactive
 * callers surface the exhaustion instead of silently hammering the API.
 *
 * The counter is injected (`get`/`incr`/`expire`, e.g. an ioredis client) so
 * the arithmetic is unit-testable without Redis.
 */

export class ApiBudgetExhaustedError extends Error {
  constructor(
    public readonly limit: number,
    public readonly day: string,
  ) {
    super(`Constellation daily API budget exhausted (${limit} requests on ${day})`);
    this.name = 'ApiBudgetExhaustedError';
  }
}

export function isApiBudgetExhausted(err: unknown): err is ApiBudgetExhaustedError {
  return err instanceof ApiBudgetExhaustedError || (err as Error | null)?.name === 'ApiBudgetExhaustedError';
}

/** The subset of a Redis client the budget needs. */
export interface BudgetCounter {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

const KEY_PREFIX = 'constellation:discogs:budget';
// Keys outlive their day by a margin so a request straddling midnight still
// lands on a live key; after that the counter is garbage.
const KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

export class DailyApiBudget {
  constructor(
    private readonly limit: number,
    private readonly counter: BudgetCounter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The counter key for `date` (UTC day). */
  keyFor(date: Date = this.now()): string {
    return `${KEY_PREFIX}:${date.toISOString().slice(0, 10)}`;
  }

  /** Read charged reservations, including rejected takes, without changing TTL. */
  async used(date: Date = this.now()): Promise<number> {
    const value = await this.counter.get(this.keyFor(date));
    if (value === null) return 0;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error('Invalid constellation budget counter');
    }
    return Number(value);
  }

  /**
   * Consume one request from today's budget.
   * @throws {ApiBudgetExhaustedError} when the day's limit is already spent.
   */
  async take(): Promise<void> {
    const key = this.keyFor();
    const used = await this.counter.incr(key);
    if (used === 1) await this.counter.expire(key, KEY_TTL_SECONDS);
    if (used > this.limit) throw new ApiBudgetExhaustedError(this.limit, key.slice(KEY_PREFIX.length + 1));
  }
}
