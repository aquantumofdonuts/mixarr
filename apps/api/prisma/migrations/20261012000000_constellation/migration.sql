-- CreateTable
CREATE TABLE `constellation_person` (
    `person_id` INTEGER NOT NULL,
    `display_name` VARCHAR(512) NOT NULL,
    `type` VARCHAR(16) NOT NULL DEFAULT 'person',
    `fully_expanded` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`person_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `constellation_identity` (
    `person_id` INTEGER NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `external_id` VARCHAR(255) NOT NULL,
    `confidence` VARCHAR(16) NOT NULL DEFAULT 'linked',

    INDEX `constellation_identity_source_external_id_idx`(`source`, `external_id`),
    PRIMARY KEY (`person_id`, `source`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `constellation_edge` (
    `source_person_id` INTEGER NOT NULL,
    `target_person_id` INTEGER NOT NULL,
    `weight` DOUBLE NOT NULL DEFAULT 0,
    `bridge` DOUBLE NULL,
    `bridge_confident` BOOLEAN NOT NULL DEFAULT false,
    `role_bitmask` INTEGER NOT NULL DEFAULT 0,
    `shared_master_count` INTEGER NOT NULL DEFAULT 0,
    `both_endpoints_full` BOOLEAN NOT NULL DEFAULT false,
    `sample_master_id` INTEGER NULL,
    `index_version` INTEGER NOT NULL DEFAULT 0,
    `fetched_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`source_person_id`, `target_person_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `constellation_genre` (
    `person_id` INTEGER NOT NULL,
    `genre` VARCHAR(64) NOT NULL,
    `weight` DOUBLE NOT NULL DEFAULT 0,

    PRIMARY KEY (`person_id`, `genre`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `constellation_orbit` (
    `user_id` INTEGER NOT NULL,
    `person_id` INTEGER NOT NULL,
    `tier` VARCHAR(16) NOT NULL,
    `last_crawled_at` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'queued',

    PRIMARY KEY (`user_id`, `person_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `constellation_owned` (
    `user_id` INTEGER NOT NULL,
    `person_id` INTEGER NOT NULL,
    `source` VARCHAR(16) NOT NULL,

    PRIMARY KEY (`user_id`, `person_id`, `source`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
