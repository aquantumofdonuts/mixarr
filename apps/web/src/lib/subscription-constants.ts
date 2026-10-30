/**
 * Subscription types, presets, and related options shared by UI components.
 */

import Brain from 'lucide-react/dist/esm/icons/brain';
import Compass from 'lucide-react/dist/esm/icons/compass';
import Disc from 'lucide-react/dist/esm/icons/disc';
import GitFork from 'lucide-react/dist/esm/icons/git-fork';
import Globe from 'lucide-react/dist/esm/icons/globe';
import Headphones from 'lucide-react/dist/esm/icons/headphones';
import Music2 from 'lucide-react/dist/esm/icons/music-2';
import Radio from 'lucide-react/dist/esm/icons/radio';
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag';
import Shuffle from 'lucide-react/dist/esm/icons/shuffle';
import Tag from 'lucide-react/dist/esm/icons/tag';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import type { LucideIcon } from 'lucide-react';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration for a subscription type (e.g., 'lastfm_chart', 'spotify_playlist')
 */
export interface SubscriptionTypeConfig {
  /** Unique identifier for the subscription type */
  value: string;
  /** Human-readable label */
  label: string;
  /** Lucide icon component */
  icon: LucideIcon;
  /** Brief description of what this type does */
  description: string;
  /** Optional warning message (e.g., for features requiring specific setup) */
  warning?: string;
}

/**
 * Category grouping for presets
 */
export interface PresetCategory {
  /** Unique identifier for the category */
  id: string;
  /** Human-readable label */
  label: string;
  /** Lucide icon component */
  icon: LucideIcon;
}

/**
 * Schedule option for subscription timing
 */
export interface ScheduleOption {
  /** Cron expression or empty string for manual */
  value: string;
  /** Human-readable label */
  label: string;
}

/**
 * Required field definition for a subscription type
 */
export interface RequiredField {
  /** Field name in the config object */
  field: string;
  /** Human-readable label for the field */
  label: string;
}

/**
 * Result handling option for subscriptions
 */
export interface ResultHandlingOption {
  /** Value to store (preview, queue, auto) */
  value: 'preview' | 'queue' | 'auto';
  /** Human-readable label */
  label: string;
  /** Whether this option is disabled */
  disabled?: boolean;
}

// ============================================================================
// Subscription Types
// ============================================================================

/**
 * All available subscription types with their configuration
 */
