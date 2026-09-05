/**
 * Mount Index SQLite Client Module
 *
 * Provides a dedicated singleton better-sqlite3 database connection for
 * the mount index database. This isolates mount tracking data from the
 * main database so corruption in the mount index DB can never threaten
 * characters, chats, messages, or memories.
 *
 * Features:
 * - Separate WAL + busy_timeout + cache + mmap configuration
 * - Foreign keys ENABLED (mount index has inter-table relationships)
 * - Graceful degradation: if the DB fails to open, the app continues
 *   with mount indexing silently disabled (all safeQuery fallbacks handle this)
 * - globalThis persistence to survive Next.js HMR
 *
 * @module lib/database/backends/sqlite/mount-index-client
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import { sleepSync } from '@/lib/utils/sleep';
import { SQLiteConfig } from '../../config';
import { logger } from '@/lib/logger';
import { applySqlcipherKey } from './sqlcipher-key';
import { stopMountIndexPeriodicCheckpoints, runMountIndexShutdownCheckpoint } from './mount-index-protection';

const moduleLogger = logger.child({ module: 'database:mount-index-client' });

// ============================================================================
// HMR-Safe Global State
// ============================================================================

declare global {
  var __quilltapMountIndexDatabase: DatabaseType | undefined;
  var __quilltapMountIndexDegraded: boolean | undefined;
}

// ============================================================================
// Client Management
// ============================================================================

/** Retry budget for cold-open of the mount-index DB. See attemptOpen() below. */
const OPEN_RETRY_BACKOFF_MS = [200, 600, 1500];

/**
 * One attempt to open + key + verify the mount-index DB. Throws on any
 * failure so the caller can decide whether to retry. On success, returns a
 * fully configured connection ready for use.
 */
function attemptOpenMountIndex(config: SQLiteConfig): DatabaseType {
  const db = new Database(config.path);
  let configured = false;
  try {
    // SQLCipher key MUST be the first pragma before any other operations.
    applySqlcipherKey(db);

    // Verify probe — forces SQLCipher to decrypt page 1 and parse the
    // SQLite header. Failure here surfaces cleanly as `file is not a
    // database` rather than waiting for the first user query to fail. This
    // is also where a flaky iCloud Drive / VirtioFS read bites us, so
    // putting it inside the try lets the outer retry loop recover.
    db.prepare('SELECT count(*) AS cnt FROM sqlite_master').get();

    if (config.walMode) {
      db.pragma('journal_mode = WAL');
    } else {
      db.pragma(`journal_mode = ${config.journalMode}`);
    }
    db.pragma(`synchronous = ${config.synchronous}`);
    db.pragma(`busy_timeout = ${config.busyTimeout}`);
    db.pragma(`cache_size = ${config.cacheSize}`);
    db.pragma('mmap_size = 268435456'); // 256MB
    db.pragma('temp_store = MEMORY');
    db.pragma('foreign_keys = ON');

    configured = true;
    return db;
  } finally {
    if (!configured) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Initialize and return the mount index database connection.
 *
 * Wraps the open + key + verify-probe sequence in a retry loop. A single
 * transient failure during cold open — typically `file is not a database`
 * caused by a bind-mounted iCloud Drive returning incomplete page-1 bytes
 * to Docker — used to lock the connection into degraded mode for the whole
 * process lifetime, breaking every mount-blob lookup. The retry gives the
 * filesystem a moment to settle before we give up.
 *
 * Uses the same pragma set as the main DB. Foreign keys are enabled
 * because the mount index has inter-table relationships.
 *
 * @param config - SQLite config (path should point to the mount index DB)
 * @returns The database instance, or null if opening failed (degraded mode)
 */
export function getMountIndexSQLiteClient(config: SQLiteConfig): DatabaseType | null {
  if (globalThis.__quilltapMountIndexDatabase) {
    return globalThis.__quilltapMountIndexDatabase;
  }

  moduleLogger.info('Initializing mount index database connection', {
    path: config.path,
    walMode: config.walMode,
  });

  let lastError: unknown;
  const maxAttempts = OPEN_RETRY_BACKOFF_MS.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const db = attemptOpenMountIndex(config);
      globalThis.__quilltapMountIndexDatabase = db;
      globalThis.__quilltapMountIndexDegraded = false;

      moduleLogger.info('Mount index database connection established', {
        path: config.path,
        attempts: attempt + 1,
      });

      return db;
    } catch (error) {
      lastError = error;
      const backoff = OPEN_RETRY_BACKOFF_MS[attempt];
      if (backoff !== undefined) {
        moduleLogger.warn('Mount index cold-open failed — retrying', {
          path: config.path,
          attempt: attempt + 1,
          maxAttempts,
          backoffMs: backoff,
          error: error instanceof Error ? error.message : String(error),
        });
        sleepSync(backoff);
      }
    }
  }

  moduleLogger.error('Failed to initialize mount index database — entering degraded mode', {
    path: config.path,
    attempts: maxAttempts,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  globalThis.__quilltapMountIndexDegraded = true;
  return null;
}

/**
 * Close the mount index database connection.
 *
 * Stops periodic checkpoints, runs a TRUNCATE checkpoint, optimizes, and
 * closes the connection. Never throws.
 */
export function closeMountIndexSQLiteClient(): void {
  const db = globalThis.__quilltapMountIndexDatabase;
  if (!db) {
    return;
  }

  try {
    moduleLogger.info('Closing mount index database connection');

    stopMountIndexPeriodicCheckpoints();
    runMountIndexShutdownCheckpoint(db);

    try {
      db.pragma('optimize');
    } catch {
      // Best-effort
    }

    db.close();
    moduleLogger.info('Mount index database connection closed');
  } catch (error) {
    moduleLogger.error('Error closing mount index database connection', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Never throw — shutdown must proceed
  } finally {
    globalThis.__quilltapMountIndexDatabase = undefined;
  }
}

/**
 * Get the raw mount index database instance for backup / protection access.
 *
 * @returns The database handle, or null if not initialized or degraded
 */
export function getRawMountIndexDatabase(): DatabaseType | null {
  return globalThis.__quilltapMountIndexDatabase ?? null;
}

/**
 * Check whether the mount index database is in degraded mode.
 *
 * When degraded, the repository will throw on getCollection() and all
 * safeQuery fallbacks will kick in (returning empty arrays, 0 counts, etc.).
 */
export function isMountIndexDegraded(): boolean {
  return globalThis.__quilltapMountIndexDegraded ?? false;
}
