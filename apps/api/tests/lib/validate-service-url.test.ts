/**
 * validateServiceUrl Tests
 */

import { describe, it, expect } from 'vitest';
import { validateServiceUrl } from '../../src/lib/validate-service-url.js';

describe('validateServiceUrl', () => {
  describe('valid URLs', () => {
    it('accepts http URLs', () => {
      expect(validateServiceUrl('http://localhost:8080', 'Test')).toBe('http://localhost:8080');
    });

    it('accepts https URLs', () => {
      expect(validateServiceUrl('https://example.com', 'Test')).toBe('https://example.com');
    });

    it('preserves path segments', () => {
      expect(validateServiceUrl('http://localhost:8080/lidarr', 'Test')).toBe(
        'http://localhost:8080/lidarr'
      );
    });

    it('strips trailing slash', () => {
      expect(validateServiceUrl('http://localhost:8080/', 'Test')).toBe('http://localhost:8080');
    });

    it('strips trailing slash from path', () => {
      expect(validateServiceUrl('http://localhost:8080/lidarr/', 'Test')).toBe(
        'http://localhost:8080/lidarr'
      );
    });

    it('preserves port number', () => {
      expect(validateServiceUrl('http://192.168.1.100:8686', 'Lidarr')).toBe(
        'http://192.168.1.100:8686'
      );
    });
  });

  describe('rejected inputs', () => {
    it('rejects file:// protocol', () => {
      expect(() => validateServiceUrl('file:///etc/passwd', 'Test')).toThrow(
        'URL must use http or https protocol'
      );
    });

    it('rejects ftp:// protocol', () => {
      expect(() => validateServiceUrl('ftp://example.com', 'Test')).toThrow(
        'URL must use http or https protocol'
      );
    });

    it('rejects empty string', () => {
      expect(() => validateServiceUrl('', 'Test')).toThrow('URL is required');
    });

    it('rejects malformed URL', () => {
      expect(() => validateServiceUrl('not a url', 'Test')).toThrow('Invalid URL format');
    });

    it('includes service name in error message', () => {
      expect(() => validateServiceUrl('', 'Tautulli')).toThrow('Tautulli: URL is required');
    });

    it('rejects javascript: protocol', () => {
      expect(() => validateServiceUrl('javascript:alert(1)', 'Test')).toThrow(
        'URL must use http or https protocol'
      );
    });
  });
});
