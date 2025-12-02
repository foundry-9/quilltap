/**
 * Transport abstraction layer for the logging system
 * Defines the interface that all log transports must implement
 */

import { LogLevel } from '@/lib/logger';

/**
 * Error information included in log data
 */
export interface LogError {
  name: string;
  message: string;
  stack?: string;
}

/**
 * Complete log data structure passed to transports
 */
export interface LogData {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: {
    [key: string]: any;
  };
  error?: LogError;
}

/**
 * Interface that all log transports must implement
 * A transport is responsible for actually outputting log data somewhere
 * (console, file, remote service, etc.)
 */
export interface LogTransport {
  /**
   * Write a log entry to the transport
   * @param logData The structured log data to write
   * @returns void or Promise<void> for async operations
   */
  write(logData: LogData): void | Promise<void>;
}
