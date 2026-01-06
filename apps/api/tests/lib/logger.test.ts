/**
 * Logger Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('logger', () => {
  let originalNodeEnv: string | undefined;
  let originalLogLevel: string | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalLogLevel = process.env.LOG_LEVEL;
    // Set to development mode and debug level for testing
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'debug';
    
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalLogLevel !== undefined) {
      process.env.LOG_LEVEL = originalLogLevel;
    } else {
      delete process.env.LOG_LEVEL;
    }
    vi.restoreAllMocks();
    // Clear module cache to re-import with different NODE_ENV
    vi.resetModules();
  });

  describe('log levels', () => {
    it('logger.info calls console.log', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      logger.info('Test message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('logger.error calls console.error', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      logger.error('Test error');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('logger.warn calls console.warn', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      logger.warn('Test warning');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('logger.debug calls console.debug', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      logger.debug('Test debug');
      expect(consoleDebugSpy).toHaveBeenCalled();
    });
  });

  describe('metadata', () => {
    it('includes metadata in log output', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      logger.info('Test message', { userId: 123, action: 'login' });
      
      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).toContain('123');
      expect(logCall).toContain('login');
    });

    it('includes correlationId when provided', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      logger.info('Test message', { correlationId: 'abc-123' });
      
      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).toContain('abc-123');
    });

    it('handles non-object data', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      logger.info('Test message', 'simple string');
      
      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).toContain('simple string');
    });
  });

  describe('createLogger', () => {
    it('creates a logger with custom context', async () => {
      const { createLogger } = await import('../../src/lib/logger.js');
      const customLogger = createLogger('CustomContext');
      customLogger.info('Test message');
      
      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).toContain('CustomContext');
    });

    it('default logger has App context', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      logger.info('Test message');
      
      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).toContain('App');
    });
  });

  describe('log format', () => {
    it('includes timestamp in development format', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      logger.info('Test message');
      
      const logCall = consoleLogSpy.mock.calls[0][0];
      // Should contain ISO date format markers
      expect(logCall).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('includes level in uppercase for development', async () => {
      const { logger } = await import('../../src/lib/logger.js');
      logger.info('Test message');
      
      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).toContain('[INFO]');
    });
  });

  describe('log level filtering', () => {
    it('respects LOG_LEVEL environment variable', async () => {
      vi.resetModules();
      process.env.LOG_LEVEL = 'error';
      
      const { logger } = await import('../../src/lib/logger.js');
      logger.info('Should not appear');
      logger.warn('Should not appear');
      logger.error('Should appear');
      
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('logs warn and above in production by default', async () => {
      vi.resetModules();
      process.env.NODE_ENV = 'production';
      delete process.env.LOG_LEVEL;
      
      const { logger } = await import('../../src/lib/logger.js');
      logger.info('Should not appear');
      logger.warn('Should appear');
      
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
    });
  });
});
