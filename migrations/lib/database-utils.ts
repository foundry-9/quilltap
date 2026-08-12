/**
 * Database Utilities for Migrations
 *
 * SQLite database utilities for running migrations.
 */

import { logger } from './logger';

// ============================================================================
// Backend Detection
// ============================================================================

/**
 * Detect the current database backend from environment
 */
export function detectDatabaseBackend(): 'sqlite' {
  return 'sqlite';
}

/**
 * Check if the current backend is SQLite
 */
export function isSQLiteBackend(): boolean {
  return detectDatabaseBackend() === 'sqlite';
}

// ============================================================================
// SQLite Access (for migrations)
// ============================================================================

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import { getSQLiteDatabasePath, getDataDir, getInstanceLockPath } from '../../lib/paths';
import {
  acquireInstanceLock,
  InstanceLockError,
} from '../../lib/database/backends/sqlite/instance-lock';

let sqliteDb: DatabaseType | null = null;

/**
 * Get the SQLite database path
 *
 * Uses centralized path resolution from lib/paths.ts
 */
export function getSQLitePath(): string {
  if (process.env.SQLITE_PATH) {
    return process.env.SQLITE_PATH;
  }

  return getSQLiteDatabasePath();
}

/**
 * Ensure the SQLite data directory exists
 *
 * Uses centralized path resolution from lib/paths.ts
 */
export function ensureSQLiteDataDir(): void {
  const dataDir = getDataDir();

  if (!fs.existsSync(dataDir)) {
    logger.info('Creating SQLite data directory', { path: dataDir });
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Get SQLite database instance for migrations
 *
 * Acquires the instance lock before opening, exactly as the repository-layer
 * backend does (`lib/database/backends/sqlite/backend.ts`). Migrations are the
 * heaviest writers in the codebase — they rewrite whole tables — so letting
 * them open the database while another process holds the lock is the precise
 * WAL-corruption scenario the lock exists to prevent. Acquisition is
 * re-entrant for the same PID, so the backend connecting later in startup
 * simply re-claims the lock this call already took.
 *
 * The lock is deliberately NOT released by `closeSQLite()`: in the server the
 * migration runner closes its connection and the process keeps running under
 * the same lock. Release happens through the normal shutdown handlers, and a
 * process that dies without releasing leaves a same-host lock that the next
 * acquisition reaps as stale.
 */
export function getSQLiteDatabase(): DatabaseType {
  if (sqliteDb) {
    return sqliteDb;
  }

  ensureSQLiteDataDir();

  try {
    acquireInstanceLock(getInstanceLockPath());
  } catch (lockError) {
    if (lockError instanceof InstanceLockError) {
      logger.error('Cannot run migrations: another instance holds the database lock', {
        context: 'migrations.database-utils',
        conflictPid: lockError.lockInfo.pid,
        conflictHostname: lockError.lockInfo.hostname,
        conflictStartedAt: lockError.lockInfo.startedAt,
        conflictEnvironment: lockError.lockInfo.environment,
        lockPath: lockError.lockPath,
      });
    }
    throw lockError;
  }

  const dbPath = getSQLitePath();
  const db = new Database(dbPath);

  try {
    // SQLCipher key MUST be the first pragma before any other operations.
    const sqlcipherKey = process.env.ENCRYPTION_MASTER_PEPPER;
    if (sqlcipherKey) {
      const keyHex = Buffer.from(sqlcipherKey, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
    }

    // Configure pragmas
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
  } catch (error) {
    // Close the partially-initialized connection so retries start fresh
    try { db.close(); } catch { /* ignore close errors */ }
    throw error;
  }

  sqliteDb = db;
  return sqliteDb;
}

/**
 * Close the SQLite database connection
 */
export function closeSQLite(): void {
  if (sqliteDb) {
    try {
      sqliteDb.close();
    } catch (error) {
      logger.warn('Error closing SQLite connection', {
        context: 'migrations.database-utils',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      sqliteDb = null;
    }
  }
}

/**
 * Test SQLite connection
 */
export function testSQLiteConnection(): {
  success: boolean;
  message: string;
  latencyMs?: number;
} {
  const startTime = Date.now();

  try {
    const db = getSQLiteDatabase();
    db.prepare('SELECT 1').get();

    const latencyMs = Date.now() - startTime;

    return {
      success: true,
      message: `Successfully connected to SQLite (${latencyMs}ms)`,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      message: `SQLite connection failed: ${errorMessage}`,
      latencyMs,
    };
  }
}

// ============================================================================
// Backend-Agnostic Operations
// ============================================================================

/**
 * Close all database connections
 */
export async function closeDatabase(): Promise<void> {
  // Only SQLite is supported
  closeSQLite();
}

/**
 * Wait for the database to be ready
 */
export async function waitForDatabaseReady(
  maxRetries: number = 10,
  retryDelayMs: number = 1000
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const db = getSQLiteDatabase();
      db.prepare('SELECT 1').get();
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`sqlite connection attempt ${attempt}/${maxRetries} failed`, {
        context: 'migrations.database-utils',
        attempt,
        maxRetries,
        error: errorMessage,
      });
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  logger.error('sqlite not accessible after retries', {
    context: 'migrations.database-utils',
    maxRetries,
  });
  return false;
}

// ============================================================================
// SQLite Table Operations (for migrations)
// ============================================================================

/**
 * Check if a table exists in SQLite
 */
export function sqliteTableExists(tableName: string): boolean {
  assertSQLiteBackend('sqliteTableExists');

  const db = getSQLiteDatabase();
  const result = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName) as { name: string } | undefined;

  return !!result;
}

/**
 * Get column info for a SQLite table
 */
export function getSQLiteTableColumns(tableName: string): Array<{
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: unknown;
  pk: boolean;
}> {
  assertSQLiteBackend('getSQLiteTableColumns');

  const db = getSQLiteDatabase();
  return db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{
    name: string;
    type: string;
    notnull: boolean;
    dflt_value: unknown;
    pk: boolean;
  }>;
}

/**
 * Execute a SQL statement on SQLite
 */
export function executeSQLite(sql: string, params: unknown[] = []): void {
  assertSQLiteBackend('executeSQLite');

  const db = getSQLiteDatabase();
  db.prepare(sql).run(...params);
}

/**
 * Query SQLite and return results
 */
export function querySQLite<T = unknown>(sql: string, params: unknown[] = []): T[] {
  assertSQLiteBackend('querySQLite');

  const db = getSQLiteDatabase();
  return db.prepare(sql).all(...params) as T[];
}

function assertSQLiteBackend(caller: string): void {
  if (!isSQLiteBackend()) {
    throw new Error(`${caller} can only be called with SQLite backend`);
  }
}
