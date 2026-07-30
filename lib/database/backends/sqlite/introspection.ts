/**
 * Raw-handle SQLite introspection.
 *
 * `sqliteTableExists` in `migrations/lib/database-utils` answers the same
 * question, but only ever of the MAIN database — it resolves the handle itself.
 * Anything that also has to ask it of the mount-index database (or of a
 * directly-opened file) needs the handle as a parameter, which is what these
 * take.
 *
 * @module database/backends/sqlite/introspection
 */

import type { Database as DatabaseType } from 'better-sqlite3'

/** True when `name` is a table in the supplied database. */
export function tableExists(db: DatabaseType, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name) as { name: string } | undefined
  return Boolean(row)
}
