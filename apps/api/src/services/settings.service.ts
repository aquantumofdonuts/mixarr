/**
 * Settings Service
 * 
 * Business logic for user and global settings management.
 * Extracted from routes/settings.ts per SOC-005.
 */

import prisma from '../lib/db.js';
import { Prisma } from '@prisma/client';
import { getBaseUrl as getConfiguredBaseUrl } from '../lib/settings.js';
import type { JsonValue } from '@prisma/client/runtime/library';

/**
 * Default user preferences
 */
export const DEFAULT_USER_PREFERENCES = {
  theme: 'system',
  sidebarCollapsed: false,
  defaultResultHandling: 'preview',
} as const;

export type UserPreferences = typeof DEFAULT_USER_PREFERENCES;

/**
 * Default Collaboration Constellation settings (global, admin-managed).
 *
 * Stored as a single JSON blob under the `constellation` global-setting key
 * (mirrors the `preferences` user-setting blob) so the whole group is read/merged
 * in one round-trip and new keys can be added without a migration.
 *
 *  - `constellationIndexEnabled` — "Setting-ON" uses the local SQLite dump index
 *    ({@link DumpIndexService}); "Setting-OFF" uses the live Discogs adapter.
 *  - `constellationIndexPath`    — filesystem path to that SQLite index.
 *  - `orbitEdgeBudget`           — hard cap on edges materialized per orbit warm.
 *  - `dailyApiBudget`            — daily live-Discogs request budget.
 *  - `fanoutN`                   — neighbours kept per node when re-centring.
 *  - `pathMaxDegrees`            — six-degrees traversal ceiling.
 *  - `indexRefresh`              — monthly rebuild of the dump index, or off.
 */
export const DEFAULT_CONSTELLATION_SETTINGS = {
  constellationIndexEnabled: false,
  constellationIndexPath: '/data/constellation/index.db',
  orbitEdgeBudget: 250_000,
  dailyApiBudget: 5_000,
  fanoutN: 8,
  pathMaxDegrees: 6,
  indexRefresh: 'monthly' as 'monthly' | 'off',
};

export type ConstellationSettings = typeof DEFAULT_CONSTELLATION_SETTINGS;

/** The global-setting key the constellation settings blob is stored under. */
const CONSTELLATION_SETTINGS_KEY = 'constellation';

export class SettingsService {
  // ============================================================================
  // Base URL (Global)
  // ============================================================================

  /**
   * Get the configured base URL
   */
  static async getBaseUrl(): Promise<string> {
    return getConfiguredBaseUrl();
  }

  /**
   * Set the base URL
   */
  static async setBaseUrl(baseUrl: string): Promise<void> {
    await prisma.globalSetting.upsert({
      where: { key: 'baseUrl' },
      create: { key: 'baseUrl', value: baseUrl },
      update: { value: baseUrl },
    });
  }

  // ============================================================================
  // User Settings
  // ============================================================================

  /**
   * Get all settings for a user as a key-value map
   */
  static async getUserSettings(userId: number): Promise<Record<string, JsonValue>> {
    const settings = await prisma.userSetting.findMany({
      where: { userId },
    });

    const settingsMap: Record<string, JsonValue> = {};
    for (const setting of settings) {
      settingsMap[setting.key] = setting.value;
    }

    return settingsMap;
  }

  /**
   * Get a specific user setting
   */
  static async getUserSetting(userId: number, key: string): Promise<JsonValue | null> {
    const setting = await prisma.userSetting.findUnique({
      where: { userId_key: { userId, key } },
    });

    return setting?.value ?? null;
  }

  /**
   * Set a user setting (upsert)
   */
  static async setUserSetting(userId: number, key: string, value: JsonValue): Promise<void> {
    const dbValue = value === null ? Prisma.JsonNull : value;
    await prisma.userSetting.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value: dbValue },
      update: { value: dbValue },
    });
  }

  // ============================================================================
  // User Preferences (special case of user settings)
  // ============================================================================

  /**
   * Get user preferences with defaults
   */
  static async getUserPreferences(userId: number): Promise<UserPreferences & Record<string, unknown>> {
    const setting = await prisma.userSetting.findUnique({
      where: { userId_key: { userId, key: 'preferences' } },
    });

    const stored = (setting?.value as object) || {};
    return { ...DEFAULT_USER_PREFERENCES, ...stored };
  }

  /**
   * Update user preferences (merge with existing)
   */
  static async updateUserPreferences(
    userId: number,
    updates: Partial<UserPreferences> & Record<string, unknown>
  ): Promise<UserPreferences & Record<string, unknown>> {
    const existing = await prisma.userSetting.findUnique({
      where: { userId_key: { userId, key: 'preferences' } },
    });

    const merged = {
      ...DEFAULT_USER_PREFERENCES,
      ...((existing?.value as object) || {}),
      ...updates,
    };

    await prisma.userSetting.upsert({
      where: { userId_key: { userId, key: 'preferences' } },
      create: { userId, key: 'preferences', value: merged },
      update: { value: merged },
    });

    return merged;
  }

  // ============================================================================
  // Global Settings (Admin only)
  // ============================================================================

  /**
   * Get all global settings as a key-value map
   */
  static async getGlobalSettings(): Promise<Record<string, JsonValue>> {
    const settings = await prisma.globalSetting.findMany();

    const settingsMap: Record<string, JsonValue> = {};
    for (const setting of settings) {
      settingsMap[setting.key] = setting.value;
    }

    return settingsMap;
  }

  /**
   * Get a specific global setting
   */
  static async getGlobalSetting(key: string): Promise<JsonValue | null> {
    const setting = await prisma.globalSetting.findUnique({
      where: { key },
    });

    return setting?.value ?? null;
  }

  /**
   * Set a global setting (upsert)
   */
  static async setGlobalSetting(key: string, value: JsonValue): Promise<void> {
    const dbValue = value === null ? Prisma.JsonNull : value;
    await prisma.globalSetting.upsert({
      where: { key },
      create: { key, value: dbValue },
      update: { value: dbValue },
    });
  }

  // ============================================================================
  // Constellation Settings (Global, admin-managed)
  // ============================================================================

  /**
   * Read the constellation settings blob, merged over {@link DEFAULT_CONSTELLATION_SETTINGS}.
   * Unset keys always fall back to their default, so callers get a complete object.
   */
  static async getConstellationSettings(): Promise<ConstellationSettings> {
    const setting = await prisma.globalSetting.findUnique({
      where: { key: CONSTELLATION_SETTINGS_KEY },
    });
    const stored = (setting?.value as Partial<ConstellationSettings>) || {};
    return { ...DEFAULT_CONSTELLATION_SETTINGS, ...stored };
  }

  /**
   * Merge `updates` over the currently-stored constellation settings (which are
   * themselves merged over the defaults) and persist the whole blob. Returns the
   * merged result.
   */
  static async updateConstellationSettings(
    updates: Partial<ConstellationSettings>,
  ): Promise<ConstellationSettings> {
    const existing = await prisma.globalSetting.findUnique({
      where: { key: CONSTELLATION_SETTINGS_KEY },
    });
    const merged: ConstellationSettings = {
      ...DEFAULT_CONSTELLATION_SETTINGS,
      ...((existing?.value as Partial<ConstellationSettings>) || {}),
      ...updates,
    };
    await prisma.globalSetting.upsert({
      where: { key: CONSTELLATION_SETTINGS_KEY },
      create: { key: CONSTELLATION_SETTINGS_KEY, value: merged },
      update: { value: merged },
    });
    return merged;
  }
}

// Export a default instance for convenience
export const settingsService = SettingsService;
