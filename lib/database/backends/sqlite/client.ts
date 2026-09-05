/**
 * SQLite Client Module
 *
 * Provides a singleton better-sqlite3 database connection with
 * proper configuration for WAL mode, foreign keys, and other pragmas.
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import { SQLiteConfig } from '../../config';
import { logger } from '@/lib/logger';
import { applySqlcipherKey } from './sqlcipher-key';
import { stopPeriodicCheckpoints, runShutdownCheckpoint } from './protection';
import { closeLLMLogsSQLiteClient } from './llm-logs-client';
import { closeMountIndexSQLiteClient } from './mount-index-client';
import { releaseActiveInstanceLock } from './instance-lock';

// ============================================================================
// Singleton State
// ============================================================================

// HMR- and dual-bundle-safe singleton state. Module-local `let`s lose their
// values when Turbopack/HMR reloads this file — and worse, when the same
// source compiles into more than one server bundle (e.g. instrumentation
// vs. API routes vs. the background-job dispatcher chunk), each bundle
// gets its own module-locals. The dispatcher's `getRawDatabase()` call site
// would then see `null` even though another bundle's instance had opened
// the connection. Stashing on `globalThis` keeps a single shared handle
// across reloads and bundles, matching the pattern in
// `llm-logs-client.ts`, `mount-index-client.ts`, and `manager.ts`.
declare global {
  var __quilltapMainDatabase: DatabaseType | undefined;
  var __quilltapMainDatabaseInitialized: boolean | undefined;
  var __quilltapMainDatabaseShutdownHandlersRegistered: boolean | undefined;
}

function getDb(): DatabaseType | null {
  return globalThis.__quilltapMainDatabase ?? null;
}
function setDb(db: DatabaseType | null): void {
  globalThis.__quilltapMainDatabase = db ?? undefined;
}
function getInitFlag(): boolean {
  return globalThis.__quilltapMainDatabaseInitialized ?? false;
}
function setInitFlag(v: boolean): void {
  globalThis.__quilltapMainDatabaseInitialized = v;
}

// ============================================================================
// Client Management
// ============================================================================

/**
 * Initialize and return the SQLite database connection
 *
 * Inside the forked job-runner child (`QUILLTAP_JOB_CHILD === '1'`) this
 * delegates to `getReadonlyChildSQLiteClient`, which opens the same
 * SQLCipher database in readonly mode and skips WAL/journal/instance-lock
 * configuration. The child reads freely; all writes are batched and shipped
 * back to the parent via IPC for the parent to apply on its RW connection.
 */
