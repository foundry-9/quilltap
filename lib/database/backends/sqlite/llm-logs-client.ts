/**
 * LLM Logs SQLite Client Module
 *
 * Provides a dedicated singleton better-sqlite3 database connection for
 * the LLM logs database (quilltap-llm-logs.db). This isolates high-churn
 * debug data from the main database so corruption in the logs DB can
 * never threaten characters, chats, messages, or memories.
 *
 * Features:
 * - Separate WAL + busy_timeout + cache + mmap configuration
 * - Graceful degradation: if the DB fails to open, the app continues
 *   with logging silently disabled (all safeQuery fallbacks handle this)
 * - globalThis persistence to survive Next.js HMR
 *
 * @module lib/database/backends/sqlite/llm-logs-client
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import { SQLiteConfig } from '../../config';
import { logger } from '@/lib/logger';
import { applySqlcipherKey } from './sqlcipher-key';
import { stopLLMLogsPeriodicCheckpoints, runLLMLogsShutdownCheckpoint } from './llm-logs-protection';

const moduleLogger = logger.child({ module: 'database:llm-logs-client' });

// ============================================================================
// HMR-Safe Global State
// ============================================================================

declare global {
  var __quilltapLLMLogsDatabase: DatabaseType | undefined;
  var __quilltapLLMLogsDegraded: boolean | undefined;
}

// ============================================================================
// Client Management
// ============================================================================

/**
 * Initialize and return the LLM logs database connection.
 *
 * Uses the same pragma set as the main DB except foreign keys are disabled
 * (the logs DB has no inter-table relationships).
 *
 * @param config - SQLite config (path should point to quilltap-llm-logs.db)
 * @returns The database instance, or null if opening failed (degraded mode)
 */
export function getLLMLogsSQLiteClient(config: SQLiteConfig): DatabaseType | null {
  if (globalThis.__quilltapLLMLogsDatabase) {
    return globalThis.__quilltapLLMLogsDatabase;
  }

  moduleLogger.info('Initializing LLM logs database connection', {
    path: config.path,
    walMode: config.walMode,
  });

  try {
    const db = new Database(config.path);

    // SQLCipher key MUST be the first pragma before any other operations.
    if (applySqlcipherKey(db)) {
      moduleLogger.debug('SQLCipher key set on LLM logs database');
    }

    // Configure pragmas (no foreign keys for the logs DB).
    // Journal mode defaults to a single-file mode (truncate) for safety on
    // cloud-synced data directories; WAL is opt-in via SQLITE_WAL_MODE=true.
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

    globalThis.__quilltapLLMLogsDatabase = db;
    globalThis.__quilltapLLMLogsDegraded = false;

    moduleLogger.info('LLM logs database connection established', {
      path: config.path,
    });

    return db;
  } catch (error) {
    moduleLogger.error('Failed to initialize LLM logs database — entering degraded mode', {
      path: config.path,
      error: error instanceof Error ? error.message : String(error),
    });
    globalThis.__quilltapLLMLogsDegraded = true;
    return null;
  }
}

/**
 * Close the LLM logs database connection.
 *
 * Stops periodic checkpoints, runs a TRUNCATE checkpoint, optimizes, and
 * closes the connection. Never throws.
 */
export function closeLLMLogsSQLiteClient(): void {
  const db = globalThis.__quilltapLLMLogsDatabase;
  if (!db) {
    return;
  }

  try {
    moduleLogger.info('Closing LLM logs database connection');

    stopLLMLogsPeriodicCheckpoints();
    runLLMLogsShutdownCheckpoint(db);

    try {
      db.pragma('optimize');
    } catch {
      // Best-effort
    }

    db.close();
    moduleLogger.info('LLM logs database connection closed');
  } catch (error) {
    moduleLogger.error('Error closing LLM logs database connection', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Never throw — shutdown must proceed
  } finally {
    globalThis.__quilltapLLMLogsDatabase = undefined;
  }
}

/**
 * Get the raw LLM logs database instance for backup / protection access.
 *
 * @returns The database handle, or null if not initialized or degraded
 */
export function getRawLLMLogsDatabase(): DatabaseType | null {
  return globalThis.__quilltapLLMLogsDatabase ?? null;
}

/**
 * Check whether the LLM logs database is in degraded mode.
 *
 * When degraded, the repository will throw on getCollection() and all
 * safeQuery fallbacks will kick in (returning empty arrays, 0 counts, etc.).
 */
export function isLLMLogsDegraded(): boolean {
  return globalThis.__quilltapLLMLogsDegraded ?? false;
}
