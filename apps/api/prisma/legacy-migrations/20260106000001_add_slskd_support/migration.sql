-- Add slskd to ConnectionType enum
ALTER TABLE `connections` MODIFY COLUMN `type` ENUM(
  'lidarr',
  'spotify',
  'lastfm',
  'tautulli',
  'deezer',
  'tidal',
  'listenbrainz',
  'discogs',
  'jellyfin',
  'slskd'
) NOT NULL;
