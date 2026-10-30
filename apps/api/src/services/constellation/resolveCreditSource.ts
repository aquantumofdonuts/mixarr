/**
 * CreditSource selection factory.
 *
 * {@link resolveCreditSource} is the PURE selector: given the toggle + path it
 * returns either a {@link DumpIndexService} (local SQLite dump index, "Setting-ON")
 * or a {@link LiveDiscogsCreditSource} (live Discogs API, "Setting-OFF"). Both
 * factories are injectable so the SELECTION is unit-testable with fakes and no
 * real database/network handle is opened in tests.
 *
 * {@link resolveConfiguredCreditSource} is the runtime composition used by the
 * workers: it reads the constellation settings and, on the live path, resolves a
 * Discogs connection into a {@link DiscogsService} before delegating to the pure
 * selector.
 */

import type { CreditSource } from './ExpansionService.js';
import { DumpIndexService } from './DumpIndexService.js';
import { LiveDiscogsCreditSource, type DiscogsCreditBackend } from './LiveDiscogsCreditSource.js';

/** The two settings fields that decide which data backend is used. */
export interface CreditSourceSelection {
  constellationIndexEnabled: boolean;
  constellationIndexPath: string;
}

export interface ResolveCreditSourceDeps {
  /** A Discogs backend for the live path (used when `makeLiveSource` is absent). */
  discogs?: DiscogsCreditBackend;
  /** Override index-source construction (tests inject a fake). */
  makeIndexSource?: (path: string) => CreditSource;
  /** Override live-source construction (tests inject a fake). */
  makeLiveSource?: () => CreditSource;
}

/**
 * Pure selector. When `constellationIndexEnabled` is true, build the local index
 * source over `constellationIndexPath`; otherwise build the live Discogs adapter.
 *
 * The CONSUMER owns any handle returned on the index path — a real
 * {@link DumpIndexService} must be `close()`d when done (the workers do this).
 *
 * @throws if the live path is selected but no `discogs` backend / `makeLiveSource`
 *   is available (misconfiguration: no Discogs connection and index disabled).
 */
export function resolveCreditSource(
  settings: CreditSourceSelection,
  deps: ResolveCreditSourceDeps = {},
): CreditSource {
  if (settings.constellationIndexEnabled) {
    const make = deps.makeIndexSource ?? ((path: string) => new DumpIndexService(path));
    return make(settings.constellationIndexPath);
  }

  if (deps.makeLiveSource) return deps.makeLiveSource();
  if (deps.discogs) return new LiveDiscogsCreditSource(deps.discogs);

  throw new Error(
    'Constellation live Discogs credit source requires an active Discogs connection ' +
      '(or enable the local index in constellation settings)',
  );
}

/**
 * Runtime composition: read the constellation settings and return the configured
 * {@link CreditSource}. On the live path, resolve a Discogs connection (user-owned
 * preferred, else global; background workers use global only) into a {@link DiscogsService}.
 * Runtime composition tests cover credential scope separately from the pure selector.
 */
export async function resolveConfiguredCreditSource(userId?: number, options: { budgetShare?: number } = {}): Promise<CreditSource> {
  const { SettingsService } = await import('../settings.service.js');
  const settings = await SettingsService.getConstellationSettings();

  if (settings.constellationIndexEnabled) {
    return resolveCreditSource(settings);
  }

  const discogs = await resolveDiscogsBackend(userId, settings.dailyApiBudget, options.budgetShare);
  return resolveCreditSource(settings, { discogs });
}

/**
 * Resolve a Discogs backend for the live path. A DiscogsService is ALWAYS
 * returned: when an active Discogs connection with a token exists it is used
 * (authenticated, higher rate limit), otherwise a tokenless service hits the
 * public Discogs database API (rate-limited, works out of the box). This keeps
 * the live source buildable with no Discogs connection configured.
 *
 * Every request the returned service makes is charged against the shared
 * {@link DailyApiBudget} (`dailyApiBudget` setting), so the orbit warm and
 * interactive expansions together can never exceed the configured daily cap.
 */
async function resolveDiscogsBackend(
  userId: number | undefined,
  dailyApiBudget: number,
  budgetShare = 1,
): Promise<DiscogsCreditBackend> {
  const { default: prisma } = await import('../../lib/db.js');
  const { DiscogsService } = await import('../discogs.js');
  const { redis } = await import('../../lib/redis.js');
  const { DailyApiBudget } = await import('./DailyApiBudget.js');

  const conn = await prisma.connection.findFirst({
    where: {
      type: 'discogs',
      isActive: true,
      ...(userId != null ? { OR: [{ userId }, { userId: null }] } : { userId: null }),
    },
    // User-owned first (non-null userId), else the global connection.
    orderBy: { userId: 'desc' },
  });

  const token = (conn?.config as { token?: string } | null | undefined)?.token;
  const budget = new DailyApiBudget(dailyApiBudget, redis, undefined, budgetShare);
  // token may be undefined -> tokenless public Discogs API.
  return new DiscogsService(token, { onRequest: () => budget.take() });
}
