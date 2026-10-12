-- Add listenbrainz to ConnectionType enum
ALTER TABLE `connections` MODIFY COLUMN `type` ENUM('lidarr', 'spotify', 'lastfm', 'musicbrainz', 'tautulli', 'deezer', 'tidal', 'listenbrainz') NOT NULL;
