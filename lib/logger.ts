/**
 * Structured logging utility for Quilltap
 * Provides consistent logging format across the application
 */

import { LogTransport, ConsoleTransport, FileTransport } from '@/lib/logging/transports';
import { env } from '@/lib/env';

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

const LOG_LEVELS = {
  [LogLevel.ERROR]: 0,
  [LogLevel.WARN]: 1,
  [LogLevel.INFO]: 2,
  [LogLevel.DEBUG]: 3,
};

const CURRENT_LEVEL =
  LOG_LEVELS[
    (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO
  ];

interface LogContext {
  [key: string]: any;
}

/**
 * Initialize transports based on environment configuration
 */
function initializeTransports(): LogTransport[] {
  const transports: LogTransport[] = [];
  const output = env.LOG_OUTPUT || 'console';

  if (output === 'console' || output === 'both') {
    transports.push(new ConsoleTransport());
  }

  if (output === 'file' || output === 'both') {
    const maxFileSize = env.LOG_FILE_MAX_SIZE ? Number.parseInt(env.LOG_FILE_MAX_SIZE) : undefined;
    const maxFiles = env.LOG_FILE_MAX_FILES ? Number.parseInt(env.LOG_FILE_MAX_FILES) : undefined;

    transports.push(new FileTransport(
      env.LOG_FILE_PATH || './logs',
      maxFileSize,
      maxFiles
    ));
  }

  return transports;
}

class Logger {
  private context: LogContext;
  private transports: LogTransport[];
  private minLevel: number;

  constructor(context: LogContext = {}, transports?: LogTransport[], minLevel?: LogLevel) {
    this.context = context;
    this.transports = transports || initializeTransports();
    this.minLevel = minLevel ? LOG_LEVELS[minLevel] : CURRENT_LEVEL;
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: LogContext): Logger {
    // Find the LogLevel key that matches this.minLevel value
    const levelKey = Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key as LogLevel] === this.minLevel) as LogLevel | undefined;
    return new Logger({ ...this.context, ...additionalContext }, this.transports, levelKey);
  }

  /**
   * Log an error message
   */
  error(message: string, context?: LogContext, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Internal logging implementation
   */
  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): void {
    if (LOG_LEVELS[level] > this.minLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      level,
      message,
      context: {
        ...this.context,
        ...context,
      },
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    };

    // Write to all configured transports
    for (const transport of this.transports) {
      try {
        const result = transport.write(logData);
        // Handle async transports
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error('Transport write failed:', err);
          });
        }
      } catch (err) {
        console.error('Transport write failed:', err);
      }
    }
  }

  /**
   * Log an HTTP request
   */
  logRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    context?: LogContext
  ): void {
    this.info('HTTP request', {
      method,
      path,
      statusCode,
      duration,
      ...context,
    });
  }

  /**
   * Log an API key operation (without exposing the key)
   */
  logApiKeyOperation(
    operation: 'encrypt' | 'decrypt' | 'test' | 'create' | 'delete',
    provider: string,
    userId: string,
    success: boolean
  ): void {
    this.info('API key operation', {
      operation,
      provider,
      userId,
      success,
    });
  }

  /**
   * Log LLM API call (without exposing API key or full content)
   */
  logLLMCall(
    provider: string,
    model: string,
    tokenCount: number | null,
    success: boolean,
    duration: number
  ): void {
    this.info('LLM API call', {
      provider,
      model,
      tokenCount,
      success,
      duration,
    });
  }

  /**
   * Log authentication events
   */
  logAuth(
    event: 'signin' | 'signout' | 'signup' | 'error',
    provider: string | null,
    userId: string | null,
    success: boolean
  ): void {
    this.info('Authentication event', {
      event,
      provider,
      userId,
      success,
    });
  }
}

// Export singleton instance
export const logger = new Logger({
  service: 'quilltap',
  environment: process.env.NODE_ENV || 'development',
});

// Export class for creating child loggers
export { Logger };
