/**
 * Strategy pattern interfaces for subscription processing.
 *
 * Each subscription type (lastfm_chart, spotify_playlist, etc.) will
 * implement the SubscriptionStrategy interface so the worker can
 * dispatch to it without a giant switch statement.
 */

/** Artist discovered by a subscription strategy. */
export interface ArtistToAdd {
  name: string;
  mbid?: string;
  source: string;
  imageUrl?: string;
}

/** Album discovered by a subscription strategy. */
export interface AlbumToAdd {
  albumName: string;
  artistName: string;
  albumMbid?: string;
  artistMbid?: string;
  releaseDate?: string;
  releaseYear?: number;
  releaseType?: string;
  source: string;
}

/** The result returned by every subscription strategy. */
export interface SubscriptionStrategyResult {
  artists: ArtistToAdd[];
  albums: AlbumToAdd[];
}

/**
 * Context passed to a strategy so it has everything it needs to fetch
 * artists/albums without reaching into global state.
 */
export interface StrategyContext {
  /** The subscription's user-supplied config (limit, period, genre, etc.) */
  config: Record<string, any>;
  /** Pre-resolved connections keyed by type (spotify, lastfm, …). */
  connections: Map<string, { id: number; type: string; config: unknown }>;
}

/**
 * A subscription strategy knows how to fetch artists and/or albums for
 * one subscription type (e.g. "lastfm_chart" or "spotify_playlist").
 */
export interface SubscriptionStrategy {
  execute(context: StrategyContext): Promise<SubscriptionStrategyResult>;
}

// ---------------------------------------------------------------------------
// Result helpers — used by every strategy to build return values.
// ---------------------------------------------------------------------------

/** Shorthand for a result with only artists. */
export function artistResult(artists: ArtistToAdd[]): SubscriptionStrategyResult {
  return { artists, albums: [] };
}

/** Shorthand for a result with only albums. */
export function albumResult(albums: AlbumToAdd[]): SubscriptionStrategyResult {
  return { artists: [], albums };
}
