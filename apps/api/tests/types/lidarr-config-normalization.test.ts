/**
 * Normalize qualityProfileId and metadataProfileId loaded from the database
 * to numeric values before sending them to Lidarr, including string inputs.
 */

import { describe, it, expect } from 'vitest';
import { normalizeLidarrConfig, type LidarrConnectionConfig } from '../../src/types/connections.js';

describe('Lidarr Config Normalization', () => {
  describe('normalizeLidarrConfig', () => {
    it('should convert string qualityProfileId to number', () => {
      const config: LidarrConnectionConfig = {
        url: 'http://localhost:8686',
        apiKey: 'test-key',
        qualityProfileId: '2' as unknown as number, // Simulating DB storage
      };

      const normalized = normalizeLidarrConfig(config);

      expect(normalized.qualityProfileId).toBe(2);
      expect(typeof normalized.qualityProfileId).toBe('number');
    });

    it('should convert string metadataProfileId to number', () => {
      const config: LidarrConnectionConfig = {
        url: 'http://localhost:8686',
        apiKey: 'test-key',
        metadataProfileId: '3' as unknown as number,
      };

      const normalized = normalizeLidarrConfig(config);

      expect(normalized.metadataProfileId).toBe(3);
      expect(typeof normalized.metadataProfileId).toBe('number');
    });

    it('should preserve numeric qualityProfileId', () => {
      const config: LidarrConnectionConfig = {
        url: 'http://localhost:8686',
        apiKey: 'test-key',
        qualityProfileId: 5,
      };

      const normalized = normalizeLidarrConfig(config);

      expect(normalized.qualityProfileId).toBe(5);
      expect(typeof normalized.qualityProfileId).toBe('number');
    });

    it('should preserve numeric metadataProfileId', () => {
      const config: LidarrConnectionConfig = {
        url: 'http://localhost:8686',
        apiKey: 'test-key',
        metadataProfileId: 7,
      };

      const normalized = normalizeLidarrConfig(config);

      expect(normalized.metadataProfileId).toBe(7);
      expect(typeof normalized.metadataProfileId).toBe('number');
    });

    it('should handle undefined profile IDs', () => {
      const config: LidarrConnectionConfig = {
        url: 'http://localhost:8686',
        apiKey: 'test-key',
      };

      const normalized = normalizeLidarrConfig(config);

      expect(normalized.qualityProfileId).toBeUndefined();
      expect(normalized.metadataProfileId).toBeUndefined();
    });

    it('should preserve other config properties', () => {
      const config: LidarrConnectionConfig = {
        url: 'http://localhost:8686',
        apiKey: 'test-key',
        rootFolderPath: '/music',
        monitorOption: 'none',
        searchOnAdd: false,
      };

      const normalized = normalizeLidarrConfig(config);

      expect(normalized.url).toBe('http://localhost:8686');
      expect(normalized.apiKey).toBe('test-key');
      expect(normalized.rootFolderPath).toBe('/music');
      expect(normalized.monitorOption).toBe('none');
      expect(normalized.searchOnAdd).toBe(false);
    });

    it('should handle empty string profile IDs as undefined', () => {
      const config: LidarrConnectionConfig = {
        url: 'http://localhost:8686',
        apiKey: 'test-key',
        qualityProfileId: '' as unknown as number,
        metadataProfileId: '' as unknown as number,
      };

      const normalized = normalizeLidarrConfig(config);

      expect(normalized.qualityProfileId).toBeUndefined();
      expect(normalized.metadataProfileId).toBeUndefined();
    });

    it('should handle NaN-producing strings as undefined', () => {
      const config: LidarrConnectionConfig = {
        url: 'http://localhost:8686',
        apiKey: 'test-key',
        qualityProfileId: 'invalid' as unknown as number,
      };

      const normalized = normalizeLidarrConfig(config);

      expect(normalized.qualityProfileId).toBeUndefined();
    });

    it('should preserve valid monitorNewItems values', () => {
      const configs = [
        { url: 'http://localhost:8686', apiKey: 'key', monitorNewItems: 'all' as const },
        { url: 'http://localhost:8686', apiKey: 'key', monitorNewItems: 'none' as const },
        { url: 'http://localhost:8686', apiKey: 'key', monitorNewItems: 'new' as const },
      ];

      configs.forEach(config => {
        const normalized = normalizeLidarrConfig(config);
        expect(normalized.monitorNewItems).toBe(config.monitorNewItems);
      });
    });

    it('should default invalid monitorNewItems to all', () => {
      const config = {
        url: 'http://localhost:8686',
        apiKey: 'key',
        monitorNewItems: 'invalid' as unknown as 'all',
      };

      const normalized = normalizeLidarrConfig(config);
      expect(normalized.monitorNewItems).toBe('all');
    });

    it('should not modify undefined monitorNewItems', () => {
      const config = {
        url: 'http://localhost:8686',
        apiKey: 'key',
      };

      const normalized = normalizeLidarrConfig(config);
      expect(normalized.monitorNewItems).toBeUndefined();
    });
  });
});
