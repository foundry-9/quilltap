/**
 * Shared guard for repositories backed by the mount index database.
 *
 * Refuses to hand out a connection while the mount index is degraded, and
 * refuses when it has not been initialized at all. Every mount-index
 * repository's `getCollection()` opens with exactly this check.
 *
 * @module lib/database/backends/sqlite/mount-index-guard
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { getRawMountIndexDatabase, isMountIndexDegraded } from './mount-index-client';

/**
 * Return the raw mount index database, or throw when it is degraded or not
 * initialized.
 */
export function requireMountIndexDb(): DatabaseType {
  if (isMountIndexDegraded()) {
    throw new Error('Mount index database is in degraded mode');
  }

  const db = getRawMountIndexDatabase();
  if (!db) {
    throw new Error('Mount index database not initialized');
  }

  return db;
}
