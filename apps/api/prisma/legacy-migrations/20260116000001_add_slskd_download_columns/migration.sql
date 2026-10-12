-- Add missing columns to slskd_downloads table for download tracking
-- These columns are needed by the organizer service

ALTER TABLE `slskd_downloads` 
ADD COLUMN `download_path` VARCHAR(500) NULL,
ADD COLUMN `album_year` INT NULL,
ADD COLUMN `final_path` VARCHAR(500) NULL,
ADD COLUMN `completed_at` DATETIME NULL;
