-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `email` VARCHAR(255) NULL,
    `password_hash` VARCHAR(255) NULL,
    `display_name` VARCHAR(100) NOT NULL,
    `role` ENUM('admin', 'user') NOT NULL DEFAULT 'user',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_login` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(255) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sessions_user_id_idx`(`user_id`),
    INDEX `sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sso_providers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('ldap', 'saml', 'google', 'plex', 'oidc') NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `config` JSON NOT NULL,
    `is_enabled` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sso_providers_type_key`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_identities` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `provider` ENUM('ldap', 'saml', 'google', 'plex', 'oidc') NOT NULL,
    `provider_user_id` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,

    INDEX `auth_identities_user_id_idx`(`user_id`),
    INDEX `auth_identities_provider_email_idx`(`provider`, `email`),
    UNIQUE INDEX `auth_identities_provider_provider_user_id_key`(`provider`, `provider_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `connections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `type` ENUM('lidarr', 'spotify', 'lastfm', 'tautulli', 'deezer', 'tidal', 'listenbrainz', 'discogs', 'jellyfin', 'slskd') NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `config` JSON NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_test` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `connections_user_id_idx`(`user_id`),
    UNIQUE INDEX `connections_user_id_type_name_key`(`user_id`, `type`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `connection_id` INTEGER NULL,
    `name` VARCHAR(255) NOT NULL,
    `type` ENUM('lastfm_chart', 'lastfm_tag', 'lastfm_geo', 'lastfm_library', 'lastfm_similar', 'lastfm_tag_albums', 'lastfm_tag_similar', 'lastfm_user_albums', 'lastfm_weekly_artists', 'lastfm_weekly_albums', 'musicbrainz', 'musicbrainz_new', 'combined', 'spotify_playlist', 'spotify_new_releases', 'spotify_followed', 'spotify_saved_albums', 'spotify_liked_songs', 'spotify_discover_weekly', 'spotify_release_radar', 'spotify_daily_mix', 'spotify_on_repeat', 'spotify_featured', 'spotify_category', 'spotify_library', 'spotify_public_playlist', 'ai_recommendation', 'tautulli_similar', 'jellyfin_similar', 'deezer_favorites', 'deezer_playlists', 'deezer_playlist', 'deezer_flow', 'deezer_chart', 'deezer_history', 'deezer_genre', 'deezer_search', 'tidal_favorites', 'tidal_followed_artists', 'tidal_playlists', 'tidal_playlist', 'tidal_discovery', 'tidal_new_arrivals', 'tidal_mix', 'listenbrainz_top', 'listenbrainz_similar', 'listenbrainz_recommendations', 'listenbrainz_fresh_releases', 'listenbrainz_weekly_jams', 'listenbrainz_weekly_exploration', 'listenbrainz_year', 'listenbrainz_playlist', 'listenbrainz_radio', 'listenbrainz_loved', 'discogs_label', 'discogs_style', 'bandcamp_tag', 'bandcamp_new') NOT NULL,
    `config` JSON NOT NULL,
    `result_limit` INTEGER NOT NULL DEFAULT 50,
    `result_handling` ENUM('preview', 'queue', 'auto', 'slskd_preview', 'slskd_queue', 'slskd_auto') NOT NULL DEFAULT 'preview',
    `schedule` VARCHAR(100) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_run` DATETIME(3) NULL,
    `last_run_status` VARCHAR(50) NULL,
    `last_run_count` INTEGER NULL,
    `next_run` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `subscriptions_user_id_idx`(`user_id`),
    INDEX `subscriptions_connection_id_idx`(`connection_id`),
    INDEX `subscriptions_next_run_idx`(`next_run`),
    INDEX `subscriptions_is_active_idx`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `subscription_id` INTEGER NOT NULL,
    `status` ENUM('pending', 'running', 'completed', 'failed') NOT NULL,
    `results_count` INTEGER NOT NULL DEFAULT 0,
    `added_count` INTEGER NOT NULL DEFAULT 0,
    `skipped_count` INTEGER NOT NULL DEFAULT 0,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    INDEX `subscription_runs_subscription_id_idx`(`subscription_id`),
    INDEX `subscription_runs_started_at_idx`(`started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_results` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `subscription_id` INTEGER NOT NULL,
    `run_id` INTEGER NULL,
    `item_type` VARCHAR(20) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `artist_name` VARCHAR(255) NULL,
    `mbid` VARCHAR(36) NULL,
    `spotify_id` VARCHAR(100) NULL,
    `album_mbid` VARCHAR(36) NULL,
    `release_date` VARCHAR(20) NULL,
    `release_type` VARCHAR(20) NULL,
    `sources` JSON NOT NULL,
    `match_count` INTEGER NOT NULL DEFAULT 1,
    `source_url` VARCHAR(500) NULL,
    `listeners` INTEGER NULL,
    `playcount` INTEGER NULL,
    `tags` TEXT NULL,
    `image_url` VARCHAR(500) NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'pending',
    `skip_reason` VARCHAR(100) NULL,
    `processed_at` DATETIME(3) NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `subscription_results_subscription_id_idx`(`subscription_id`),
    INDEX `subscription_results_status_idx`(`status`),
    INDEX `subscription_results_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_sources` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `type` ENUM('liked_songs', 'saved_albums', 'followed_artists', 'playlist') NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `external_id` VARCHAR(255) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `schedule` VARCHAR(100) NULL,
    `result_handling` ENUM('preview', 'queue', 'auto', 'slskd_preview', 'slskd_queue', 'slskd_auto') NOT NULL DEFAULT 'preview',
    `last_run` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `import_sources_user_id_idx`(`user_id`),
    UNIQUE INDEX `import_sources_user_id_type_external_id_key`(`user_id`, `type`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `item_type` VARCHAR(20) NOT NULL DEFAULT 'artist',
    `artist_name` VARCHAR(255) NOT NULL,
    `album_name` VARCHAR(255) NULL,
    `album_mbid` VARCHAR(36) NULL,
    `release_date` VARCHAR(20) NULL,
    `release_type` VARCHAR(20) NULL,
    `release_year` INTEGER NULL,
    `spotify_id` VARCHAR(255) NULL,
    `mbid` VARCHAR(36) NULL,
    `source` VARCHAR(100) NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `review_items_user_id_status_idx`(`user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dismissed_duplicates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `mbid1` VARCHAR(36) NOT NULL,
    `mbid2` VARCHAR(36) NOT NULL,
    `dismissed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `dismissed_duplicates_user_id_mbid1_mbid2_key`(`user_id`, `mbid1`, `mbid2`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_settings_user_id_key_key`(`user_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `global_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `global_settings_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `log_entries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `level` ENUM('debug', 'info', 'warn', 'error') NOT NULL,
    `category` VARCHAR(50) NOT NULL,
    `message` TEXT NOT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `log_entries_level_idx`(`level`),
    INDEX `log_entries_category_idx`(`category`),
    INDEX `log_entries_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `openai_api_key` TEXT NULL,
    `openai_enabled` BOOLEAN NOT NULL DEFAULT false,
    `openai_strategy` ENUM('similar', 'genre_expansion', 'discovery') NOT NULL DEFAULT 'similar',
    `openai_base_url` TEXT NULL,
    `openai_model` VARCHAR(100) NULL,
    `anthropic_api_key` TEXT NULL,
    `anthropic_enabled` BOOLEAN NOT NULL DEFAULT false,
    `anthropic_strategy` ENUM('similar', 'genre_expansion', 'discovery') NOT NULL DEFAULT 'similar',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `slskd_downloads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `connection_id` INTEGER NOT NULL,
    `artist_name` VARCHAR(255) NOT NULL,
    `album_name` VARCHAR(255) NOT NULL,
    `username` VARCHAR(100) NOT NULL,
    `filename` VARCHAR(500) NOT NULL,
    `file_size` BIGINT NOT NULL,
    `status` VARCHAR(50) NOT NULL,
    `error` TEXT NULL,
    `download_path` VARCHAR(500) NULL,
    `album_year` INTEGER NULL,
    `final_path` VARCHAR(500) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `slskd_downloads_connection_id_idx`(`connection_id`),
    INDEX `slskd_downloads_status_idx`(`status`),
    INDEX `slskd_downloads_artist_name_album_name_idx`(`artist_name`, `album_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_channels` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `type` ENUM('discord', 'webhook', 'telegram', 'pushover', 'email') NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `config` JSON NOT NULL,
    `events` JSON NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_identities` ADD CONSTRAINT `auth_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `connections` ADD CONSTRAINT `connections_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_runs` ADD CONSTRAINT `subscription_runs_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_results` ADD CONSTRAINT `subscription_results_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_sources` ADD CONSTRAINT `import_sources_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_items` ADD CONSTRAINT `review_items_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dismissed_duplicates` ADD CONSTRAINT `dismissed_duplicates_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_settings` ADD CONSTRAINT `user_settings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_channels` ADD CONSTRAINT `notification_channels_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
