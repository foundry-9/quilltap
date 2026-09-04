/**
 * Raw-handle SQLite introspection.
 *
 * `sqliteTableExists` in `migrations/lib/database-utils` answers the same
 * question, but only ever of the MAIN database — it resolves the handle itself.
 * Anything that also has to ask it of the mount-index database (or of a
 * directly-opened file) needs the handle as a parameter, which is what these
 * take.
 *
 * The handle is typed structurally rather than as better-sqlite3's `Database`
 * so the repositories' minimal `SyncDb` / `RawDb` views (and a test double)
 * qualify without a cast.
 *
 * @module database/backends/sqlite/introspection
 */

/** The one method table-existence needs of a synchronous SQLite handle. */
export interface IntrospectableDb {
  prepare(sql: string): { get(...params: unknown[]): unknown }
}

/** True when `name` is a table in the supplied database. */
export function tableExists(db: IntrospectableDb, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name) as { name: string } | undefined
  return Boolean(row)
}
