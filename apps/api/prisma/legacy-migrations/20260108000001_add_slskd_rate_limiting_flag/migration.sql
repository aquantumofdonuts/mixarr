-- Add slskd rate limiting feature flag (enabled by default)
INSERT INTO global_settings (`key`, value, created_at, updated_at)
SELECT 
  'slskd_rate_limiting_enabled',
  CAST('true' AS JSON),
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM global_settings WHERE `key` = 'slskd_rate_limiting_enabled'
);
