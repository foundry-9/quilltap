/**
 * LIKE-pattern escaping for user-supplied search text.
 *
 * SQLite's `LIKE` treats `%` and `_` as wildcards, so a raw user query of
 * `100%` or `a_b` would match far more than the user typed. Every substring
 * search built from user input goes through {@link likeContainsPattern},
 * which escapes those metacharacters (and the escape character itself) and
 * wraps the result in `%…%`. The matching SQL must declare the same escape
 * character: `... LIKE ? ESCAPE '\'`.
 *
 * The pattern is lower-cased so callers can compare against `LOWER(column)`
 * — SQLite's built-in `LIKE` is only case-insensitive for ASCII, and the
 * mount-index path/name lookups already normalise with `LOWER()`.
 *
 * @module database/repositories/like-escape
 */

/** The escape character declared by `ESCAPE '\'` in the accompanying SQL. */
export const LIKE_ESCAPE_CHAR = '\\';

/** Escape `%`, `_` and `\` in user text so LIKE matches it literally. */
export function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `${LIKE_ESCAPE_CHAR}${ch}`);
}

/**
 * Build a lower-cased `%contains%` LIKE pattern for a user-supplied query.
 * Pair with `WHERE LOWER(col) LIKE ? ESCAPE '\'`.
 */
export function likeContainsPattern(query: string): string {
  return `%${escapeLikeLiteral(query.toLowerCase())}%`;
}
