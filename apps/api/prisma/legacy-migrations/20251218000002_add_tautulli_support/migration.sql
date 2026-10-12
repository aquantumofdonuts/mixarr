-- Add tautulli to ConnectionType enum
ALTER TABLE `connections` MODIFY COLUMN `type` ENUM('lidarr', 'spotify', 'lastfm', 'musicbrainz', 'tautulli') NOT NULL;

-- Add tautulli_similar to SubscriptionType enum
ALTER TABLE `subscriptions` MODIFY COLUMN `type` ENUM('lastfm_chart', 'lastfm_tag', 'lastfm_geo', 'lastfm_library', 'lastfm_similar', 'musicbrainz', 'musicbrainz_new', 'combined', 'spotify_playlist', 'spotify_new_releases', 'spotify_followed', 'spotify_saved_albums', 'spotify_liked_songs', 'spotify_discover_weekly', 'spotify_release_radar', 'spotify_daily_mix', 'spotify_on_repeat', 'spotify_featured', 'spotify_category', 'spotify_library', 'ai_recommendation', 'tautulli_similar') NOT NULL;
