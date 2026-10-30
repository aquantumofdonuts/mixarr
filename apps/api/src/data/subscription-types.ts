/**
 * Subscription type metadata served to the frontend through the API.
 */

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
 * Configuration for a subscription type
 */
export interface SubscriptionTypeMetadata {
  /** Unique identifier (matches Prisma SubscriptionType enum) */
  value: string;
  /** Human-readable label */
  label: string;
  /** Icon name (Lucide icon to use in frontend) */
  icon: string;
  /** Brief description of what this type does */
  description: string;
  /** Optional warning message (e.g., for features requiring specific setup) */
  warning?: string;
  /** Required configuration fields */
  requiredFields?: RequiredField[];
}

/**
 * All available subscription types with their metadata
 */
export const SUBSCRIPTION_TYPES: SubscriptionTypeMetadata[] = [
  // Last.fm
  { value: 'lastfm_chart', label: 'Last.fm Charts', icon: 'TrendingUp', description: 'Top artists by country/global' },
  { value: 'lastfm_tag', label: 'Last.fm Tag', icon: 'Tag', description: 'Artists by genre/tag', requiredFields: [{ field: 'tag', label: 'Tag' }] },
  { value: 'lastfm_geo', label: 'Last.fm Geo', icon: 'Globe', description: 'Top artists by location' },
  { value: 'lastfm_library', label: 'Last.fm Library', icon: 'TrendingUp', description: 'Your top artists from scrobbles' },
  { value: 'lastfm_similar', label: 'Last.fm Similar', icon: 'GitFork', description: 'Artists similar to your top artists' },

  // ListenBrainz
  { value: 'listenbrainz_top', label: 'ListenBrainz Top', icon: 'Headphones', description: 'Your top artists from listening history' },
  { value: 'listenbrainz_similar', label: 'ListenBrainz Similar', icon: 'Headphones', description: 'Artists from users with similar taste' },
  { value: 'listenbrainz_recommendations', label: 'ListenBrainz Recs', icon: 'Headphones', description: 'Personalized recommendations' },
  { value: 'listenbrainz_weekly_jams', label: 'ListenBrainz Weekly Jams', icon: 'Headphones', description: 'Your personalized weekly playlist of familiar favorites' },
  { value: 'listenbrainz_weekly_exploration', label: 'ListenBrainz Weekly Exploration', icon: 'Headphones', description: 'Your personalized weekly playlist of new discoveries' },
  { value: 'listenbrainz_fresh_releases', label: 'ListenBrainz Fresh Releases', icon: 'Headphones', description: 'Popular new releases (global, not personalized)' },
  { value: 'listenbrainz_year', label: 'ListenBrainz Year', icon: 'Headphones', description: 'Your Year in Music top artists' },
  { value: 'listenbrainz_playlist', label: 'ListenBrainz Playlist', icon: 'Headphones', description: 'Artists from a playlist', requiredFields: [{ field: 'listenbrainzPlaylistId', label: 'Playlist ID' }] },
  { value: 'listenbrainz_radio', label: 'ListenBrainz Radio', icon: 'Headphones', description: 'Artist radio recommendations', requiredFields: [{ field: 'listenbrainzSeedMbid', label: 'Seed Artist MBID' }] },
  { value: 'listenbrainz_loved', label: 'ListenBrainz Loved', icon: 'Headphones', description: 'Artists from your loved tracks' },

  // Spotify
  { value: 'spotify_playlist', label: 'Spotify Playlist', icon: 'Music2', description: 'Artists from a playlist', requiredFields: [{ field: 'playlistId', label: 'Playlist ID' }] },
  { value: 'spotify_new_releases', label: 'Spotify New Releases', icon: 'Music2', description: 'New album releases' },
  { value: 'spotify_followed', label: 'Spotify', icon: 'Music2', description: 'Your followed artists' },
  { value: 'spotify_saved_albums', label: 'Spotify', icon: 'Music2', description: 'Your saved albums' },
  { value: 'spotify_liked_songs', label: 'Spotify', icon: 'Music2', description: 'Your liked songs' },
  { value: 'spotify_library', label: 'Spotify Library', icon: 'Music2', description: 'All artists from your library' },
  { value: 'spotify_public_playlist', label: 'Public Spotify Playlist', icon: 'Music2', description: 'Any public playlist (no login required)', requiredFields: [{ field: 'publicPlaylistUrl', label: 'Playlist URL' }] },
  { value: 'spotify_featured', label: 'Spotify Featured', icon: 'Music2', description: 'Featured playlists' },
  { value: 'spotify_category', label: 'Spotify Category', icon: 'Music2', description: 'Playlists by category/genre', requiredFields: [{ field: 'tag', label: 'Category' }] },
  { value: 'spotify_discover_weekly', label: 'Spotify', icon: 'Music2', description: 'Discover Weekly playlist', warning: 'Must be followed/saved in Spotify first' },
  { value: 'spotify_daily_mix', label: 'Spotify', icon: 'Music2', description: 'Daily Mix playlists', warning: 'Must be followed/saved in Spotify first' },
  { value: 'spotify_release_radar', label: 'Spotify', icon: 'Music2', description: 'Release Radar playlist', warning: 'Must be followed/saved in Spotify first' },
  { value: 'spotify_on_repeat', label: 'Spotify', icon: 'Music2', description: 'On Repeat playlist', warning: 'Must be followed/saved in Spotify first' },

  // Deezer
  { value: 'deezer_chart', label: 'Deezer Charts', icon: 'TrendingUp', description: 'Top chart artists (no login required)' },
  { value: 'deezer_genre', label: 'Deezer Genre', icon: 'Tag', description: 'Artists by genre (no login required)' },
  { value: 'deezer_search', label: 'Deezer Search', icon: 'Music2', description: 'Search for artists (no login required)' },
  { value: 'deezer_favorites', label: 'Deezer Favorites', icon: 'Music2', description: 'Your favorite tracks', warning: 'Requires Deezer OAuth app (currently unavailable)' },
  { value: 'deezer_history', label: 'Deezer History', icon: 'Music2', description: 'Your listening history', warning: 'Requires Deezer OAuth app (currently unavailable)' },
  { value: 'deezer_flow', label: 'Deezer Flow', icon: 'Radio', description: 'Your personalized Flow', warning: 'Requires Deezer OAuth app (currently unavailable)' },
  { value: 'deezer_playlist', label: 'Deezer Playlist', icon: 'Music2', description: 'Artists from a playlist', warning: 'Requires Deezer OAuth app (currently unavailable)', requiredFields: [{ field: 'playlistId', label: 'Playlist ID' }] },
  { value: 'deezer_playlists', label: 'Deezer Playlists', icon: 'Music2', description: 'All your playlists', warning: 'Requires Deezer OAuth app (currently unavailable)' },

  // TIDAL
  { value: 'tidal_favorites', label: 'TIDAL Favorites', icon: 'Music2', description: 'Artists from your favorite tracks' },
  { value: 'tidal_followed_artists', label: 'TIDAL Followed', icon: 'Music2', description: 'Your followed artists' },
  { value: 'tidal_playlist', label: 'TIDAL Playlist', icon: 'Music2', description: 'Artists from a playlist', requiredFields: [{ field: 'playlistId', label: 'Playlist ID' }] },
  { value: 'tidal_playlists', label: 'TIDAL Playlists', icon: 'Music2', description: 'All your playlists' },
  { value: 'tidal_discovery', label: 'TIDAL Discovery', icon: 'Compass', description: 'Your discovery mix' },
  { value: 'tidal_new_arrivals', label: 'TIDAL New Arrivals', icon: 'Music2', description: 'New arrival recommendations' },
  { value: 'tidal_mix', label: 'TIDAL My Mixes', icon: 'Shuffle', description: 'Your personalized mixes' },

  // Discogs
  { value: 'discogs_label', label: 'Discogs Label', icon: 'Disc', description: 'Artists from a record label', requiredFields: [{ field: 'labelId', label: 'Label ID' }] },
  { value: 'discogs_style', label: 'Discogs Style', icon: 'Disc', description: 'Artists by style/genre', requiredFields: [{ field: 'discogsStyle', label: 'Style' }] },

  // Bandcamp
  { value: 'bandcamp_tag', label: 'Bandcamp Tag', icon: 'ShoppingBag', description: 'Popular releases by tag', requiredFields: [{ field: 'bandcampTag', label: 'Tag' }] },
  { value: 'bandcamp_new', label: 'Bandcamp New', icon: 'ShoppingBag', description: 'New releases by tag', requiredFields: [{ field: 'bandcampTag', label: 'Tag' }] },

  // AI & Media Servers
  { value: 'ai_recommendation', label: 'AI Recommendations', icon: 'Brain', description: 'AI-powered artist discovery' },
  { value: 'tautulli_similar', label: 'Plex Similar', icon: 'GitFork', description: 'Artists similar to your Plex listening history' },
  { value: 'jellyfin_similar', label: 'Jellyfin Similar', icon: 'GitFork', description: 'Artists similar to your Jellyfin listening history' },

  // MusicBrainz (legacy)
  { value: 'musicbrainz', label: 'MusicBrainz', icon: 'Music2', description: 'Artists from MusicBrainz database' },
  { value: 'musicbrainz_new', label: 'MusicBrainz New', icon: 'Music2', description: 'New releases from MusicBrainz' },
  { value: 'combined', label: 'Combined', icon: 'Music2', description: 'Combined source subscription' },
];

/**
 * Get metadata for a specific subscription type
 */
export function getSubscriptionTypeMetadata(type: string): SubscriptionTypeMetadata | undefined {
  return SUBSCRIPTION_TYPES.find(t => t.value === type);
}

/**
 * Get required fields for a subscription type
 */
export function getRequiredFieldsForType(type: string): RequiredField[] {
  return getSubscriptionTypeMetadata(type)?.requiredFields ?? [];
}
