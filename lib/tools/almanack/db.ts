/**
 * The Almanack — database access helpers.
 *
 * The report is a census, and a census is a pile of GROUP BY. Hydrating whole
 * entities through Zod just to count them is what made the old collector slow
 * (one `findByCharacterId(...).length` per character, among others), so the
 * collectors here read aggregates straight out of SQLite.
 *
 * Three databases are in play and each has its own door:
 *   - main (`quilltap.db`)               → `manager.rawQuery`
 *   - mount index (`quilltap-mount-index.db`) → `getRawMountIndexDatabase()`
 *   - llm logs (`quilltap-llm-logs.db`)  → the repository's aggregate methods
 *
 * Every helper here is *soft*: a failure returns the caller's fallback and logs
 * a warning. A diagnostic report that refuses to render because one of its own
 * queries threw is worse than useless — the section that matters is usually the
 * one next to the broken one.
 *
 * @module lib/tools/almanack/db
 */

import { logger } from '@/lib/logger';
import { rawQuery } from '@/lib/database/manager';
import {
  getRawMountIndexDatabase,
  isMountIndexDegraded,
} from '@/lib/database/backends/sqlite/mount-index-client';
import { getErrorMessage } from '@/lib/error-utils';

const moduleLogger = logger.child({ module: 'almanack:db' });

/** Run a SELECT against the MAIN database, returning `fallback` on any failure. */
export async function mainRows<R>(
  sql: string,
  params: unknown[] = [],
  context = 'main query',
  fallback: R[] = [],
): Promise<R[]> {
  try {
    const rows = await rawQuery<R[]>(sql, params);
    return Array.isArray(rows) ? rows : fallback;
  } catch (error) {
    moduleLogger.warn('Almanack main-DB query failed', { context, error: getErrorMessage(error) });
    return fallback;
  }
}

/** Run a SELECT against the MAIN database and return the first row (or null). */
export async function mainRow<R>(
  sql: string,
  params: unknown[] = [],
  context = 'main query',
): Promise<R | null> {
  const rows = await mainRows<R>(sql, params, context);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Run a SELECT against the MOUNT INDEX database.
 *
 * Note this is deliberately NOT `manager.rawQuery` — that addresses the main
 * DB, and pointing a `doc_mount_*` query at it silently returns nothing.
 */
export function mountRows<R>(
  sql: string,
  params: unknown[] = [],
  context = 'mount-index query',
  fallback: R[] = [],
): R[] {
  if (isMountIndexDegraded()) {
    return fallback;
  }
  const db = getRawMountIndexDatabase();
  if (!db) {
    return fallback;
  }
  try {
    return db.prepare(sql).all(...(params as never[])) as R[];
  } catch (error) {
    moduleLogger.warn('Almanack mount-index query failed', {
      context,
      error: getErrorMessage(error),
    });
    return fallback;
  }
}

/** Run a SELECT against the mount index and return the first row (or null). */
export function mountRow<R>(
  sql: string,
  params: unknown[] = [],
  context = 'mount-index query',
): R | null {
  const rows = mountRows<R>(sql, params, context);
  return rows.length > 0 ? rows[0] : null;
}

/** Is the mount index reachable at all? Sections say so rather than showing zeroes. */
export function isMountIndexAvailable(): boolean {
  return !isMountIndexDegraded() && getRawMountIndexDatabase() !== null;
}

/**
 * Run a collector, logging and swallowing any failure.
 *
 * Collectors run inside `Promise.all` batches; one throwing would take its
 * whole phase down with it. Each is wrapped so a single broken section
 * degrades to its fallback shape and the rest of the volume still binds.
 */
export async function collect<T>(
  name: string,
  fallback: T,
  fn: () => Promise<T> | T,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    moduleLogger.debug('Almanack collector finished', {
      collector: name,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    moduleLogger.warn('Almanack collector failed; using fallback', {
      collector: name,
      error: getErrorMessage(error),
    });
    return fallback;
  }
}

/** Coerce a SQLite aggregate (which may arrive as null/undefined/string) to a number. */
export function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
