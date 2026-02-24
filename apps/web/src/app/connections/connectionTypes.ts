export interface ConnectionTypeInfo {
  value: string;
  label: string;
  color: string;
  description: string;
}

export const connectionTypes: ConnectionTypeInfo[] = [
  { value: 'lidarr', label: 'Lidarr', color: '#62BC50', description: 'Music collection manager' },
  { value: 'spotify', label: 'Spotify', color: '#1DB954', description: 'Import & playlist subscriptions' },
  { value: 'lastfm', label: 'Last.fm', color: '#D51007', description: 'Chart & tag subscriptions' },
  { value: 'tautulli', label: 'Tautulli', color: '#E5A00D', description: 'Plex listening history' },
  { value: 'jellyfin', label: 'Jellyfin', color: '#00A4DC', description: 'Jellyfin listening history' },
  { value: 'deezer', label: 'Deezer', color: '#FEAA2D', description: 'Deezer library & playlists' },
  { value: 'tidal', label: 'TIDAL', color: '#00FFFF', description: 'TIDAL library & mixes' },
  { value: 'listenbrainz', label: 'ListenBrainz', color: '#353070', description: 'Open-source music tracking' },
  { value: 'discogs', label: 'Discogs', color: '#333333', description: 'Music database & collection' },
  { value: 'slskd', label: 'slskd', color: '#FF6B35', description: 'Soulseek downloads' },
];
