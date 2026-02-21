import { z } from 'zod';

// POST /base-url
export const setBaseUrlSchema = z.object({
  baseUrl: z.string().url().refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol);
      } catch {
        return false;
      }
    },
    { message: 'baseUrl must use http or https protocol' }
  ),
});

// PUT / (bulk update user settings)
export const bulkUpdateSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()).refine(
    (obj) => Object.keys(obj).length > 0,
    { message: 'settings must be a non-empty object' }
  ),
});

// PUT /:key params
export const userSettingKeySchema = z.object({
  key: z.string().min(1),
});

// PUT /:key body
export const updateUserSettingSchema = z.object({
  value: z.unknown(),
});

// PUT /preferences
export const updatePreferencesSchema = z.object({
  preferences: z.record(z.string(), z.unknown()),
});

// PUT /global/:key params
export const globalSettingKeySchema = z.object({
  key: z.string().min(1).max(100),
});

// PUT /global/:key body
export const globalSettingValueSchema = z.object({
  value: z.unknown(),
});

// PUT /global (bulk update global settings)
export const bulkUpdateGlobalSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()).refine(
    (obj) => Object.keys(obj).length > 0,
    { message: 'settings must be a non-empty object' }
  ),
});

// Export inferred types
export type SetBaseUrlInput = z.infer<typeof setBaseUrlSchema>;
export type BulkUpdateSettingsInput = z.infer<typeof bulkUpdateSettingsSchema>;
export type UpdateUserSettingInput = z.infer<typeof updateUserSettingSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
export type GlobalSettingValueInput = z.infer<typeof globalSettingValueSchema>;
export type BulkUpdateGlobalSettingsInput = z.infer<typeof bulkUpdateGlobalSettingsSchema>;
