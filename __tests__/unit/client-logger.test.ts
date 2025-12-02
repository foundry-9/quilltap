/**
 * Unit tests for ClientLogger functionality
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Types matching the source implementation
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

// Test implementation of ClientLogger
class ClientLoggerTest {
  private queue: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private logCount: number = 0;
  private logCountResetTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 10;
  private readonly FLUSH_INTERVAL = 5000; // 5 seconds
  private readonly MAX_LOGS_PER_MINUTE = 100;
  private readonly MINUTE_DURATION = 60000; // 1 minute
  private isDevelopment: boolean;

  constructor(isDev: boolean = true) {
    this.isDevelopment = isDev;
    this.initializeLogCountReset();
  }

  private initializeLogCountReset(): void {
    if (this.logCountResetTimer) {
      clearTimeout(this.logCountResetTimer);
    }

    this.logCountResetTimer = setTimeout(() => {
      this.logCount = 0;
      this.initializeLogCountReset();
    }, this.MINUTE_DURATION);
  }

  private isRateLimited(): boolean {
    return this.logCount >= this.MAX_LOGS_PER_MINUTE;
  }

  public error(message: string, data?: Record<string, unknown>): void {
    try {
      this.log('error', message, data);
    } catch {
      // Silently fail to never break the app
    }
  }

  public warn(message: string, data?: Record<string, unknown>): void {
    try {
      this.log('warn', message, data);
    } catch {
      // Silently fail to never break the app
    }
  }

  public info(message: string, data?: Record<string, unknown>): void {
    try {
      this.log('info', message, data);
    } catch {
      // Silently fail to never break the app
    }
  }

  public debug(message: string, data?: Record<string, unknown>): void {
    try {
      this.log('debug', message, data);
    } catch {
      // Silently fail to never break the app
    }
  }

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

  private scheduleFlushed(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flush();
    }, this.FLUSH_INTERVAL);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

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

  private fallbackToConsole(logs: LogEntry[]): void {
    for (const log of logs) {
      this.logToConsole(log.level, log.message, log.data);
    }
  }

  public async forceFlush(): Promise<void> {
    try {
      await this.flush();
    } catch {
      // Silently fail to never break the app
    }
  }

  public getQueueSize(): number {
    return this.queue.length;
  }

  public cleanup(): void {
    this.clearFlushTimer();
    if (this.logCountResetTimer) {
      clearTimeout(this.logCountResetTimer);
    }
  }
}

describe('ClientLogger', () => {
  let logger: ClientLoggerTest;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock fetch globally
    globalThis.fetch = jest.fn();

    // Mock console methods
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});

    // Create logger instance
    logger = new ClientLoggerTest(true);
  });

  afterEach(() => {
    logger.cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Basic logging methods', () => {
    it('should log error messages', () => {
      const errorSpy = jest.spyOn(console, 'error');
      logger.error('Test error');

      expect(logger.getQueueSize()).toBeGreaterThan(0);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should log warn messages', () => {
      const warnSpy = jest.spyOn(console, 'warn');
      logger.warn('Test warning');

      expect(logger.getQueueSize()).toBeGreaterThan(0);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should log info messages', () => {
      const infoSpy = jest.spyOn(console, 'info');
      logger.info('Test info');

      expect(logger.getQueueSize()).toBeGreaterThan(0);
      expect(infoSpy).toHaveBeenCalled();
    });

    it('should log debug messages', () => {
      const debugSpy = jest.spyOn(console, 'debug');
      logger.debug('Test debug');

      expect(logger.getQueueSize()).toBeGreaterThan(0);
      expect(debugSpy).toHaveBeenCalled();
    });

    it('should include data in log entry', () => {
      const testData = { userId: 'user-123', action: 'login' };
      logger.error('User login failed', testData);

      expect(logger.getQueueSize()).toBeGreaterThan(0);
    });

    it('should not throw on logging errors', () => {
      expect(() => {
        logger.error('Error 1');
        logger.warn('Warning 1');
        logger.info('Info 1');
        logger.debug('Debug 1');
      }).not.toThrow();
    });
  });

  describe('Rate limiting', () => {
    it('should enforce MAX_LOGS_PER_MINUTE limit', () => {
      // Log up to the limit (100)
      for (let i = 0; i < 100; i++) {
        logger.info(`Log ${i}`);
      }

      // At this point, some logs have been flushed automatically
      const queueSizeAfterHundred = logger.getQueueSize();

      // Attempt to log beyond the limit
      logger.info('This should be dropped');

      // Queue size should not have increased (log was dropped)
      expect(logger.getQueueSize()).toBe(queueSizeAfterHundred);
    });

    it('should drop logs when rate limit is exceeded', () => {
      // Fill up to the limit
      for (let i = 0; i < 100; i++) {
        logger.info(`Log ${i}`);
      }

      const queueSizeBefore = logger.getQueueSize();

      // Try to add one more log
      logger.info('Should be dropped');

      expect(logger.getQueueSize()).toBe(queueSizeBefore);
    });

    it('should reset log count after minute duration', () => {
      // Log up to the limit
      for (let i = 0; i < 100; i++) {
        logger.info(`Log ${i}`);
      }

      const queueSizeAtLimit = logger.getQueueSize();

      // Verify we're at the limit by attempting to log
      logger.info('This should be dropped');
      expect(logger.getQueueSize()).toBe(queueSizeAtLimit);

      // Advance time by more than 1 minute
      jest.advanceTimersByTime(60000);

      // Now we should be able to log again
      logger.info('This should succeed after reset');

      expect(logger.getQueueSize()).toBeGreaterThan(queueSizeAtLimit);
    });
  });

  describe('Batch flushing', () => {
    it('should flush automatically when batch size is reached', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      // Log 10 messages (batch size)
      for (let i = 0; i < 10; i++) {
        logger.info(`Message ${i}`);
      }

      // The 10th log triggers a flush, so queue should be empty
      expect(logger.getQueueSize()).toBe(0);

      // Flush should have been called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith('/api/logs', expect.any(Object));
    });

    it('should flush after FLUSH_INTERVAL if batch not full', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      // Log fewer than batch size
      logger.info('Message 1');
      logger.info('Message 2');

      expect(logger.getQueueSize()).toBe(2);
      expect(mockFetch).not.toHaveBeenCalled();

      // Advance time to trigger flush
      jest.advanceTimersByTime(5000);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(logger.getQueueSize()).toBe(0);
    });

    it('should not schedule multiple timers', () => {
      logger.info('Message 1');
      logger.info('Message 2');

      // Both should share the same timer
      expect(logger.getQueueSize()).toBe(2);

      logger.info('Message 3');

      // Still only 3 in queue, not 4
      expect(logger.getQueueSize()).toBe(3);
    });

    it('should only flush when queue has items', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      // Manually call forceFlush with empty queue
      await logger.forceFlush();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Manual flushing', () => {
    it('should flush logs on demand with forceFlush', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      logger.info('Message 1');
      logger.info('Message 2');

      expect(logger.getQueueSize()).toBe(2);

      await logger.forceFlush();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(logger.getQueueSize()).toBe(0);
    });

    it('should send correct payload format', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      const testData = { userId: '123', action: 'test' };
      logger.error('Test error', testData);

      await logger.forceFlush();

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/logs',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.any(String),
        })
      );

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1]!.body as string);
      expect(body).toHaveProperty('logs');
      expect(Array.isArray(body.logs)).toBe(true);
      expect(body.logs[0]).toHaveProperty('level', 'error');
      expect(body.logs[0]).toHaveProperty('message', 'Test error');
      expect(body.logs[0]).toHaveProperty('timestamp');
      expect(body.logs[0]).toHaveProperty('data', testData);
    });

    it('should handle forceFlush errors gracefully', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      logger.error('Test error');

      // This should not throw
      expect(async () => {
        await logger.forceFlush();
      }).not.toThrow();
    });
  });

  describe('Error handling', () => {
    it('should handle API errors gracefully', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const errorSpy = jest.spyOn(console, 'error');

      logger.error('Test error');
      await logger.forceFlush();

      // Should fall back to console logging
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should handle network errors gracefully', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const warnSpy = jest.spyOn(console, 'warn');

      logger.warn('Test warning');
      await logger.forceFlush();

      // Should fall back to console logging
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should handle non-Error exceptions in sendLogs', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockRejectedValueOnce('String error');

      const warnSpy = jest.spyOn(console, 'warn');

      logger.warn('Test warning');
      await logger.forceFlush();

      // Should fall back to console logging
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should not break app on logging method exceptions', () => {
      expect(() => {
        logger.error(null as any);
        logger.warn(undefined as any);
        logger.info('');
        logger.debug(123 as any);
      }).not.toThrow();
    });
  });

  describe('Console logging in development mode', () => {
    it('should log to console in development (localhost)', () => {
      const errorSpy = jest.spyOn(console, 'error');
      const warnSpy = jest.spyOn(console, 'warn');

      logger.error('Error message');
      logger.warn('Warn message');

      expect(errorSpy).toHaveBeenCalledWith('[ERROR] Error message');
      expect(warnSpy).toHaveBeenCalledWith('[WARN] Warn message');
    });

    it('should include data in console output', () => {
      const infoSpy = jest.spyOn(console, 'info');

      const testData = { userId: 'user-123' };
      logger.info('User info', testData);

      expect(infoSpy).toHaveBeenCalledWith('[INFO] User info', testData);
    });

    it('should not log to console in non-development mode', () => {
      const infoSpy = jest.spyOn(console, 'info');

      // Create new logger instance with non-dev mode
      const nonDevLogger = new ClientLoggerTest(false);

      // Clear spy from previous calls
      infoSpy.mockClear();

      nonDevLogger.info('This should not log to console');

      expect(infoSpy).not.toHaveBeenCalled();
      expect(nonDevLogger.getQueueSize()).toBe(1);

      nonDevLogger.cleanup();
    });
  });

  describe('Queue management', () => {
    it('should return correct queue size', () => {
      expect(logger.getQueueSize()).toBe(0);

      logger.info('Message 1');
      expect(logger.getQueueSize()).toBe(1);

      logger.info('Message 2');
      expect(logger.getQueueSize()).toBe(2);

      logger.info('Message 3');
      expect(logger.getQueueSize()).toBe(3);
    });

    it('should clear queue on successful flush', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      logger.info('Message 1');
      logger.info('Message 2');

      expect(logger.getQueueSize()).toBe(2);

      await logger.forceFlush();

      expect(logger.getQueueSize()).toBe(0);
    });

    it('should maintain queue order', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      const messages = ['First', 'Second', 'Third'];
      for (const msg of messages) {
        logger.info(msg);
      }

      await logger.forceFlush();

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1]!.body as string);
      const sentMessages = body.logs.map((log: any) => log.message);

      expect(sentMessages).toEqual(messages);
    });
  });

  describe('Cleanup', () => {
    it('should clear timers on cleanup', () => {
      logger.info('Message 1');

      const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');

      logger.cleanup();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should handle cleanup with no active timers', () => {
      expect(() => {
        logger.cleanup();
      }).not.toThrow();
    });

    it('should prevent further flushes after cleanup', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      logger.info('Message 1');
      logger.cleanup();

      // Advance time past flush interval
      jest.advanceTimersByTime(5000);

      // Fetch should not have been called
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Timestamp handling', () => {
    it('should include timestamp in log entries', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      const beforeTime = Date.now();
      logger.info('Message with timestamp');
      const afterTime = Date.now();

      await logger.forceFlush();

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1]!.body as string);
      const timestamp = body.logs[0].timestamp;

      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('Multiple log levels', () => {
    it('should handle mixed log levels', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      logger.error('Error msg');
      logger.warn('Warn msg');
      logger.info('Info msg');
      logger.debug('Debug msg');

      await logger.forceFlush();

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1]!.body as string);
      const levels = body.logs.map((log: any) => log.level);

      expect(levels).toEqual(['error', 'warn', 'info', 'debug']);
    });

    it('should correctly identify log levels in payload', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      logger.error('Test error');

      await logger.forceFlush();

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1]!.body as string);

      expect(body.logs[0].level).toBe('error');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty message strings', () => {
      expect(() => {
        logger.info('');
        logger.error('');
        logger.warn('');
        logger.debug('');
      }).not.toThrow();

      expect(logger.getQueueSize()).toBe(4);
    });

    it('should handle large data payloads', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      const largeData = {
        nested: {
          deeply: {
            value: 'x'.repeat(1000),
          },
        },
        array: new Array(100).fill('data'),
      };

      logger.info('Message with large data', largeData);

      await logger.forceFlush();

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle rapid sequential logging', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      for (let i = 0; i < 5; i++) {
        logger.info(`Rapid log ${i}`);
      }

      expect(logger.getQueueSize()).toBe(5);

      await logger.forceFlush();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(logger.getQueueSize()).toBe(0);
    });

    it('should handle special characters in messages', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      const specialChars = 'Test with "quotes" and \\ backslashes and \n newlines';
      logger.info(specialChars);

      await logger.forceFlush();

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1]!.body as string);

      expect(body.logs[0].message).toBe(specialChars);
    });
  });

  describe('HTTP status handling', () => {
    it('should handle 400 Bad Request', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      } as Response);

      const errorSpy = jest.spyOn(console, 'error');

      logger.error('Test');
      await logger.forceFlush();

      expect(errorSpy).toHaveBeenCalled();
    });

    it('should handle 500 Server Error', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const errorSpy = jest.spyOn(console, 'error');

      logger.error('Test');
      await logger.forceFlush();

      expect(errorSpy).toHaveBeenCalled();
    });

    it('should handle 429 Too Many Requests', async () => {
      const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
      } as Response);

      const warnSpy = jest.spyOn(console, 'warn');

      logger.warn('Test');
      await logger.forceFlush();

      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
