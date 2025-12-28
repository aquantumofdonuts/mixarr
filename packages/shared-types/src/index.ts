// ============================================================================
// USER TYPES
// ============================================================================

export type UserRole = 'admin' | 'user';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface UserCreate {
  username: string;
  password: string;
  displayName: string;
  role?: UserRole;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  user?: User;
  error?: string;
}

// ============================================================================
// CONNECTION TYPES
// ============================================================================

export type ConnectionType = 'lidarr' | 'spotify' | 'lastfm';

export interface Connection {
  id: number;
  type: ConnectionType;
  name: string;
  isActive: boolean;
  lastTest?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LidarrConfig {
  url: string;
  apiKey: string;
}

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface LastfmConfig {
  apiKey: string;
}

export interface ConnectionCreate {
  type: ConnectionType;
  name: string;
  config: LidarrConfig | SpotifyConfig | LastfmConfig;
}

export interface ConnectionTestResult {
  success: boolean;
  status: 'connected' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// SUBSCRIPTION TYPES
// ============================================================================

export type SubscriptionType =
  // Last.fm
  | 'lastfm_chart'
  | 'lastfm_tag'
  | 'lastfm_geo'
  | 'lastfm_library'
  | 'lastfm_similar'
  // Spotify
  | 'spotify_playlist'
  | 'spotify_followed'
  | 'spotify_saved_albums'
  | 'spotify_liked_songs'
  | 'spotify_new_releases'
  | 'spotify_discover_weekly'
  | 'spotify_release_radar'
  | 'spotify_daily_mix'
  | 'spotify_on_repeat'
  | 'spotify_featured'
  | 'spotify_category'
  | 'spotify_library'
  // MusicBrainz
  | 'musicbrainz'
  | 'musicbrainz_new'
  // Combined
  | 'combined'
  // AI
  | 'ai_recommendation'
  // Tautulli
  | 'tautulli_similar'
  // Deezer
  | 'deezer_favorites'
  | 'deezer_history'
  | 'deezer_flow'
  | 'deezer_playlist'
  | 'deezer_playlists'
  | 'deezer_chart'
  | 'deezer_genre'
  | 'deezer_search'
  // TIDAL
  | 'tidal_favorites'
  | 'tidal_followed_artists'
  | 'tidal_playlist'
  | 'tidal_playlists'
  | 'tidal_discovery'
  | 'tidal_new_arrivals'
  | 'tidal_mix'
  // ListenBrainz
  | 'listenbrainz_top'
  | 'listenbrainz_similar'
  | 'listenbrainz_recommendations'
  | 'listenbrainz_explore'
  | 'listenbrainz_year'
  | 'listenbrainz_playlist'
  | 'listenbrainz_radio'
  | 'listenbrainz_loved'
  // Discogs
  | 'discogs_label'
  | 'discogs_style'
  // Bandcamp
  | 'bandcamp_tag'
  | 'bandcamp_new';

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Subscription {
  id: number;
  name: string;
  type: SubscriptionType;
  config: Record<string, unknown>;
  schedule?: string;
  isActive: boolean;
  lastRun?: string;
  nextRun?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionCreate {
  name: string;
  type: SubscriptionType;
  config: Record<string, unknown>;
  schedule?: string;
}

export interface SubscriptionRun {
  id: number;
  subscriptionId: number;
  status: RunStatus;
  artistsFound: number;
  artistsAdded: number;
  artistsSkipped: number;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}

// ============================================================================
// IMPORT TYPES
// ============================================================================

export type ImportSourceType =
  | 'liked_songs'
  | 'saved_albums'
  | 'followed_artists'
  | 'playlist';

export type ResultHandling = 'preview' | 'queue' | 'auto';

export interface ImportSource {
  id: number;
  type: ImportSourceType;
  name: string;
  externalId?: string;
  isActive: boolean;
  schedule?: string;
  resultHandling: ResultHandling;
  lastRun?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportPreviewItem {
  artistName: string;
  albumName?: string;
  releaseYear?: number;
  spotifyId?: string;
  inLibrary: boolean;
}

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface ReviewItem {
  id: number;
  artistName: string;
  albumName?: string;
  releaseYear?: number;
  spotifyId?: string;
  mbid?: string;
  source: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================================================
// WEBSOCKET EVENT TYPES
// ============================================================================

export type WebSocketEventType =
  | 'job:started'
  | 'job:progress'
  | 'job:completed'
  | 'job:failed'
  | 'import:preview'
  | 'import:added'
  | 'connection:tested';

export interface WebSocketEvent<T = unknown> {
  type: WebSocketEventType;
  data: T;
  timestamp: string;
}

export interface JobProgressEvent {
  jobId: string;
  progress: number;
  message: string;
  current?: number;
  total?: number;
}

// ============================================================================
// LIDARR TYPES
// ============================================================================

export interface LidarrArtist {
  id: number;
  artistName: string;
  foreignArtistId: string;
  overview?: string;
  images: LidarrImage[];
  monitored: boolean;
  qualityProfileId: number;
  metadataProfileId: number;
  path: string;
}

export interface LidarrImage {
  coverType: string;
  url: string;
}

export interface LidarrSearchResult {
  foreignArtistId: string;
  artistName: string;
  overview?: string;
  images: LidarrImage[];
}

// ============================================================================
// SETTING TYPES
// ============================================================================

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  defaultResultHandling: ResultHandling;
}

export interface GlobalSettings {
  setupCompleted: boolean;
  registrationEnabled: boolean;
}
