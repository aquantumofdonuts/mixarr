-- Add album support fields to SubscriptionResult
ALTER TABLE `subscription_results` 
  ADD COLUMN `album_mbid` VARCHAR(36) NULL,
  ADD COLUMN `release_date` VARCHAR(20) NULL,
  ADD COLUMN `release_type` VARCHAR(20) NULL,
  ADD COLUMN `sources` JSON NOT NULL DEFAULT ('[]'),
  ADD COLUMN `match_count` INT NOT NULL DEFAULT 1;

-- Add album support fields to ReviewItem
ALTER TABLE `review_items`
  ADD COLUMN `item_type` VARCHAR(20) NOT NULL DEFAULT 'artist',
  ADD COLUMN `album_mbid` VARCHAR(36) NULL,
  ADD COLUMN `release_date` VARCHAR(20) NULL,
  ADD COLUMN `release_type` VARCHAR(20) NULL;