export const subscriptionTypes: SubscriptionTypeConfig[] = [
  // Last.fm
  { value: 'lastfm_chart', label: 'Last.fm Charts', icon: TrendingUp, description: 'Top artists by country/global' },
  { value: 'lastfm_tag', label: 'Last.fm Tag', icon: Tag, description: 'Artists by genre/tag' },
  { value: 'lastfm_geo', label: 'Last.fm Geo', icon: Globe, description: 'Top artists by location' },
  { value: 'lastfm_library', label: 'Last.fm Library', icon: TrendingUp, description: 'Your top artists from scrobbles' },
  { value: 'lastfm_similar', label: 'Last.fm Similar', icon: GitFork, description: 'Artists similar to your top artists' },
  { value: 'lastfm_tag_albums', label: 'Last.fm Tag Albums', icon: Tag, description: 'Artists from top albums in a genre/tag' },
  { value: 'lastfm_tag_similar', label: 'Last.fm Related Tags', icon: GitFork, description: 'Artists from genres related to a seed tag' },
  { value: 'lastfm_user_albums', label: 'Last.fm User Albums', icon: TrendingUp, description: 'Artists from your top scrobbled albums' },
  { value: 'lastfm_weekly_artists', label: 'Last.fm Weekly Artists', icon: TrendingUp, description: 'Your most-played artists this week' },
  { value: 'lastfm_weekly_albums', label: 'Last.fm Weekly Albums', icon: TrendingUp, description: 'Artists from your most-played albums this week' },

  // ListenBrainz
  { value: 'listenbrainz_top', label: 'ListenBrainz Top', icon: Headphones, description: 'Your top artists from listening history' },
  { value: 'listenbrainz_similar', label: 'ListenBrainz Similar', icon: Headphones, description: 'Artists from users with similar taste' },
  { value: 'listenbrainz_recommendations', label: 'ListenBrainz Recs', icon: Headphones, description: 'Personalized recommendations' },
  { value: 'listenbrainz_weekly_jams', label: 'ListenBrainz Weekly Jams', icon: Headphones, description: 'Your personalized weekly playlist of familiar favorites' },
  { value: 'listenbrainz_weekly_exploration', label: 'ListenBrainz Weekly Exploration', icon: Headphones, description: 'Your personalized weekly playlist of new discoveries' },
  { value: 'listenbrainz_fresh_releases', label: 'ListenBrainz Fresh Releases', icon: Headphones, description: 'Popular new releases (global, not personalized)' },
  { value: 'listenbrainz_year', label: 'ListenBrainz Year', icon: Headphones, description: 'Your Year in Music top artists' },
  { value: 'listenbrainz_playlist', label: 'ListenBrainz Playlist', icon: Headphones, description: 'Artists from a playlist' },
  { value: 'listenbrainz_radio', label: 'ListenBrainz Radio', icon: Headphones, description: 'Artist radio recommendations' },
  { value: 'listenbrainz_loved', label: 'ListenBrainz Loved', icon: Headphones, description: 'Artists from your loved tracks' },

  // Spotify
  { value: 'spotify_playlist', label: 'Spotify Playlist', icon: Music2, description: 'Artists from a playlist' },
  { value: 'spotify_new_releases', label: 'Spotify New Releases', icon: Music2, description: 'New album releases' },
  { value: 'spotify_followed', label: 'Spotify', icon: Music2, description: 'Your followed artists' },
  { value: 'spotify_saved_albums', label: 'Spotify', icon: Music2, description: 'Your saved albums' },
  { value: 'spotify_liked_songs', label: 'Spotify', icon: Music2, description: 'Your liked songs' },
  { value: 'spotify_library', label: 'Spotify Library', icon: Music2, description: 'All artists from your library' },
  { value: 'spotify_public_playlist', label: 'Public Spotify Playlist', icon: Music2, description: 'Any public playlist (no login required)' },
  { value: 'spotify_featured', label: 'Spotify Featured', icon: Music2, description: 'Featured playlists' },
  { value: 'spotify_category', label: 'Spotify Category', icon: Music2, description: 'Playlists by category/genre' },
  { value: 'spotify_discover_weekly', label: 'Spotify', icon: Music2, description: 'Discover Weekly playlist', warning: 'Must be followed/saved in Spotify first' },
  { value: 'spotify_daily_mix', label: 'Spotify', icon: Music2, description: 'Daily Mix playlists', warning: 'Must be followed/saved in Spotify first' },
  { value: 'spotify_release_radar', label: 'Spotify', icon: Music2, description: 'Release Radar playlist', warning: 'Must be followed/saved in Spotify first' },
  { value: 'spotify_on_repeat', label: 'Spotify', icon: Music2, description: 'On Repeat playlist', warning: 'Must be followed/saved in Spotify first' },

  // Deezer
  { value: 'deezer_chart', label: 'Deezer Charts', icon: TrendingUp, description: 'Top chart artists (no login required)' },
  { value: 'deezer_genre', label: 'Deezer Genre', icon: Tag, description: 'Artists by genre (no login required)' },
  { value: 'deezer_search', label: 'Deezer Search', icon: Music2, description: 'Search for artists (no login required)' },
  { value: 'deezer_favorites', label: 'Deezer Favorites', icon: Music2, description: 'Your favorite tracks', warning: 'Requires Deezer OAuth app (currently unavailable)' },
  { value: 'deezer_history', label: 'Deezer History', icon: Music2, description: 'Your listening history', warning: 'Requires Deezer OAuth app (currently unavailable)' },
  { value: 'deezer_flow', label: 'Deezer Flow', icon: Radio, description: 'Your personalized Flow', warning: 'Requires Deezer OAuth app (currently unavailable)' },
  { value: 'deezer_playlist', label: 'Deezer Playlist', icon: Music2, description: 'Artists from a playlist', warning: 'Requires Deezer OAuth app (currently unavailable)' },
  { value: 'deezer_playlists', label: 'Deezer Playlists', icon: Music2, description: 'All your playlists', warning: 'Requires Deezer OAuth app (currently unavailable)' },

  // TIDAL
  { value: 'tidal_favorites', label: 'TIDAL Favorites', icon: Music2, description: 'Artists from your favorite tracks' },
  { value: 'tidal_followed_artists', label: 'TIDAL Followed', icon: Music2, description: 'Your followed artists' },
  { value: 'tidal_playlist', label: 'TIDAL Playlist', icon: Music2, description: 'Artists from a playlist' },
  { value: 'tidal_playlists', label: 'TIDAL Playlists', icon: Music2, description: 'All your playlists' },
  { value: 'tidal_discovery', label: 'TIDAL Discovery', icon: Compass, description: 'Your discovery mix' },
  { value: 'tidal_new_arrivals', label: 'TIDAL New Arrivals', icon: Music2, description: 'New arrival recommendations' },
  { value: 'tidal_mix', label: 'TIDAL My Mixes', icon: Shuffle, description: 'Your personalized mixes' },

  // Discogs
  { value: 'discogs_label', label: 'Discogs Label', icon: Disc, description: 'Artists from a record label' },
  { value: 'discogs_style', label: 'Discogs Style', icon: Disc, description: 'Artists by style/genre' },

  // Bandcamp
  { value: 'bandcamp_tag', label: 'Bandcamp Tag', icon: ShoppingBag, description: 'Popular releases by tag' },
  { value: 'bandcamp_new', label: 'Bandcamp New', icon: ShoppingBag, description: 'New releases by tag' },

  // AI & Media Servers
  { value: 'ai_recommendation', label: 'AI Recommendations', icon: Brain, description: 'AI-powered artist discovery' },
  { value: 'tautulli_similar', label: 'Plex Similar', icon: GitFork, description: 'Artists similar to your Plex listening history' },
  { value: 'jellyfin_similar', label: 'Jellyfin Similar', icon: GitFork, description: 'Artists similar to your Jellyfin listening history' },
];

