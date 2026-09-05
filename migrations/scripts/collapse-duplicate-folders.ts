/**
 * Migration: Collapse Duplicate Folder Rows
 *
 * The legacy `folders` table (the pre-Scriptorium file-tree UI) had no
 * uniqueness constraint on a folder's identity, and every writer hand-rolled
 * its own `findByPath` -> `create` guard. Those guards are neither atomic (two
 * concurrent image jobs both read "absent" and both insert) nor able to fail
 * loudly (`findByPath` swallows read errors and returns null), so the
 * machine-written paths — `/character-avatars/` and `/story-backgrounds/`,
 * driven by the avatar and Lantern pipelines — accumulated one row per
 * generated image. Hand-created folders, written once by a human through the
 * API, never duplicated. See bug 114.
 *
 * This migration runs in three steps:
 *   1. Group rows by (userId, COALESCE(projectId, ''), path). The oldest row in
 *      each group survives; the rest are discarded.
 *   2. Repoint every `folders.parentFolderId` that named a discarded row at its
 *      group's survivor, then delete the discarded rows. `folders.parentFolderId`
 *      is the only column in the main database that references `folders.id` —
 *      `files` locates its folder by `folderPath` + `projectId`, not by id.
 *   3. Create the UNIQUE INDEX that keeps it from happening again, matching the
 *      one `sqlite-initial-schema` now creates for fresh instances.
 *
 * Migration ID: collapse-duplicate-folders-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

const MIGRATION_ID = 'collapse-duplicate-folders-v1';
const INDEX_NAME = 'idx_folders_userId_projectId_path';

interface FolderRow {
  id: string;
  userId: string;
  projectId: string | null;
  path: string;
  parentFolderId: string | null;
}

function indexExists(): boolean {
  const db = getSQLiteDatabase();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(INDEX_NAME);
  return !!row;
}

/**
 * Collapse Duplicate Folder Rows Migration
 */
export const collapseDuplicateFoldersMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Collapse duplicate folder rows to one per (userId, projectId, path) and add the unique index',
  introducedInVersion: '4.9.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('folders')) {
      return false;
    }

    return !indexExists();
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // 1. Decide a survivor per identity group. Oldest row wins; id breaks
      //    ties so the choice is deterministic across re-runs.
      const folders = db
        .prepare(
          'SELECT id, userId, projectId, path, parentFolderId FROM folders ' +
            'ORDER BY createdAt ASC, id ASC'
        )
        .all() as FolderRow[];

      const survivorByGroup = new Map<string, string>();
      // Discarded folder id -> the survivor it should be replaced with.
      const supersededBy = new Map<string, string>();

      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        // NUL as the separator (escaped, never a raw byte in source): it cannot
        // appear in a uuid or a path, so no two distinct identities can
        // collide on one key the way a space or a slash could.
        const groupKey = `${folder.userId}\u0000${folder.projectId ?? ''}\u0000${folder.path}`;

        const survivor = survivorByGroup.get(groupKey);
        if (survivor === undefined) {
          survivorByGroup.set(groupKey, folder.id);
        } else {
          supersededBy.set(folder.id, survivor);
        }

        reportProgress(i + 1, folders.length, 'folders');
      }

      // 2a. Repoint children of a discarded row at that row's survivor, so no
      //     `parentFolderId` is left naming a folder we are about to delete.
      const repointParent = db.prepare(
        'UPDATE folders SET parentFolderId = ?, updatedAt = ? WHERE id = ?'
      );
      const now = new Date().toISOString();

      const needingRepoint = folders.filter(
        (f) => f.parentFolderId !== null && supersededBy.has(f.parentFolderId)
      );

      for (let i = 0; i < needingRepoint.length; i++) {
        const folder = needingRepoint[i];
        const newParentId = supersededBy.get(folder.parentFolderId as string) as string;
        repointParent.run(newParentId, now, folder.id);

        logger.debug('Repointed folder parent to surviving duplicate', {
          context: 'migration.collapse-duplicate-folders',
          folderId: folder.id,
          from: folder.parentFolderId,
          to: newParentId,
        });

        reportProgress(i + 1, needingRepoint.length, 'folder parents');
      }

      // 2b. Delete the discarded rows.
      const deleteFolder = db.prepare('DELETE FROM folders WHERE id = ?');
      const discardedIds = Array.from(supersededBy.keys());

      for (let i = 0; i < discardedIds.length; i++) {
        deleteFolder.run(discardedIds[i]);
        reportProgress(i + 1, discardedIds.length, 'duplicate folders');
      }

      // 3. Create the unique index that makes a repeat impossible.
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX_NAME}" ` +
          `ON "folders" ("userId", COALESCE("projectId", ''), "path")`
      );

      if (!indexExists()) {
        throw new Error('Unique index was not created');
      }

      logger.info('Collapsed duplicate folder rows', {
        context: 'migration.collapse-duplicate-folders',
        scanned: folders.length,
        surviving: survivorByGroup.size,
        deleted: discardedIds.length,
        repointed: needingRepoint.length,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: discardedIds.length,
        message: `Collapsed ${discardedIds.length} duplicate folder row${
          discardedIds.length === 1 ? '' : 's'
        } into ${survivorByGroup.size} folder${survivorByGroup.size === 1 ? '' : 's'}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to collapse duplicate folder rows', {
        context: 'migration.collapse-duplicate-folders',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: `Failed to collapse duplicate folder rows: ${
          error instanceof Error ? error.message : String(error)
        }`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
