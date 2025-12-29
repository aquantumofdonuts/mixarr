-- Add email field to users table for SSO matching
ALTER TABLE `users` ADD COLUMN `email` VARCHAR(255) NULL;

-- Add unique index on email
ALTER TABLE `users` ADD CONSTRAINT `users_email_key` UNIQUE (`email`);

-- Make password_hash nullable for SSO-only users
ALTER TABLE `users` MODIFY COLUMN `password_hash` VARCHAR(255) NULL;
