import { z } from 'zod';

/**
 * All valid subscription type strings
 */
export const subscriptionTypes = [
  // LastFM types
  'lastfm_chart',
  'lastfm_tag',
  'lastfm_geo',
  'lastfm_library',
  'lastfm_similar',
  // Spotify types
  'spotify_playlist',
  'spotify_followed',
  'spotify_saved_albums',
  'spotify_liked_songs',
  'spotify_new_releases',
  'spotify_discover_weekly',
  'spotify_release_radar',
  'spotify_daily_mix',
  'spotify_on_repeat',
  'spotify_featured',
  'spotify_category',
  'spotify_library',
  'spotify_public_playlist',
  // Deezer types
  'deezer_favorites',
  'deezer_history',
  'deezer_flow',
  'deezer_playlist',
  'deezer_playlists',
  'deezer_chart',
  'deezer_genre',
  // Tidal types
  'tidal_favorites',
  'tidal_followed_artists',
  'tidal_playlist',
  'tidal_playlists',
  'tidal_discovery',
  'tidal_new_arrivals',
  'tidal_mix',
  // Tautulli types
  'tautulli',
  'tautulli_similar',
  // Jellyfin types
  'jellyfin_similar',
  // ListenBrainz types
  'listenbrainz_top',
  'listenbrainz_similar',
  'listenbrainz_recommendations',
  'listenbrainz_weekly_jams',
  'listenbrainz_weekly_exploration',
  'listenbrainz_year',
  'listenbrainz_playlist',
  'listenbrainz_loved',
  'listenbrainz_fresh_releases',
  'listenbrainz_radio',
  // MusicBrainz types
  'musicbrainz_releases',
  'musicbrainz_label',
  'musicbrainz_tag',
  // AI types
  'ai_recommendation',
  // Discogs types
  'discogs_label',
  'discogs_genre',
  'discogs_artist_releases',
  // Bandcamp types
  'bandcamp_genre',
  'bandcamp_tag',
] as const;

/**
 * Zod enum for subscription types
 */
export const subscriptionTypeSchema = z.enum(subscriptionTypes);

/**
 * Schedule options for subscriptions
 */
export const scheduleSchema = z.enum(['manual', 'daily', 'weekly', 'monthly']).nullable().optional();

/**
 * Result handling options
 */
export const resultHandlingSchema = z.enum(['preview', 'queue', 'auto']);

/**
 * Schema for creating a new subscription (POST /subscriptions)
 */
export const createSubscriptionSchema = z.object({
  name: z.string().min(1).max(255),
  type: subscriptionTypeSchema,
  config: z.record(z.unknown()).optional().default({}),
  schedule: scheduleSchema,
  resultHandling: resultHandlingSchema.optional().default('preview'),
  isActive: z.boolean().optional().default(true),
  resultLimit: z.number().int().min(1).max(500).optional().default(50),
});

/**
 * Schema for updating a subscription (PUT /subscriptions/:id)
 * All fields are optional for partial updates
 */
export const updateSubscriptionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: subscriptionTypeSchema.optional(),
  config: z.record(z.unknown()).optional(),
  schedule: scheduleSchema,
  resultHandling: resultHandlingSchema.optional(),
  isActive: z.boolean().optional(),
  resultLimit: z.number().int().min(1).max(500).optional(),
});

/**
 * Type for creating a new subscription
 */
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

/**
 * Type for updating an existing subscription
 */
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

/**
 * Type for subscription type values
 */
export type SubscriptionType = z.infer<typeof subscriptionTypeSchema>;
