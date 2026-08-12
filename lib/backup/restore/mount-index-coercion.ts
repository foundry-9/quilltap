/**
 * Storage-type coercion for mount-index rows read back out of a backup.
 *
 * `dumpMountIndexTable` in the backup service is a raw `SELECT *`, so the
 * archive carries SQLite storage types rather than the domain shapes the
 * repository schemas demand: JSON-text for the pattern arrays on
 * `doc_mount_points`, and INTEGER 0/1 for every boolean. Feeding those rows
 * straight to `create()` gets every one of them rejected by Zod — the archive
 * holds the stores and links, and the restore drops them on the floor.
 *
 * These helpers put the rows back into domain shape immediately before the
 * `create` calls. They are deliberately tolerant of already-correct input:
 * a JSON column is parsed only when it arrives as a string, a boolean coerced
 * only when it arrives as a number. That keeps them correct for archives
 * written by a backup path that has since learned to normalise at the source,
 * and for rows that never went through SQLite at all.
 *
 * @module backup/restore/mount-index-coercion
 */

import { logger } from '@/lib/logger';
import type { DocMountPoint, DocMountFileLink } from '@/lib/schemas/mount-index.types';

const moduleLogger = logger.child({ module: 'backup:restore:mount-index-coercion' });

/**
 * Coerce one column that should be `string[]` but may have arrived as the
 * JSON text SQLite stored. Anything unparseable — or parseable into something
 * that isn't an array of strings — falls back to the caller's default rather
 * than failing the row.
 */
function coerceStringArray(value: unknown, fallback: string[], context: string): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string' && value.length > 0) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string');
      }
    } catch {
      // Fall through to the default below.
    }
    moduleLogger.debug('Unparseable pattern column in backup row; using default', { context });
  }
  return fallback;
}

/**
 * Coerce one column that should be `boolean` but may have arrived as SQLite's
 * INTEGER 0/1. Null/undefined take the caller's default, matching the column
 * defaults in the schema.
 */
function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

/**
 * Put a backed-up `doc_mount_points` row back into domain shape: the two
 * pattern columns become `string[]`, `enabled` becomes a boolean.
 */
export function coerceDocMountPointRow<T extends Partial<DocMountPoint>>(row: T): T {
  const raw = row as Record<string, unknown>;
  return {
    ...row,
    includePatterns: coerceStringArray(
      raw.includePatterns,
      ['*.md', '*.txt', '*.pdf', '*.docx'],
      'doc_mount_points.includePatterns'
    ),
    excludePatterns: coerceStringArray(
      raw.excludePatterns,
      ['.git', 'node_modules', '.obsidian', '.trash'],
      'doc_mount_points.excludePatterns'
    ),
    enabled: coerceBoolean(raw.enabled, true),
  };
}

/**
 * Put a backed-up `doc_mount_file_links` row back into domain shape: the three
 * per-document policy flags become booleans. They default permissive, matching
 * the frontmatter default and the column defaults.
 */
export function coerceDocMountFileLinkRow<T extends Partial<DocMountFileLink>>(row: T): T {
  const raw = row as Record<string, unknown>;
  return {
    ...row,
    allowEmbed: coerceBoolean(raw.allowEmbed, true),
    allowCharacterRead: coerceBoolean(raw.allowCharacterRead, true),
    allowCharacterWrite: coerceBoolean(raw.allowCharacterWrite, true),
  };
}
