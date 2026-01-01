/**
 * Structured Logger
 * 
 * A lightweight logging system with log levels.
 * In production, only warn and error are logged by default.
 * Set LOG_LEVEL env var to override.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
    return envLevel;
  }
  // Default: info in development, warn in production
  return process.env.NODE_ENV === 'production' ? 'warn' : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[getLogLevel()];
}

function formatMessage(level: LogLevel, context: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${context}]`;
  
  if (data !== undefined) {
    const dataStr = typeof data === 'object' ? JSON.stringify(data) : String(data);
    return `${prefix} ${message} ${dataStr}`;
  }
  return `${prefix} ${message}`;
}

class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  debug(message: string, data?: unknown): void {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', this.context, message, data));
    }
  }

  info(message: string, data?: unknown): void {
    if (shouldLog('info')) {
      console.log(formatMessage('info', this.context, message, data));
    }
  }

  warn(message: string, data?: unknown): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', this.context, message, data));
    }
  }

  error(message: string, data?: unknown): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', this.context, message, data));
    }
  }
}

/**
 * Create a logger instance for a specific context (e.g., service name, route)
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}

// Default logger for general use
export const logger = createLogger('App');
