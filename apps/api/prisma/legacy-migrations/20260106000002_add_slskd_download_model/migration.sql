-- CreateTable: slskd_downloads with correct schema matching schema.prisma
CREATE TABLE `slskd_downloads` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `connection_id` INTEGER NOT NULL,
  `search_id` INTEGER NOT NULL,
  `artist_name` VARCHAR(255) NOT NULL,
  `album_name` VARCHAR(255) NOT NULL,
  `username` VARCHAR(100) NOT NULL,
  `filename` VARCHAR(500) NOT NULL,
  `file_size` BIGINT NOT NULL,
  `status` VARCHAR(50) NOT NULL,
  `error` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `slskd_downloads_connection_id_idx`(`connection_id`),
  INDEX `slskd_downloads_search_id_idx`(`search_id`),
  INDEX `slskd_downloads_status_idx`(`status`),
  INDEX `slskd_downloads_artist_name_album_name_idx`(`artist_name`, `album_name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `slskd_downloads` ADD CONSTRAINT `slskd_downloads_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
