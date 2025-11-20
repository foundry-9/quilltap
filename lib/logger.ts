/**
 * Structured logging utility for Quilltap
 * Provides consistent logging format across the application
 */

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

class Logger {
  private context: LogContext;

  constructor(context: LogContext = {}) {
    this.context = context;
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: LogContext): Logger {
    return new Logger({ ...this.context, ...additionalContext });
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
    if (LOG_LEVELS[level] > CURRENT_LEVEL) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logData: LogContext & {
      timestamp: string;
      level: LogLevel;
      message: string;
      error?: {
        name: string;
        message: string;
        stack?: string;
      };
    } = {
      timestamp,
      level,
      message,
      ...this.context,
      ...context,
    };

    if (error) {
      logData.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    // In production, you might want to send this to a logging service
    // For now, we'll use structured console logging
    const logString = JSON.stringify(logData);

    switch (level) {
      case LogLevel.ERROR:
        console.error(logString);
        break;
      case LogLevel.WARN:
        console.warn(logString);
        break;
      case LogLevel.INFO:
        console.info(logString);
        break;
      case LogLevel.DEBUG:
        console.debug(logString);
        break;
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
