-- CreateEnum
-- Enum type is embedded in the table definition for MySQL

-- CreateTable
CREATE TABLE `sso_providers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('ldap', 'saml', 'google', 'plex') NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `config` JSON NOT NULL,
    `is_enabled` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sso_providers_type_key`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
