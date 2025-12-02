/**
 * Unit tests for logger functionality
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Logger, LogLevel } from '@/lib/logger';
import { ConsoleTransport } from '@/lib/logging/transports';

describe('Logger', () => {
  let consoleSpy: {
    error: jest.SpiedFunction<typeof console.error>;
    warn: jest.SpiedFunction<typeof console.warn>;
    info: jest.SpiedFunction<typeof console.info>;
    debug: jest.SpiedFunction<typeof console.debug>;
  };

  beforeEach(() => {
    // Spy on console methods
    consoleSpy = {
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    // Restore console methods
    consoleSpy.error.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.info.mockRestore();
    consoleSpy.debug.mockRestore();
  });

  describe('Basic logging', () => {
    it('should log error messages', () => {
      const logger = new Logger({}, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.error('Test error message');

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      const loggedData = JSON.parse(consoleSpy.error.mock.calls[0][0] as string);

      expect(loggedData.level).toBe(LogLevel.ERROR);
      expect(loggedData.message).toBe('Test error message');
      expect(loggedData.timestamp).toBeDefined();
    });

    it('should log warning messages', () => {
      const logger = new Logger({}, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.warn('Test warning message');

      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      const loggedData = JSON.parse(consoleSpy.warn.mock.calls[0][0] as string);

      expect(loggedData.level).toBe(LogLevel.WARN);
      expect(loggedData.message).toBe('Test warning message');
    });

    it('should log info messages', () => {
      const logger = new Logger({}, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.info('Test info message');

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      const loggedData = JSON.parse(consoleSpy.info.mock.calls[0][0] as string);

      expect(loggedData.level).toBe(LogLevel.INFO);
      expect(loggedData.message).toBe('Test info message');
    });

    it('should log debug messages', () => {
      const logger = new Logger({}, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.debug('Test debug message');

      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
      const loggedData = JSON.parse(consoleSpy.debug.mock.calls[0][0] as string);

      expect(loggedData.level).toBe(LogLevel.DEBUG);
      expect(loggedData.message).toBe('Test debug message');
    });
  });

  describe('Context handling', () => {
    it('should include initial context in logs', () => {
      const logger = new Logger({ userId: 'user-123' }, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.info('Test message');

      const loggedData = JSON.parse(consoleSpy.info.mock.calls[0][0] as string);
      expect(loggedData.context.userId).toBe('user-123');
    });

    it('should include additional context in logs', () => {
      const logger = new Logger({}, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.info('Test message', { requestId: 'req-456' });

      const loggedData = JSON.parse(consoleSpy.info.mock.calls[0][0] as string);
      expect(loggedData.context.requestId).toBe('req-456');
    });

    it('should merge initial and additional context', () => {
      const logger = new Logger({ userId: 'user-123' }, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.info('Test message', { requestId: 'req-456' });

      const loggedData = JSON.parse(consoleSpy.info.mock.calls[0][0] as string);
      expect(loggedData.context.userId).toBe('user-123');
      expect(loggedData.context.requestId).toBe('req-456');
    });

    it('should create child logger with additional context', () => {
      const parentLogger = new Logger({ service: 'api' }, [new ConsoleTransport()], LogLevel.DEBUG);
      const childLogger = parentLogger.child({ userId: 'user-123' });

      childLogger.info('Test message');

      const loggedData = JSON.parse(consoleSpy.info.mock.calls[0][0] as string);
      expect(loggedData.context.service).toBe('api');
      expect(loggedData.context.userId).toBe('user-123');
    });
  });

  describe('Error logging', () => {
    it('should include error details in logs', () => {
      const logger = new Logger({}, [new ConsoleTransport()], LogLevel.DEBUG);
      const error = new Error('Test error');
      error.stack = 'Error stack trace';

      logger.error('Error occurred', {}, error);

      const loggedData = JSON.parse(consoleSpy.error.mock.calls[0][0] as string);
      expect(loggedData.error).toBeDefined();
      expect(loggedData.error.name).toBe('Error');
      expect(loggedData.error.message).toBe('Test error');
      expect(loggedData.error.stack).toBeDefined();
    });
  });

  describe('Specialized logging methods', () => {
    it('should log HTTP requests', () => {
      const logger = new Logger({}, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.logRequest('GET', '/api/test', 200, 123);

      const loggedData = JSON.parse(consoleSpy.info.mock.calls[0][0] as string);
      expect(loggedData.message).toBe('HTTP request');
      expect(loggedData.context.method).toBe('GET');
      expect(loggedData.context.path).toBe('/api/test');
      expect(loggedData.context.statusCode).toBe(200);
      expect(loggedData.context.duration).toBe(123);
    });

    it('should log API key operations', () => {
      const logger = new Logger({}, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.logApiKeyOperation('encrypt', 'OPENAI', 'user-123', true);

      const loggedData = JSON.parse(consoleSpy.info.mock.calls[0][0] as string);
      expect(loggedData.message).toBe('API key operation');
      expect(loggedData.context.operation).toBe('encrypt');
      expect(loggedData.context.provider).toBe('OPENAI');
      expect(loggedData.context.userId).toBe('user-123');
      expect(loggedData.context.success).toBe(true);
    });

    it('should log LLM API calls', () => {
      const logger = new Logger({}, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.logLLMCall('OPENAI', 'gpt-4', 150, true, 1234);

      const loggedData = JSON.parse(consoleSpy.info.mock.calls[0][0] as string);
      expect(loggedData.message).toBe('LLM API call');
      expect(loggedData.context.provider).toBe('OPENAI');
      expect(loggedData.context.model).toBe('gpt-4');
      expect(loggedData.context.tokenCount).toBe(150);
      expect(loggedData.context.success).toBe(true);
      expect(loggedData.context.duration).toBe(1234);
    });

    it('should log authentication events', () => {
      const logger = new Logger({}, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.logAuth('signin', 'google', 'user-123', true);

      const loggedData = JSON.parse(consoleSpy.info.mock.calls[0][0] as string);
      expect(loggedData.message).toBe('Authentication event');
      expect(loggedData.context.event).toBe('signin');
      expect(loggedData.context.provider).toBe('google');
      expect(loggedData.context.userId).toBe('user-123');
      expect(loggedData.context.success).toBe(true);
    });
  });

  describe('Log structure', () => {
    it('should include timestamp in all logs', () => {
      const logger = new Logger({}, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.info('Test message');

      const loggedData = JSON.parse(consoleSpy.info.mock.calls[0][0] as string);
      expect(loggedData.timestamp).toBeDefined();
      expect(typeof loggedData.timestamp).toBe('string');
    });

    it('should produce valid JSON', () => {
      const logger = new Logger({ complex: { nested: { data: 'value' } } }, [new ConsoleTransport()], LogLevel.DEBUG);
      logger.info('Test message', { array: [1, 2, 3] });

      expect(() => {
        JSON.parse(consoleSpy.info.mock.calls[0][0] as string);
      }).not.toThrow();
    });
  });
});
