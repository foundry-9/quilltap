/**
 * Readonly SQLite Client for the forked job-runner child
 *
 * The background-jobs child process opens its own SQLCipher connection in
 * `readonly: true` mode. The parent process is the only writer; the child
 * reads freely without contending for the WAL/lock and ships write payloads
 * back via IPC for the parent to apply in a single transaction.
 *
 * Differences from the parent client (`./client.ts`):
 *   - opened with `{ readonly: true }`
 *   - skips journal-mode and WAL pragmas (read-only sessions don't write the
 *     journal anyway, and changing the journal mode requires a write lock)
 *   - does not start the instance-lock heartbeat or shutdown handlers
 *     (`acquireInstanceLock` / `setupSQLiteShutdownHandlers` are guarded by
 *     `QUILLTAP_JOB_CHILD === '1'` and become no-ops in this process)
 *   - takes the SQLCipher key from `ENCRYPTION_MASTER_PEPPER`, which the
 *     parent writes into env before forking
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import { SQLiteConfig } from '../../config';
import { logger } from '@/lib/logger';
import { applySqlcipherKey } from './sqlcipher-key';

let readonlyDatabase: DatabaseType | null = null;

const log = logger.child({ module: 'database:child-client' });

export function getReadonlyChildSQLiteClient(config: SQLiteConfig): DatabaseType {
  if (readonlyDatabase) return readonlyDatabase;

  if (!process.env.ENCRYPTION_MASTER_PEPPER) {
    throw new Error(
      'Child SQLCipher client cannot open readonly connection: ' +
      'ENCRYPTION_MASTER_PEPPER is not set in the child process environment.'
    );
  }

  log.info('Opening readonly SQLCipher connection in job-runner child', {
    path: config.path,
  });

  const db = new Database(config.path, { readonly: true });

  // The pepper is guaranteed present by the guard above.
  applySqlcipherKey(db);

  if (config.foreignKeys) {
    db.pragma('foreign_keys = ON');
  }
  db.pragma(`busy_timeout = ${config.busyTimeout}`);
  db.pragma(`cache_size = ${config.cacheSize}`);
  db.pragma('mmap_size = 268435456');
  db.pragma('temp_store = MEMORY');

  readonlyDatabase = db;
  return readonlyDatabase;
}

export function closeReadonlyChildSQLiteClient(): void {
  if (readonlyDatabase) {
    try {
      readonlyDatabase.close();
    } catch (error) {
      log.warn('Error closing readonly child SQLite connection', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    readonlyDatabase = null;
  }
}

export function isReadonlyChildSQLiteConnected(): boolean {
  if (!readonlyDatabase) return false;
  try {
    readonlyDatabase.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}