export function getSQLiteClient(config: SQLiteConfig): DatabaseType {
  const existing = getDb();
  if (existing && getInitFlag()) {
    return existing;
  }

  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    // Lazy require to keep this import out of the parent's startup graph.
    const { getReadonlyChildSQLiteClient } = require('./child-client') as
      typeof import('./child-client');
    const child = getReadonlyChildSQLiteClient(config);
    setDb(child);
    setInitFlag(true);
    return child;
  }

  logger.info('Initializing SQLite database connection', {
    path: config.path,
    walMode: config.walMode,
  });

  try {
    // Create or open the database
    const db = new Database(config.path, {
      // verbose: process.env.NODE_ENV === 'development' ? console.log : undefined,
    });

    // SQLCipher key MUST be the first pragma before any other operations.
    applySqlcipherKey(db);

    // Configure pragmas
    configurePragmas(db, config);

    setDb(db);
    setInitFlag(true);

    logger.info('SQLite database connection established', {
      path: config.path,
    });

    return db;
  } catch (error) {
    logger.error('Failed to initialize SQLite database', {
      path: config.path,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Configure SQLite pragmas for optimal performance
 */
function configurePragmas(db: DatabaseType, config: SQLiteConfig): void {
  // Enable foreign key constraints
  if (config.foreignKeys) {
    db.pragma('foreign_keys = ON');
  }

  // Set journal mode. Defaults to a single-file mode (truncate) for safety
  // on cloud-synced data directories; WAL is opt-in via SQLITE_WAL_MODE=true.
  // SQLite automatically checkpoints any pre-existing WAL into the main
  // database file when transitioning out of WAL mode, so this is safe to
  // apply unconditionally to existing databases on upgrade.
  if (config.walMode) {
    db.pragma('journal_mode = WAL');
  } else {
    db.pragma(`journal_mode = ${config.journalMode}`);
  }

  // Set synchronous mode
  db.pragma(`synchronous = ${config.synchronous}`);

  // Set busy timeout
  db.pragma(`busy_timeout = ${config.busyTimeout}`);

  // Set cache size
  db.pragma(`cache_size = ${config.cacheSize}`);

  // Enable memory-mapped I/O for better performance (256MB)
  db.pragma('mmap_size = 268435456');

  // Optimize temp store
  db.pragma('temp_store = MEMORY');
}

/**
 * Close the SQLite database connection
 *
 * Stops periodic checkpoints, runs a TRUNCATE checkpoint to fully merge
 * the WAL into the main database file, then optimizes and closes.
 */
export function closeSQLiteClient(): void {
  const db = getDb();
  if (db) {
    try {
      logger.info('Closing SQLite database connection');

      // Stop periodic checkpoints first
      stopPeriodicCheckpoints();

      // Run a TRUNCATE checkpoint to merge WAL into main DB
      runShutdownCheckpoint(db);

      // Optimize before closing
      db.pragma('optimize');

      db.close();
      setDb(null);
      setInitFlag(false);

      logger.info('SQLite database connection closed');
    } catch (error) {
      logger.error('Error closing SQLite connection', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

/**
 * Check if the database is connected and healthy
 */
export function isSQLiteConnected(): boolean {
  const db = getDb();
  if (!db || !getInitFlag()) {
    return false;
  }

  try {
    // Simple query to verify connection
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a checkpoint on the WAL file
 */
export function runCheckpoint(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'PASSIVE'): void {
  const db = getDb();
  if (!db || !getInitFlag()) {
    return;
  }

  try {
    db.pragma(`wal_checkpoint(${mode})`);
  } catch (error) {
    logger.error('Error running WAL checkpoint', {
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get database statistics
 */
export function getDatabaseStats(): { pageCount: number; pageSize: number; freelist: number } | null {
  const db = getDb();
  if (!db || !getInitFlag()) {
    return null;
  }

  try {
    const pageCount = db.pragma('page_count', { simple: true }) as number;
    const pageSize = db.pragma('page_size', { simple: true }) as number;
    const freelist = db.pragma('freelist_count', { simple: true }) as number;

    return { pageCount, pageSize, freelist };
  } catch {
    return null;
  }
}

/**
 * Vacuum the database to reclaim space
 */
export function vacuumDatabase(): void {
  const db = getDb();
  if (!db || !getInitFlag()) {
    return;
  }

  try {
    logger.info('Running VACUUM on SQLite database');
    db.exec('VACUUM');
    logger.info('VACUUM completed');
  } catch (error) {
    logger.error('Error running VACUUM', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Setup shutdown handlers for graceful cleanup
 */
export function setupSQLiteShutdownHandlers(): void {
  // The forked job-runner child has its own shutdown protocol via IPC; it
  // must not register process-level signal handlers that would race with the
  // parent's lifecycle.
  if (process.env.QUILLTAP_JOB_CHILD === '1') return;

  // Prevent adding listeners multiple times (important for hot reloading)
  if (globalThis.__quilltapMainDatabaseShutdownHandlersRegistered) {
    return;
  }
  globalThis.__quilltapMainDatabaseShutdownHandlersRegistered = true;

  const handleShutdown = () => {
    closeMountIndexSQLiteClient();
    closeLLMLogsSQLiteClient();
    closeSQLiteClient();
    releaseActiveInstanceLock();
  };

  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);

  process.on('uncaughtException', (error) => {
    if (isRecoverableContentParseError(error)) {
      logger.warn('Uncaught content-parse error (recovered, server kept alive)', {
        error: error.message,
        stack: (error as Error).stack,
      });
      return;
    }
    logger.error('Uncaught exception, closing SQLite connection', {
      error: error.message,
      stack: error.stack,
    });
    closeSQLiteClient();
    releaseActiveInstanceLock();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    // Transient network errors from outbound fetch() calls (LLM providers,
    // image APIs, etc.) can surface here if a stream body consumer doesn't
    // catch them. These are recoverable — log and continue rather than
    // taking the whole server down over a Cloudflare socket hiccup.
    if (isRecoverableNetworkRejection(reason)) {
      logger.warn('Unhandled network rejection (recovered, server kept alive)', {
        reason: reason instanceof Error ? reason.message : String(reason),
        code: (reason as NodeJS.ErrnoException | undefined)?.code,
        cause: reason instanceof Error && reason.cause
          ? (reason.cause instanceof Error ? reason.cause.message : String(reason.cause))
          : undefined,
      });
      return;
    }

    // SyntaxError from JSON.parse on transient/malformed network content
    // (e.g. an LLM provider returning an empty or truncated streaming chunk)
    // is recoverable in the same way — the offending request fails, but the
    // server should keep running long enough for the next one to succeed.
    if (isRecoverableContentParseError(reason)) {
      const err = reason as SyntaxError;
      logger.warn('Unhandled content-parse rejection (recovered, server kept alive)', {
        reason: err.message,
        stack: err.stack,
      });
      return;
    }

    logger.error('Unhandled rejection, closing SQLite connection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    closeSQLiteClient();
    releaseActiveInstanceLock();
    process.exit(1);
  });
}

const RECOVERABLE_NETWORK_CODES = new Set([
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_ABORTED',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH',
  'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function isRecoverableNetworkRejection(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;

  const code = (reason as NodeJS.ErrnoException).code;
  if (code && RECOVERABLE_NETWORK_CODES.has(code)) return true;

  const cause = (reason as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const causeCode = (cause as NodeJS.ErrnoException).code;
    if (causeCode && RECOVERABLE_NETWORK_CODES.has(causeCode)) return true;
  }

  // Undici throws `TypeError: terminated` when a streaming fetch body is
  // cut off mid-flight. The error itself has no `code`, but its `cause`
  // is usually a SocketError with UND_ERR_SOCKET (handled above). Match
  // the bare message as a fallback for older undici versions.
  if (reason.name === 'TypeError' && reason.message === 'terminated') {
    return true;
  }

  return false;
}

/**
 * `JSON.parse` on a truncated/empty network response throws a `SyntaxError`
 * that often surfaces here when an LLM provider hangs up mid-stream and the
 * SDK's stream iterator is processing chunks from a fire-and-forget context
 * (cleanup callbacks, abort handlers, log writers). These should fail the
 * specific request, not the whole server. Anchored on `JSON.parse` in the
 * stack so it stays narrow — a real source-level SyntaxError won't match.
 */
function isRecoverableContentParseError(reason: unknown): boolean {
  return (
    reason instanceof SyntaxError &&
    typeof reason.stack === 'string' &&
    reason.stack.includes('JSON.parse')
  );
}

// ============================================================================
// Raw Database Access
// ============================================================================

/**
 * Get the raw better-sqlite3 database instance.
 *
 * Returns the singleton database handle, or null if not initialized.
 * Intended for use by protection and backup modules that need direct
 * database access (e.g., for PRAGMA calls or .backup()).
 */
export function getRawDatabase(): DatabaseType | null {
  const db = getDb();
  return db && getInitFlag() ? db : null;
}

// ============================================================================
// Transaction Support
// ============================================================================

/**
 * Execute a function within a transaction
 */
export function withTransaction<T>(fn: () => T): T {
  const db = getDb();
  if (!db || !getInitFlag()) {
    throw new Error('SQLite database not initialized');
  }

  const transaction = db.transaction(fn);
  return transaction();
}

/**
 * Execute a function within an immediate transaction (write lock)
 */
export function withImmediateTransaction<T>(fn: () => T): T {
  const db = getDb();
  if (!db || !getInitFlag()) {
    throw new Error('SQLite database not initialized');
  }

  const transaction = db.transaction(fn);
  return transaction.immediate();
}

/**
 * Execute a function within an exclusive transaction (full lock)
 */
export function withExclusiveTransaction<T>(fn: () => T): T {
  const db = getDb();
  if (!db || !getInitFlag()) {
    throw new Error('SQLite database not initialized');
  }

  const transaction = db.transaction(fn);
  return transaction.exclusive();
}
