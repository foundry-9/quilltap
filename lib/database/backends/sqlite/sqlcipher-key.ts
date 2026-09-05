/**
 * SQLCipher keying — the one place `ENCRYPTION_MASTER_PEPPER` becomes a key
 * pragma.
 *
 * The pepper is a 32-byte base64 string; SQLCipher wants it as a raw hex key
 * (`x'...'`), which bypasses SQLCipher's own KDF. Every connection to an
 * encrypted Quilltap database (main, mount-index, llm-logs, the child's
 * readonly connection, ad-hoc maintenance connections) must apply this pragma
 * FIRST, before any other pragma or query touches the file.
 *
 * @module lib/database/backends/sqlite/sqlcipher-key
 */

import type { Database as DatabaseType } from 'better-sqlite3';

/**
 * Apply the SQLCipher key pragma to a freshly opened connection.
 *
 * @returns `true` when the pepper was present and the key was applied,
 *   `false` when no pepper is set (plaintext database).
 */
export function applySqlcipherKey(db: DatabaseType): boolean {
  const sqlcipherKey = process.env.ENCRYPTION_MASTER_PEPPER;
  if (!sqlcipherKey) return false;
  const keyHex = Buffer.from(sqlcipherKey, 'base64').toString('hex');
  db.pragma(`key = "x'${keyHex}'"`);
  return true;
}
