/**
 * Daily live-API request budget for the constellation.
 *
 * One Redis counter per UTC day. Every live Discogs HTTP request the
 * constellation makes (orbit warm AND interactive expansion) takes one unit;
 * once the day's limit is spent, {@link DailyApiBudget.take} throws
 * {@link ApiBudgetExhaustedError} BEFORE the request is sent. Callers that run
 * in the background (the orbit crawl) stop and resume the next day; interactive
 * callers surface the exhaustion instead of silently hammering the API.
 *
 * The counter is injected (`get`/`eval`, e.g. an ioredis client) so
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
  eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

const KEY_PREFIX = 'constellation:discogs:budget';
// Keys outlive their day by a margin so a request straddling midnight still
// lands on a live key; after that the counter is garbage.
const KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

// A denied reservation never changes usage or TTL. The check and increment
// share one Redis operation, including simultaneous orbit/interactive requests.
const RESERVE = `
local existed = redis.call('EXISTS', KEYS[1])
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used >= tonumber(ARGV[1]) then return 0 end
local next = redis.call('INCR', KEYS[1])
if existed == 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return 1
`;

export class DailyApiBudget {
  constructor(
    private readonly limit: number,
    private readonly counter: BudgetCounter,
    private readonly now: () => Date = () => new Date(),
    private readonly share: number = 1,
  ) {
    if (!Number.isFinite(share) || share <= 0 || share > 1) throw new RangeError('Budget share must be finite and in (0, 1]');
  }

  /** The counter key for `date` (UTC day). */
  keyFor(date: Date = this.now()): string {
    return `${KEY_PREFIX}:${date.toISOString().slice(0, 10)}`;
  }

  /** Read charged reservations, excluding denied takes; admitted failed requests remain charged, without changing TTL. */
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
    const date = this.now();
    const key = this.keyFor(date);
    const threshold = Math.floor(this.limit * this.share);
    const admitted = await this.counter.eval(RESERVE, 1, key, threshold, KEY_TTL_SECONDS);
    if (admitted !== 1) throw new ApiBudgetExhaustedError(threshold, date.toISOString().slice(0, 10));
  }
}
