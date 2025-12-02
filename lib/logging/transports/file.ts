/**
 * File transport for persistent logging with rotation
 * Writes logs to files on disk with automatic rotation when files exceed maxFileSize
 * Maintains separate logs for all entries and error-only entries
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { LogLevel } from '@/lib/logger';
import { LogTransport, LogData } from './base';

/**
 * File transport implementation
 * Handles writing log entries to disk with automatic file rotation
 * Features:
 * - Writes all logs to combined.log
 * - Writes errors only to error.log
 * - Automatic rotation when files exceed maxFileSize
 * - Configurable retention (maxFiles)
 * - Graceful error handling (falls back to console.error if disk write fails)
 */
export class FileTransport implements LogTransport {
  private logDir: string;
  private maxFileSize: number;
  private maxFiles: number;
  private fileSizes: Map<string, number> = new Map();

  /**
   * Create a new FileTransport instance
   * @param logDir Directory where log files will be stored
   * @param maxFileSize Maximum size of a log file in bytes (default: 10MB)
   * @param maxFiles Maximum number of rotated files to keep (default: 5)
   */
  constructor(
    logDir: string,
    maxFileSize: number = 10485760, // 10MB default
    maxFiles: number = 5
  ) {
    this.logDir = logDir;
    this.maxFileSize = maxFileSize;
    this.maxFiles = maxFiles;

    // Initialize directory and size tracking
    this.initializeDirectory();
  }

  /**
   * Initialize the log directory and track existing file sizes
   */
  private async initializeDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });

      // Track existing file sizes
      const combinedLogPath = join(this.logDir, 'combined.log');
      const errorLogPath = join(this.logDir, 'error.log');

      try {
        const combinedStats = await fs.stat(combinedLogPath);
        this.fileSizes.set('combined.log', combinedStats.size);
      } catch {
        // File doesn't exist yet, start at 0
        this.fileSizes.set('combined.log', 0);
      }

      try {
        const errorStats = await fs.stat(errorLogPath);
        this.fileSizes.set('error.log', errorStats.size);
      } catch {
        // File doesn't exist yet, start at 0
        this.fileSizes.set('error.log', 0);
      }
    } catch (error) {
      console.error(
        'Failed to initialize logging directory:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Write a log entry to the appropriate file(s)
   * @param logData The structured log data to write
   */
  async write(logData: LogData): Promise<void> {
    const logString = JSON.stringify(logData);
    const lineWithNewline = logString + '\n';

    // Write to combined log
    await this.writeToFile('combined.log', lineWithNewline);

    // Write to error log if this is an error
    if (logData.level === LogLevel.ERROR) {
      await this.writeToFile('error.log', lineWithNewline);
    }
  }

  /**
   * Write a line to a specific log file with rotation support
   * @param filename The log filename (combined.log or error.log)
   * @param content The log line to write
   */
  private async writeToFile(
    filename: string,
    content: string
  ): Promise<void> {
    try {
      const filePath = join(this.logDir, filename);
      const contentSize = Buffer.byteLength(content, 'utf-8');

      // Check if rotation is needed
      const currentSize = this.fileSizes.get(filename) || 0;
      if (currentSize + contentSize > this.maxFileSize) {
        await this.rotateFile(filename);
      }

      // Append to the current file
      await fs.appendFile(filePath, content, 'utf-8');

      // Update tracked size
      const newSize = (this.fileSizes.get(filename) || 0) + contentSize;
      this.fileSizes.set(filename, newSize);
    } catch (error) {
      // Graceful fallback to console on disk write failure
      console.error(
        `Failed to write to ${filename}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Rotate a log file when it exceeds maxFileSize
   * Renames existing rotated files and starts fresh
   * Old rotations beyond maxFiles are deleted
   * @param filename The log filename to rotate
   */
  private async rotateFile(filename: string): Promise<void> {
    try {
      const basePath = join(this.logDir, filename);

      // Remove oldest file if we're at max capacity
      const oldestPath = join(this.logDir, `${filename}.${this.maxFiles}`);
      try {
        await fs.unlink(oldestPath);
      } catch {
        // File doesn't exist, that's fine
      }

      // Shift existing rotations: combined.log.2 -> combined.log.3, etc.
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldPath = join(this.logDir, `${filename}.${i}`);
        const newPath = join(this.logDir, `${filename}.${i + 1}`);

        try {
          await fs.rename(oldPath, newPath);
        } catch {
          // File doesn't exist yet, that's fine
        }
      }

      // Rename current log to .1
      const rotatedPath = join(this.logDir, `${filename}.1`);
      try {
        await fs.rename(basePath, rotatedPath);
      } catch {
        // File might not exist, that's fine
      }

      // Reset size tracker for the current file
      this.fileSizes.set(filename, 0);
    } catch (error) {
      console.error(
        `Failed to rotate ${filename}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
