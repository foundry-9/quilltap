/**
 * Which library files never travel in a `.qtap` export.
 *
 * One predicate, three call sites — the writer's `files` streamer, the
 * "everything of this type" id resolver, and the export wizard's entity picker.
 * The rule used to be spelled out at each of them, which is how `ARCHIVE` came
 * to be excluded nowhere after it was added.
 *
 * Two categories are excluded, for the same reason: both are themselves
 * archives of the instance, and nesting them inside a fresh export bloats it
 * enormously (base64-inflated) while adding nothing a restore could use.
 *
 * - **BACKUP** — mirrors the backup service's own rule. Nobody wants last
 *   month's backup riding inside this month's.
 * - **ARCHIVE** — a character archive bundle is a `.qtap` in its own right. It
 *   is reachable through `characters.archiveFileId`, and it survives a wipe
 *   only by the operator's explicit "keep archived characters" choice; an
 *   export is not the place to smuggle copies of it.
 */

import type { FileEntry } from '@/lib/schemas/file.types';

/** Categories whose files are never written into an export. */
export const EXPORT_EXCLUDED_FILE_CATEGORIES = ['BACKUP', 'ARCHIVE'] as const;

/** Folder paths whose files are never written into an export. */
export const EXPORT_EXCLUDED_FOLDER_PATHS = ['/backups', '/archives'] as const;

export function isFileExcludedFromExport(
  file: Pick<FileEntry, 'category' | 'folderPath'>
): boolean {
  return (
    EXPORT_EXCLUDED_FILE_CATEGORIES.includes(
      file.category as (typeof EXPORT_EXCLUDED_FILE_CATEGORIES)[number]
    ) ||
    EXPORT_EXCLUDED_FOLDER_PATHS.includes(
      (file.folderPath ?? '') as (typeof EXPORT_EXCLUDED_FOLDER_PATHS)[number]
    )
  );
}
