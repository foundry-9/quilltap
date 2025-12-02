/**
 * Unit tests for logging transports
 * Tests for ConsoleTransport and FileTransport implementations
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { LogLevel } from '@/lib/logger';
import { LogData, LogError } from '@/lib/logging/transports/base';
import { ConsoleTransport } from '@/lib/logging/transports/console';
import { FileTransport } from '@/lib/logging/transports/file';

describe('ConsoleTransport', () => {
  let consoleSpy: {
    error: jest.SpiedFunction<typeof console.error>;
    warn: jest.SpiedFunction<typeof console.warn>;
    info: jest.SpiedFunction<typeof console.info>;
    debug: jest.SpiedFunction<typeof console.debug>;
    log: jest.SpiedFunction<typeof console.log>;
  };

  beforeEach(() => {
    // Spy on all console methods
    consoleSpy = {
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    // Restore all console methods
    consoleSpy.error.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.info.mockRestore();
    consoleSpy.debug.mockRestore();
    consoleSpy.log.mockRestore();
  });

  describe('Level routing', () => {
    it('should route ERROR level to console.error', () => {
      const transport = new ConsoleTransport();
      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.ERROR,
        message: 'Error message',
        context: {},
      };

      transport.write(logData);

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('should route WARN level to console.warn', () => {
      const transport = new ConsoleTransport();
      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.WARN,
        message: 'Warning message',
        context: {},
      };

      transport.write(logData);

      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('should route INFO level to console.info', () => {
      const transport = new ConsoleTransport();
      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'Info message',
        context: {},
      };

      transport.write(logData);

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('should route DEBUG level to console.debug', () => {
      const transport = new ConsoleTransport();
      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.DEBUG,
        message: 'Debug message',
        context: {},
      };

      transport.write(logData);

      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
    });

    it('should fallback to console.log for unknown level', () => {
      const transport = new ConsoleTransport();
      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: 'unknown' as LogLevel,
        message: 'Unknown level message',
        context: {},
      };

      transport.write(logData);

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });
  });

  describe('JSON serialization', () => {
    it('should stringify log data as JSON', () => {
      const transport = new ConsoleTransport();
      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'Test message',
        context: { userId: 'user-123' },
      };

      transport.write(logData);

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      const callArg = consoleSpy.info.mock.calls[0][0];
      const parsed = JSON.parse(callArg as string);

      expect(parsed.timestamp).toBe('2025-12-01T00:00:00.000Z');
      expect(parsed.level).toBe(LogLevel.INFO);
      expect(parsed.message).toBe('Test message');
      expect(parsed.context.userId).toBe('user-123');
    });

    it('should include error details in JSON when present', () => {
      const transport = new ConsoleTransport();
      const error: LogError = {
        name: 'CustomError',
        message: 'Something went wrong',
        stack: 'CustomError: Something went wrong\n  at line 1',
      };

      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.ERROR,
        message: 'Error occurred',
        context: {},
        error,
      };

      transport.write(logData);

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      const callArg = consoleSpy.error.mock.calls[0][0];
      const parsed = JSON.parse(callArg as string);

      expect(parsed.error).toBeDefined();
      expect(parsed.error.name).toBe('CustomError');
      expect(parsed.error.message).toBe('Something went wrong');
      expect(parsed.error.stack).toBeDefined();
    });

    it('should handle complex context objects', () => {
      const transport = new ConsoleTransport();
      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'Complex context',
        context: {
          nested: {
            level1: {
              level2: 'value',
            },
          },
          array: [1, 2, 3],
          boolean: true,
          number: 42,
        },
      };

      transport.write(logData);

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      const callArg = consoleSpy.info.mock.calls[0][0];
      const parsed = JSON.parse(callArg as string);

      expect(parsed.context.nested.level1.level2).toBe('value');
      expect(parsed.context.array).toEqual([1, 2, 3]);
      expect(parsed.context.boolean).toBe(true);
      expect(parsed.context.number).toBe(42);
    });
  });

  describe('Multiple writes', () => {
    it('should handle multiple consecutive writes', () => {
      const transport = new ConsoleTransport();

      for (let i = 0; i < 5; i++) {
        const logData: LogData = {
          timestamp: '2025-12-01T00:00:00.000Z',
          level: LogLevel.INFO,
          message: `Message ${i}`,
          context: { index: i },
        };
        transport.write(logData);
      }

      expect(consoleSpy.info).toHaveBeenCalledTimes(5);
    });

    it('should maintain separate call stacks for different levels', () => {
      const transport = new ConsoleTransport();

      const errorLog: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.ERROR,
        message: 'Error',
        context: {},
      };

      const warnLog: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.WARN,
        message: 'Warning',
        context: {},
      };

      const infoLog: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'Info',
        context: {},
      };

      transport.write(errorLog);
      transport.write(warnLog);
      transport.write(infoLog);

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    });
  });
});

describe('FileTransport', () => {
  let tempDir: string;
  let fsSpies: {
    mkdir: jest.SpiedFunction<typeof fs.mkdir>;
    stat: jest.SpiedFunction<typeof fs.stat>;
    appendFile: jest.SpiedFunction<typeof fs.appendFile>;
    rename: jest.SpiedFunction<typeof fs.rename>;
    unlink: jest.SpiedFunction<typeof fs.unlink>;
  };
  let consoleSpy: {
    error: jest.SpiedFunction<typeof console.error>;
  };

  beforeEach(() => {
    tempDir = '/tmp/test-logs';

    // Mock fs methods
    fsSpies = {
      mkdir: jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined),
      stat: jest.spyOn(fs, 'stat').mockRejectedValue(new Error('ENOENT')),
      appendFile: jest.spyOn(fs, 'appendFile').mockResolvedValue(undefined),
      rename: jest.spyOn(fs, 'rename').mockResolvedValue(undefined),
      unlink: jest.spyOn(fs, 'unlink').mockResolvedValue(undefined),
    };

    // Spy on console.error for error handling
    consoleSpy = {
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    // Restore all spies
    fsSpies.mkdir.mockRestore();
    fsSpies.stat.mockRestore();
    fsSpies.appendFile.mockRestore();
    fsSpies.rename.mockRestore();
    fsSpies.unlink.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe('Initialization', () => {
    it('should create directory on initialization', async () => {
      const transport = new FileTransport(tempDir);

      // Wait a tick for async initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fsSpies.mkdir).toHaveBeenCalledWith(tempDir, { recursive: true });
    });

    it('should initialize file size tracking for combined.log', async () => {
      fsSpies.stat.mockResolvedValueOnce({ size: 1024 } as any);

      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      const combinedLogPath = join(tempDir, 'combined.log');
      expect(fsSpies.stat).toHaveBeenCalledWith(combinedLogPath);
    });

    it('should initialize file size tracking for error.log', async () => {
      fsSpies.stat.mockResolvedValueOnce({ size: 512 } as any);

      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      const errorLogPath = join(tempDir, 'error.log');
      // stat is called twice (once for combined, once for error)
      expect(fsSpies.stat).toHaveBeenCalledWith(errorLogPath);
    });

    it('should handle missing files gracefully during initialization', async () => {
      fsSpies.stat.mockRejectedValue(new Error('ENOENT'));

      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should not throw and should initialize file sizes to 0
      expect(fsSpies.mkdir).toHaveBeenCalled();
    });

    it('should handle initialization errors gracefully', async () => {
      fsSpies.mkdir.mockRejectedValueOnce(new Error('Permission denied'));

      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should log error to console but not throw
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe('Writing logs', () => {
    it('should write to combined.log for all log levels', async () => {
      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'Test info',
        context: {},
      };

      await transport.write(logData);

      expect(fsSpies.appendFile).toHaveBeenCalledWith(
        join(tempDir, 'combined.log'),
        expect.stringContaining('Test info'),
        'utf-8'
      );
    });

    it('should write to error.log only for ERROR level', async () => {
      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Reset mock to clear initialization calls
      fsSpies.appendFile.mockClear();

      const errorLog: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.ERROR,
        message: 'Test error',
        context: {},
      };

      await transport.write(errorLog);

      // Should write to both combined.log and error.log
      expect(fsSpies.appendFile).toHaveBeenCalledTimes(2);
      expect(fsSpies.appendFile).toHaveBeenNthCalledWith(
        1,
        join(tempDir, 'combined.log'),
        expect.any(String),
        'utf-8'
      );
      expect(fsSpies.appendFile).toHaveBeenNthCalledWith(
        2,
        join(tempDir, 'error.log'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should not write to error.log for non-ERROR levels', async () => {
      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      fsSpies.appendFile.mockClear();

      const warnLog: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.WARN,
        message: 'Test warning',
        context: {},
      };

      await transport.write(warnLog);

      // Should write only to combined.log
      expect(fsSpies.appendFile).toHaveBeenCalledTimes(1);
      expect(fsSpies.appendFile).toHaveBeenCalledWith(
        join(tempDir, 'combined.log'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should add newline to log entries', async () => {
      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'Test',
        context: {},
      };

      await transport.write(logData);

      expect(fsSpies.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('\n'),
        'utf-8'
      );
    });

    it('should include all log data in JSON format', async () => {
      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'Test message',
        context: { userId: 'user-123', action: 'create' },
      };

      await transport.write(logData);

      const call = fsSpies.appendFile.mock.calls[0];
      const content = (call[1] as string).trim();
      const parsed = JSON.parse(content);

      expect(parsed.timestamp).toBe('2025-12-01T00:00:00.000Z');
      expect(parsed.level).toBe(LogLevel.INFO);
      expect(parsed.message).toBe('Test message');
      expect(parsed.context.userId).toBe('user-123');
      expect(parsed.context.action).toBe('create');
    });
  });

  describe('File rotation', () => {
    it('should rotate file when size exceeds maxFileSize', async () => {
      const maxFileSize = 100;
      const transport = new FileTransport(tempDir, maxFileSize);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      fsSpies.appendFile.mockClear();

      // Create a log that will exceed the max size
      const largeLog: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'A'.repeat(200), // Large message
        context: { largeField: 'B'.repeat(200) },
      };

      await transport.write(largeLog);

      // Should have called rotate (unlink, rename operations)
      expect(fsSpies.rename).toHaveBeenCalled();
    });

    it('should remove oldest file when maxFiles limit is reached', async () => {
      const maxFileSize = 100;
      const maxFiles = 3;
      const transport = new FileTransport(tempDir, maxFileSize, maxFiles);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      fsSpies.unlink.mockClear();
      fsSpies.rename.mockClear();

      // Write a large log to trigger rotation
      const largeLog: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'A'.repeat(300),
        context: {},
      };

      await transport.write(largeLog);

      // Should attempt to remove the oldest file
      expect(fsSpies.unlink).toHaveBeenCalledWith(
        join(tempDir, `combined.log.${maxFiles}`)
      );
    });

    it('should rename rotated files in sequence', async () => {
      const maxFileSize = 100;
      const maxFiles = 3;
      const transport = new FileTransport(tempDir, maxFileSize, maxFiles);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      fsSpies.rename.mockClear();

      const largeLog: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'A'.repeat(300),
        context: {},
      };

      await transport.write(largeLog);

      // Should rename current log to .1
      expect(fsSpies.rename).toHaveBeenCalledWith(
        join(tempDir, 'combined.log'),
        join(tempDir, 'combined.log.1')
      );
    });

    it('should handle rotation errors gracefully', async () => {
      const maxFileSize = 100;
      const transport = new FileTransport(tempDir, maxFileSize);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      fsSpies.rename.mockRejectedValueOnce(new Error('Permission denied'));

      const largeLog: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'A'.repeat(300),
        context: {},
      };

      // Should not throw even if rotation fails
      await expect(transport.write(largeLog)).resolves.not.toThrow();
    });

    it('should track file sizes after writes', async () => {
      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'Test',
        context: {},
      };

      fsSpies.appendFile.mockClear();
      await transport.write(logData);

      // Second write should use updated size tracking
      await transport.write(logData);

      expect(fsSpies.appendFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error handling', () => {
    it('should handle appendFile errors gracefully', async () => {
      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      fsSpies.appendFile.mockRejectedValueOnce(new Error('Disk full'));

      const logData: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'Test',
        context: {},
      };

      // Should not throw
      await expect(transport.write(logData)).resolves.not.toThrow();

      // Should log error to console
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write'),
        expect.any(String)
      );
    });

    it('should continue writing other files if one fails', async () => {
      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      fsSpies.appendFile.mockClear();

      // Mock first appendFile to fail, others to succeed
      fsSpies.appendFile
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockResolvedValueOnce(undefined);

      const errorLog: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.ERROR,
        message: 'Test error',
        context: {},
      };

      await transport.write(errorLog);

      // Should have attempted to write to both files
      expect(fsSpies.appendFile).toHaveBeenCalledTimes(2);

      // Should have logged error
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should handle errors in rotateFile without throwing', async () => {
      const maxFileSize = 100;
      const transport = new FileTransport(tempDir, maxFileSize);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Mock all fs operations to fail
      fsSpies.unlink.mockRejectedValue(new Error('Permission denied'));
      fsSpies.rename.mockRejectedValue(new Error('Permission denied'));

      const largeLog: LogData = {
        timestamp: '2025-12-01T00:00:00.000Z',
        level: LogLevel.INFO,
        message: 'A'.repeat(300),
        context: {},
      };

      // Should not throw
      await expect(transport.write(largeLog)).resolves.not.toThrow();
    });
  });

  describe('Configuration', () => {
    it('should use custom maxFileSize', () => {
      const customSize = 5242880; // 5MB
      expect(() => new FileTransport(tempDir, customSize)).not.toThrow();
    });

    it('should use custom maxFiles', () => {
      const customMax = 10;
      expect(() => new FileTransport(tempDir, 10485760, customMax)).not.toThrow();
    });

    it('should use default maxFileSize if not provided', () => {
      expect(() => new FileTransport(tempDir)).not.toThrow();
    });

    it('should use default maxFiles if not provided', () => {
      expect(() => new FileTransport(tempDir, 10485760)).not.toThrow();
    });
  });

  describe('Multiple log levels', () => {
    it('should write to appropriate files based on level', async () => {
      const transport = new FileTransport(tempDir);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 0));

      fsSpies.appendFile.mockClear();

      const logs: LogData[] = [
        {
          timestamp: '2025-12-01T00:00:00.000Z',
          level: LogLevel.ERROR,
          message: 'Error',
          context: {},
        },
        {
          timestamp: '2025-12-01T00:00:01.000Z',
          level: LogLevel.WARN,
          message: 'Warning',
          context: {},
        },
        {
          timestamp: '2025-12-01T00:00:02.000Z',
          level: LogLevel.INFO,
          message: 'Info',
          context: {},
        },
        {
          timestamp: '2025-12-01T00:00:03.000Z',
          level: LogLevel.DEBUG,
          message: 'Debug',
          context: {},
        },
      ];

      for (const log of logs) {
        await transport.write(log);
      }

      // Error level: 2 writes (combined + error)
      // Others: 1 write each (combined only)
      // Total: 2 + 1 + 1 + 1 = 5
      expect(fsSpies.appendFile).toHaveBeenCalledTimes(5);
    });
  });
});
