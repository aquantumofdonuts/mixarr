-- AlterTable
ALTER TABLE `sso_providers` MODIFY COLUMN `type` ENUM('ldap', 'saml', 'google', 'plex', 'oidc') NOT NULL;

-- AlterTable
ALTER TABLE `auth_identities` MODIFY COLUMN `provider` ENUM('ldap', 'saml', 'google', 'plex', 'oidc') NOT NULL;
