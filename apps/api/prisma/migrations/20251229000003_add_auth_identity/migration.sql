-- CreateTable
CREATE TABLE `auth_identities` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `provider` ENUM('ldap', 'saml', 'google', 'plex') NOT NULL,
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

-- AddForeignKey
ALTER TABLE `auth_identities` ADD CONSTRAINT `auth_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