// ============================================================================
// Preset Categories
// ============================================================================

/**
 * Categories for grouping presets in the UI
 */
export const presetCategories: PresetCategory[] = [
  { id: 'lastfm', label: 'Last.fm', icon: Radio },
  { id: 'charts', label: 'Global Charts', icon: TrendingUp },
  { id: 'geographic', label: 'Geographic', icon: Globe },
  { id: 'spotify', label: 'Spotify', icon: Music2 },
  { id: 'deezer', label: 'Deezer', icon: Music2 },
  { id: 'tidal', label: 'TIDAL', icon: Music2 },
  { id: 'listenbrainz', label: 'ListenBrainz', icon: Headphones },
  { id: 'discogs', label: 'Discogs', icon: Disc },
  { id: 'bandcamp', label: 'Bandcamp', icon: ShoppingBag },
  { id: 'library', label: 'My Library', icon: Music2 },
  { id: 'musicbrainz', label: 'MusicBrainz', icon: Music2 },
  { id: 'ai', label: 'AI', icon: Brain },
];

// ============================================================================
// Schedule Options
// ============================================================================

/**
 * Available schedule options for subscriptions
 */
export const scheduleOptions: ScheduleOption[] = [
  { value: '', label: 'Manual only' },
  { value: '0 0 * * *', label: 'Daily at midnight' },
  { value: '0 0 * * 0', label: 'Weekly (Sunday)' },
  { value: '0 0 1 * *', label: 'Monthly (1st)' },
  { value: '0 */6 * * *', label: 'Every 6 hours' },
  { value: '0 */12 * * *', label: 'Every 12 hours' },
];

// ============================================================================
// Required Fields
// ============================================================================

/**
 * Required fields for each subscription type that needs additional configuration
 */
export const REQUIRED_FIELDS: Record<string, RequiredField[]> = {
  listenbrainz_radio: [{ field: 'listenbrainzSeedMbid', label: 'Seed Artist MBID' }],
  listenbrainz_playlist: [{ field: 'listenbrainzPlaylistId', label: 'Playlist ID' }],
  spotify_playlist: [{ field: 'playlistId', label: 'Playlist ID' }],
  spotify_public_playlist: [{ field: 'publicPlaylistUrl', label: 'Playlist URL' }],
  spotify_category: [{ field: 'tag', label: 'Category' }],
  lastfm_tag: [{ field: 'tag', label: 'Tag' }],
  lastfm_tag_albums: [{ field: 'tag', label: 'Tag' }],
  lastfm_tag_similar: [{ field: 'tag', label: 'Tag' }],
  discogs_label: [{ field: 'labelId', label: 'Label ID' }],
  discogs_style: [{ field: 'discogsStyle', label: 'Style' }],
  bandcamp_tag: [{ field: 'bandcampTag', label: 'Tag' }],
  bandcamp_new: [{ field: 'bandcampTag', label: 'Tag' }],
  tidal_playlist: [{ field: 'playlistId', label: 'Playlist ID' }],
  deezer_playlist: [{ field: 'playlistId', label: 'Playlist ID' }],
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get result handling options based on whether Lidarr is available
 * @param hasLidarr Whether Lidarr is configured and available
 * @returns Array of result handling options with appropriate disabled states
 */
export const getResultHandlingOptions = (hasLidarr: boolean): ResultHandlingOption[] => [
  { value: 'preview', label: 'Preview only (store results, no action)' },
  { value: 'queue', label: 'Add to review queue' },
  { value: 'auto', label: 'Auto-add to Lidarr', disabled: !hasLidarr },
];

/**
 * Look up configuration for a subscription type by its value
 * @param type The subscription type value (e.g., 'lastfm_chart')
 * @returns The subscription type configuration, or undefined if not found
 */
export const getSubscriptionTypeConfig = (type: string): SubscriptionTypeConfig | undefined => {
  return subscriptionTypes.find((st) => st.value === type);
};

/**
 * Get required fields for a subscription type
 * @param type The subscription type value
 * @returns Array of required fields, or empty array if none
 */
export const getRequiredFieldsForType = (type: string): RequiredField[] => {
  return REQUIRED_FIELDS[type] ?? [];
};

/**
 * Check if a subscription type has any warnings
 * @param type The subscription type value
 * @returns The warning message if present, undefined otherwise
 */
export const getSubscriptionTypeWarning = (type: string): string | undefined => {
  return getSubscriptionTypeConfig(type)?.warning;
};
