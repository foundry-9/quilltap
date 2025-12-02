type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

interface BatchFlushResult {
  success: boolean;
  error?: string;
}

class ClientLogger {
  private queue: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private logCount: number = 0;
  private logCountResetTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 10;
  private readonly FLUSH_INTERVAL = 5000; // 5 seconds
  private readonly MAX_LOGS_PER_MINUTE = 100;
  private readonly MINUTE_DURATION = 60000; // 1 minute
  private isDevelopment: boolean;

  constructor() {
    this.isDevelopment =
      typeof window !== 'undefined' &&
      window.location.hostname === 'localhost';
    this.initializeLogCountReset();
  }

  /**
   * Initialize periodic reset of log count
   */
  private initializeLogCountReset(): void {
    if (this.logCountResetTimer) {
      clearTimeout(this.logCountResetTimer);
    }

    this.logCountResetTimer = setTimeout(() => {
      this.logCount = 0;
      this.initializeLogCountReset();
    }, this.MINUTE_DURATION);
  }

  /**
   * Check if we've exceeded the rate limit
   */
  private isRateLimited(): boolean {
    return this.logCount >= this.MAX_LOGS_PER_MINUTE;
  }

  /**
   * Log at error level
   */
  public error(
    message: string,
    data?: Record<string, unknown>
  ): void {
    try {
      this.log('error', message, data);
    } catch (err) {
      // Silently fail to never break the app
    }
  }

  /**
   * Log at warn level
   */
  public warn(
    message: string,
    data?: Record<string, unknown>
  ): void {
    try {
      this.log('warn', message, data);
    } catch (err) {
      // Silently fail to never break the app
    }
  }

  /**
   * Log at info level
   */
  public info(
    message: string,
    data?: Record<string, unknown>
  ): void {
    try {
      this.log('info', message, data);
    } catch (err) {
      // Silently fail to never break the app
    }
  }

  /**
   * Log at debug level
   */
  public debug(
    message: string,
    data?: Record<string, unknown>
  ): void {
    try {
      this.log('debug', message, data);
    } catch (err) {
      // Silently fail to never break the app
    }
  }

  /**
   * Internal log method
   */
  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
    // Check rate limit
    if (this.isRateLimited()) {
      return; // Drop log if rate limit exceeded
    }

    this.logCount++;

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      ...(data && { data }),
    };

    // Log to console in development
    if (this.isDevelopment) {
      this.logToConsole(level, message, data);
    }

    // Add to queue
    this.queue.push(entry);

    // Check if batch is full
    if (this.queue.length >= this.BATCH_SIZE) {
      this.flush();
    } else {
      // Schedule flush if not already scheduled
      this.scheduleFlushed();
    }
  }

  /**
   * Schedule automatic flush if not already scheduled
   */
  private scheduleFlushed(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flush();
    }, this.FLUSH_INTERVAL);
  }

  /**
   * Clear the flush timer
   */
  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Flush queued logs to the server
   */
  private async flush(): Promise<void> {
    this.clearFlushTimer();

    if (this.queue.length === 0) {
      return;
    }

    const logsToSend = [...this.queue];
    this.queue = [];

    const result = await this.sendLogs(logsToSend);

    if (!result.success) {
      // Fall back to console on failure
      this.fallbackToConsole(logsToSend);
    }
  }

  /**
   * Send logs to the server
   */
  private async sendLogs(logs: LogEntry[]): Promise<BatchFlushResult> {
    try {
      const response = await fetch('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ logs }),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}`,
        };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Log to console in development mode
   */
  private logToConsole(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
    const consoleMethod = console[level] || console.log;
    if (data) {
      consoleMethod(`[${level.toUpperCase()}] ${message}`, data);
    } else {
      consoleMethod(`[${level.toUpperCase()}] ${message}`);
    }
  }

  /**
   * Fall back to console when API fails
   */
  private fallbackToConsole(logs: LogEntry[]): void {
    logs.forEach((log) => {
      this.logToConsole(log.level, log.message, log.data);
    });
  }

  /**
   * Manual flush - useful for critical logs
   */
  public async forceFlush(): Promise<void> {
    try {
      await this.flush();
    } catch (err) {
      // Silently fail to never break the app
    }
  }

  /**
   * Get current queue size (for testing/monitoring)
   */
  public getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Cleanup on page unload
   */
  public cleanup(): void {
    this.clearFlushTimer();
    if (this.logCountResetTimer) {
      clearTimeout(this.logCountResetTimer);
    }
  }
}

// Create and export singleton instance
export const clientLogger = new ClientLogger();

// Auto-cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    clientLogger.forceFlush();
    clientLogger.cleanup();
  });
}

export type { LogLevel, LogEntry };
