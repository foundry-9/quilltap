/**
 * SQLite error classification
 *
 * Dependency-free predicates for the driver errors that callers legitimately
 * *recover* from rather than propagate. Kept out of the repositories barrel (and
 * free of any import at all) so both the database layer and the background-job
 * write applier can use one definition.
 */

/**
 * True when `err` is a `better-sqlite3` constraint violation — either the
 * structured `code` (`SQLITE_CONSTRAINT_UNIQUE`, `SQLITE_CONSTRAINT_PRIMARYKEY`,
 * …) or the message a wrapped/re-thrown error carries.
 *
 * Recovering from one is only ever correct when the losing writer can resolve
 * the *winning* row afterwards — a find-or-create chokepoint, or the applier's
 * cross-job folder reconcile.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && /UNIQUE constraint failed/i.test(message);
}
