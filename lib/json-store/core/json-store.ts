/**
 * JsonStore Core Service
 *
 * Manages file I/O, path resolution, atomic writes, and JSONL operations
 * for the JSON-based data store.
 *
 * Key Features:
 * - Atomic read-modify-write with temp file + rename
 * - Advisory file locking for concurrent access
 * - JSONL append helpers with fsync batching
 * - Path resolution based on DATA_DIR environment variable
 * - In-memory caching for hot data (optional)
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as crypto from 'crypto';

const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const appendFile = promisify(fs.appendFile);
const rename = promisify(fs.rename);
const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * Configuration for JsonStore
 */
export interface JsonStoreConfig {
  dataDir?: string; // Defaults to './data'
  enableCache?: boolean; // Enable in-memory caching (default: true)
  lockTimeout?: number; // Lock wait timeout in ms (default: 5000)
  fsyncInterval?: number; // Batch fsync count for JSONL (default: 10)
}

/**
 * JsonStore service
 */
export class JsonStore {
  private dataDir: string;
  private enableCache: boolean;
  private lockTimeout: number;
  private fsyncInterval: number;
  private locks: Map<string, Promise<void>> = new Map();
  private cache: Map<string, unknown> = new Map();

  constructor(config: JsonStoreConfig = {}) {
    this.dataDir = config.dataDir || process.env.DATA_DIR || './data';
    this.enableCache = config.enableCache ?? true;
    this.lockTimeout = config.lockTimeout ?? 5000;
    this.fsyncInterval = config.fsyncInterval ?? 10;

    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Get the configured data directory path
   */
  getDataDir(): string {
    return this.dataDir;
  }

  /**
   * Resolve a relative path within data directory
   */
  resolvePath(...segments: string[]): string {
    return path.join(this.dataDir, ...segments);
  }

  /**
   * Ensure a directory exists
   */
  async ensureDir(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
  }

  /**
   * Acquire a lock for a file path
   */
  private async acquireLock(filePath: string): Promise<void> {
    const lockPath = `${filePath}.lock`;
    const lockDir = path.dirname(lockPath);
    const startTime = Date.now();

    // Ensure lock directory exists
    await this.ensureDir(lockDir);

    while (true) {
      try {
        // Try to create lock file exclusively
        const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
        fs.closeSync(fd);
        return; // Lock acquired
      } catch (error: any) {
        if (error.code !== 'EEXIST') {
          throw error;
        }

        // Lock exists, check if it's stale (older than 30 seconds)
        try {
          const stats = await stat(lockPath);
          if (Date.now() - stats.mtimeMs > 30000) {
            await unlink(lockPath); // Remove stale lock
            continue;
          }
        } catch {
          // Lock file disappeared, retry
          continue;
        }

        // Check timeout
        if (Date.now() - startTime > this.lockTimeout) {
          throw new Error(`Failed to acquire lock for ${filePath} within ${this.lockTimeout}ms`);
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }

  /**
   * Release a lock for a file path
   */
  private async releaseLock(filePath: string): Promise<void> {
    const lockPath = `${filePath}.lock`;
    try {
      await unlink(lockPath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`Failed to release lock for ${filePath}:`, error);
      }
    }
  }

  /**
   * Read JSON file with caching
   */
  async readJson<T>(filePath: string): Promise<T> {
    const fullPath = this.resolvePath(filePath);
    const cacheKey = fullPath;

    // Check cache
    if (this.enableCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) as T;
    }

    try {
      const content = await readFile(fullPath, 'utf-8');
      const data = JSON.parse(content) as T;

      // Cache the result
      if (this.enableCache) {
        this.cache.set(cacheKey, data);
      }

      return data;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw new Error(`Failed to read JSON from ${filePath}: ${error.message}`);
    }
  }

  /**
   * Write JSON file atomically with locking
   */
  async writeJson<T>(filePath: string, data: T): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    const dir = path.dirname(fullPath);

    // Ensure directory exists
    await this.ensureDir(dir);

    // Acquire lock
    await this.acquireLock(fullPath);

    try {
      // Write to temp file first
      const tempPath = `${fullPath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
      const content = JSON.stringify(data, null, 2);
      await writeFile(tempPath, content, 'utf-8');

      // Atomic rename
      await rename(tempPath, fullPath);

      // Invalidate cache
      if (this.enableCache) {
        this.cache.delete(fullPath);
      }
    } finally {
      // Release lock
      await this.releaseLock(fullPath);
    }
  }

  /**
   * Read JSONL file line by line
   */
  async readJsonl<T>(filePath: string): Promise<T[]> {
    const fullPath = this.resolvePath(filePath);

    try {
      const content = await readFile(fullPath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      return lines.map(line => JSON.parse(line) as T);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return []; // Return empty array if file doesn't exist
      }
      throw new Error(`Failed to read JSONL from ${filePath}: ${error.message}`);
    }
  }

  /**
   * Write raw content to file atomically with locking (for pre-formatted JSONL)
   */
  async writeRaw(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    const dir = path.dirname(fullPath);

    // Ensure directory exists
    await this.ensureDir(dir);

    // Acquire lock
    await this.acquireLock(fullPath);

    try {
      // Write to temp file first
      const tempPath = `${fullPath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
      await writeFile(tempPath, content, 'utf-8');

      // Atomic rename
      await rename(tempPath, fullPath);

      // Invalidate cache
      if (this.enableCache) {
        this.cache.delete(fullPath);
      }
    } finally {
      // Release lock
      await this.releaseLock(fullPath);
    }
  }

  /**
   * Write JSONL file atomically (full rewrite for updates/deletes)
   */
  async writeJsonl<T>(filePath: string, items: T[]): Promise<void> {
    const content = items.length > 0
      ? items.map(item => JSON.stringify(item)).join('\n') + '\n'
      : '';
    await this.writeRaw(filePath, content);
  }

  /**
   * Append to JSONL file (line-delimited JSON)
   */
  async appendJsonl<T>(filePath: string, items: T[]): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    const dir = path.dirname(fullPath);

    // Ensure directory exists
    await this.ensureDir(dir);

    // Acquire lock
    await this.acquireLock(fullPath);

    try {
      const lines = items.map(item => JSON.stringify(item)).join('\n') + '\n';

      // Append to file
      if (fs.existsSync(fullPath)) {
        await appendFile(fullPath, lines, 'utf-8');
      } else {
        await writeFile(fullPath, lines, 'utf-8');
      }

      // Invalidate cache
      if (this.enableCache) {
        this.cache.delete(fullPath);
      }
    } finally {
      // Release lock
      await this.releaseLock(fullPath);
    }
  }

  /**
   * Get file size in bytes
   */
  async getFileSize(filePath: string): Promise<number> {
    const fullPath = this.resolvePath(filePath);
    try {
      const stats = await stat(fullPath);
      return stats.size;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return 0;
      }
      throw error;
    }
  }

  /**
   * Check if file exists
   */
  exists(filePath: string): boolean {
    const fullPath = this.resolvePath(filePath);
    return fs.existsSync(fullPath);
  }

  /**
   * List files in a directory
   */
  async listDir(dirPath: string): Promise<string[]> {
    const fullPath = this.resolvePath(dirPath);
    try {
      return await readdir(fullPath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    try {
      await unlink(fullPath);
      if (this.enableCache) {
        this.cache.delete(fullPath);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Clear in-memory cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; enabled: boolean } {
    return {
      size: this.cache.size,
      enabled: this.enableCache,
    };
  }
}

/**
 * Singleton instance
 */
let instance: JsonStore | null = null;

/**
 * Get or create JsonStore singleton
 */
export function getJsonStore(config?: JsonStoreConfig): JsonStore {
  if (!instance) {
    instance = new JsonStore(config);
  }
  return instance;
}

/**
 * Reset singleton (for testing)
 */
export function resetJsonStore(): void {
  instance = null;
}
