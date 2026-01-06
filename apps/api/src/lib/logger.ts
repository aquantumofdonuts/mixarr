/**
 * Structured Logger
 * 
 * JSON logging for production, pretty logging for development.
 * In production, only warn and error are logged by default.
 * Set LOG_LEVEL env var to override.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  correlationId?: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const isDev = process.env.NODE_ENV !== 'production';

function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
    return envLevel;
  }
  // Default: info in development, warn in production
  return isDev ? 'info' : 'warn';
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[getLogLevel()];
}

function formatLogEntry(entry: LogEntry): string {
  if (isDev) {
    // Pretty format for development
    const { timestamp, level, context, message, ...rest } = entry;
    const meta = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}${meta}`;
  }
  // JSON format for production
  return JSON.stringify(entry);
}

function outputLog(level: LogLevel, formatted: string): void {
  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else if (level === 'debug') {
    console.debug(formatted);
  } else {
    console.log(formatted);
  }
}

class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
    };

    // Merge in additional data
    if (data !== undefined) {
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        Object.assign(entry, data);
      } else {
        entry.data = data;
      }
    }

    outputLog(level, formatLogEntry(entry));
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }
}

/**
 * Creates a contextual logger instance for structured logging.
 *
 * In development, logs are formatted for readability. In production,
 * logs are output as JSON for parsing by log aggregation tools.
 *
 * @param context - The context name to prefix log messages with (e.g., 'Auth', 'PlexService')
 * @returns A Logger instance with debug, info, warn, and error methods
 *
 * @example
 * ```typescript
 * const logger = createLogger('MyService');
 * logger.info('Service started', { port: 3000 });
 * logger.error('Failed to connect', { error: err.message });
 * ```
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}

// Default logger for general use
export const logger = createLogger('App');
