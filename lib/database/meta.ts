/**
 * SQLite Meta Table Module
 *
 * Manages the quilltap_meta table in SQLite for storing system-level
 * settings like the preferred database backend. This module uses
 * better-sqlite3 directly and is independent of the main database
 * abstraction layer since it needs to be checked BEFORE deciding
 * which backend to use.
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import { getDefaultSQLitePath, ensureDataDirectoryExists, DatabaseBackendType } from './config';
import { applySqlcipherKey } from './backends/sqlite/sqlcipher-key';
import { logger } from '@/lib/logger';
import path from 'path';

// ============================================================================
// Constants
// ============================================================================

const META_TABLE_NAME = 'quilltap_meta';

// Well-known meta keys
export const META_KEYS = {
  PREFERRED_BACKEND: 'preferred_backend',
  LAST_MIGRATION: 'last_migration',
  MIGRATION_TIMESTAMP: 'migration_timestamp',
} as const;

// ============================================================================
// Meta Table Management
// ============================================================================

/**
 * Get a separate SQLite connection for meta table operations.
 * This creates a minimal connection just for reading/writing meta values.
 */
function getMetaConnection(): DatabaseType | null {
  try {
    const dbPath = process.env.SQLITE_PATH || getDefaultSQLitePath();
    const dbDir = path.dirname(dbPath);

    // Ensure the data directory exists
    ensureDataDirectoryExists(dbDir);

    // Open/create the database
    const db = new Database(dbPath);

    // SQLCipher key MUST be the first pragma before any other operations.
    applySqlcipherKey(db);

    // Basic pragmas for safety. Use TRUNCATE journal mode (single file)
    // rather than WAL to stay safe on cloud-synced data directories.
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = TRUNCATE');

    return db;
  } catch (error) {
    logger.error('Failed to open meta connection', {
      context: 'database.meta',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Ensure the meta table exists in the SQLite database.
 * Creates it if it doesn't exist.
 */
export function ensureMetaTable(db?: DatabaseType): boolean {
  const connection = db || getMetaConnection();
  if (!connection) {
    return false;
  }

  try {
    connection.exec(`
      CREATE TABLE IF NOT EXISTS ${META_TABLE_NAME} (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    if (!db) {
      connection.close();
    }

    return true;
  } catch (error) {
    logger.error('Failed to ensure meta table', {
      context: 'database.meta',
      error: error instanceof Error ? error.message : String(error),
    });

    if (!db) {
      try {
        connection.close();
      } catch {
        // Ignore close errors
      }
    }

    return false;
  }
}

/**
 * Get a value from the meta table
 */
export function getMetaValue(key: string): string | null {
  const connection = getMetaConnection();
  if (!connection) {
    return null;
  }

  try {
    // Ensure table exists first
    ensureMetaTable(connection);

    const stmt = connection.prepare(`SELECT value FROM ${META_TABLE_NAME} WHERE key = ?`);
    const row = stmt.get(key) as { value: string } | undefined;

    connection.close();

    return row?.value ?? null;
  } catch (error) {
    logger.error('Failed to get meta value', {
      context: 'database.meta',
      key,
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      connection.close();
    } catch {
      // Ignore close errors
    }

    return null;
  }
}

/**
 * Set a value in the meta table
 */
export function setMetaValue(key: string, value: string | null): boolean {
  const connection = getMetaConnection();
  if (!connection) {
    return false;
  }

  try {
    // Ensure table exists first
    ensureMetaTable(connection);

    if (value === null) {
      // Delete the key
      const stmt = connection.prepare(`DELETE FROM ${META_TABLE_NAME} WHERE key = ?`);
      stmt.run(key);
    } else {
      // Upsert the value
      const stmt = connection.prepare(`
        INSERT INTO ${META_TABLE_NAME} (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = datetime('now')
      `);
      stmt.run(key, value);
    }
    connection.close();

    return true;
  } catch (error) {
    logger.error('Failed to set meta value', {
      context: 'database.meta',
      key,
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      connection.close();
    } catch {
      // Ignore close errors
    }

    return false;
  }
}

/**
 * Delete a value from the meta table
 */
export function deleteMetaValue(key: string): boolean {
  return setMetaValue(key, null);
}

// ============================================================================
// Backend Preference
// ============================================================================

/**
 * Get the preferred database backend from the meta table.
 * Since MongoDB support has been removed, this always returns null or 'sqlite'.
 */
export function getPreferredBackend(): DatabaseBackendType | null {
  // Always return sqlite as MongoDB support has been removed
  return null;
}

/**
 * Set the preferred database backend in the meta table.
 */
export function setPreferredBackend(backend: DatabaseBackendType): boolean {
  logger.info('Setting preferred backend in meta table', {
    context: 'database.meta',
    backend,
  });

  return setMetaValue(META_KEYS.PREFERRED_BACKEND, backend);
}

/**
 * Clear the preferred backend (revert to auto-detection)
 */
export function clearPreferredBackend(): boolean {
  logger.info('Clearing preferred backend from meta table', {
    context: 'database.meta',
  });

  return deleteMetaValue(META_KEYS.PREFERRED_BACKEND);
}

// ============================================================================
// Migration Tracking
// ============================================================================

/**
 * Record that a migration was completed
 */
export function recordMigration(direction: 'mongo-to-sqlite'): boolean {
  const timestamp = new Date().toISOString();

  const success1 = setMetaValue(META_KEYS.LAST_MIGRATION, direction);
  const success2 = setMetaValue(META_KEYS.MIGRATION_TIMESTAMP, timestamp);

  return success1 && success2;
}

/**
 * Get information about the last migration
 */
export function getLastMigration(): { direction: string; timestamp: string } | null {
  const direction = getMetaValue(META_KEYS.LAST_MIGRATION);
  const timestamp = getMetaValue(META_KEYS.MIGRATION_TIMESTAMP);

  if (direction && timestamp) {
    return { direction, timestamp };
  }

  return null;
}

// ============================================================================
// Utility
// ============================================================================

/**
 * Check if the SQLite database file exists
 */
export function sqliteDatabaseExists(): boolean {
  const fs = require('fs');
  const dbPath = process.env.SQLITE_PATH || getDefaultSQLitePath();

  return fs.existsSync(dbPath);
}

/**
 * Get all meta values (for debugging/admin)
 */
export function getAllMetaValues(): Record<string, string> {
  const connection = getMetaConnection();
  if (!connection) {
    return {};
  }

  try {
    ensureMetaTable(connection);

    const stmt = connection.prepare(`SELECT key, value FROM ${META_TABLE_NAME}`);
    const rows = stmt.all() as { key: string; value: string }[];

    connection.close();

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }

    return result;
  } catch (error) {
    logger.error('Failed to get all meta values', {
      context: 'database.meta',
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      connection.close();
    } catch {
      // Ignore close errors
    }

    return {};
  }
}
