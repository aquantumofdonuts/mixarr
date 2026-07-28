/**
 * CreditSource selection factory (Design §4.2 — Setting-ON vs Setting-OFF).
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
 * preferred, else global) into a {@link DiscogsService}. Not unit-tested (it
 * touches settings + the connections table); the selection logic it delegates to
 * is covered by {@link resolveCreditSource}'s tests.
 */
export async function resolveConfiguredCreditSource(userId?: number): Promise<CreditSource> {
  const { SettingsService } = await import('../settings.service.js');
  const settings = await SettingsService.getConstellationSettings();

  if (settings.constellationIndexEnabled) {
    return resolveCreditSource(settings);
  }

  const discogs = await resolveDiscogsBackend(userId);
  return resolveCreditSource(settings, { discogs });
}

/** Resolve an active Discogs connection into a DiscogsService, or undefined. */
async function resolveDiscogsBackend(userId?: number): Promise<DiscogsCreditBackend | undefined> {
  const { default: prisma } = await import('../../lib/db.js');
  const { DiscogsService } = await import('../discogs.js');

  const conn = await prisma.connection.findFirst({
    where: {
      type: 'discogs',
      isActive: true,
      ...(userId != null ? { OR: [{ userId }, { userId: null }] } : {}),
    },
    // User-owned first (non-null userId), else the global connection.
    orderBy: { userId: 'desc' },
  });

  const token = (conn?.config as { token?: string } | null | undefined)?.token;
  return token ? new DiscogsService(token) : undefined;
}
