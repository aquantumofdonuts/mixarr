-- Add slskd result handling types to ResultHandling enum
-- These are used for slskd subscriptions to route results appropriately

-- Update subscriptions table
ALTER TABLE `subscriptions` MODIFY COLUMN `result_handling` ENUM(
  'preview',
  'queue',
  'auto',
  'slskd_preview',
  'slskd_queue',
  'slskd_auto'
) NOT NULL DEFAULT 'preview';

-- Update review_items table (uses same enum)
ALTER TABLE `review_items` MODIFY COLUMN `result_handling` ENUM(
  'preview',
  'queue',
  'auto',
  'slskd_preview',
  'slskd_queue',
  'slskd_auto'
) NOT NULL DEFAULT 'preview';
