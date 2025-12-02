/**
 * Console transport for logging
 * Outputs log data to the console using the appropriate console method
 * based on the log level
 */

import { LogLevel } from '@/lib/logger';
import { LogTransport, LogData } from './base';

/**
 * Console transport implementation
 * Routes log output to console.error, console.warn, console.info, or console.debug
 * based on the log level
 */
export class ConsoleTransport implements LogTransport {
  /**
   * Write a log entry to the console
   * @param logData The structured log data to write
   */
  write(logData: LogData): void {
    const logString = JSON.stringify(logData);

    switch (logData.level) {
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
      default:
        // Fallback for any unknown levels
        console.log(logString);
    }
  }
}
