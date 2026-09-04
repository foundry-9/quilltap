/**
 * Migration: deliberate hard-link groups on doc_mount_file_links
 *
 * Adds a nullable `linkGroupId` column plus its partial index. Links sharing a
 * non-null group were explicitly hard-linked and behave like POSIX hard links:
 * a write through any member repoints every member at the new content row.
 *
 * No backfill is possible, and none is attempted. Before this column existed
 * the only trace of a hard link was a shared `fileId`, and a shared `fileId`
 * cannot tell a deliberate link apart from content-addressed dedup — two
 * unrelated documents with byte-identical content (an empty file, a boilerplate
 * header) land on the same content row by coincidence. Grouping those would be
 * actively destructive: editing one character's copy would rewrite the same
 * path in every other vault that happened to match. Existing links therefore
 * start ungrouped, and re-running `quilltap docs link` re-establishes any link
 * the owner actually wants.
 *
 * The second half of the migration is a cleanup that is safe to do
 * automatically: delete `doc_mount_files` rows no link references any more.
 * Every write is content-addressed — it finds-or-creates a file row for the new
 * sha and repoints the link — and until the accompanying fix landed, the row
 * the link left behind was never collected. Its `doc_mount_documents` /
 * `doc_mount_blobs` payload cascades away with it.
 *
 * Migration ID: add-doc-mount-link-groups-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import { columnExists, openMountIndexDbIfPresent, tableExists } from '../lib/database-utils';

const MIGRATION_ID = 'add-doc-mount-link-groups-v1';

const COLUMN_NAME = 'linkGroupId';
const COLUMN_DEFINITION = `"linkGroupId" TEXT DEFAULT NULL`;
const INDEX_NAME = 'idx_doc_mount_file_links_linkGroupId';

export const addDocMountLinkGroupsMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Add linkGroupId to doc_mount_file_links (deliberate hard-link groups) and collect orphaned content rows left behind by content-addressed rewrites',
  introducedInVersion: '4.8.0',
  dependsOn: ['add-doc-mount-file-links-v1'],

  async shouldRun(): Promise<boolean> {
    const db = openMountIndexDbIfPresent();
    if (!db) return false;
    try {
      if (!tableExists(db, 'doc_mount_file_links')) return false;
      if (!columnExists(db, 'doc_mount_file_links', COLUMN_NAME)) return true;
      // Column present but orphans may still be waiting (upgrade from a build
      // that added the column before the GC landed).
      const orphans = db.prepare(
        `SELECT COUNT(*) AS count FROM doc_mount_files f
         WHERE NOT EXISTS (SELECT 1 FROM doc_mount_file_links l WHERE l.fileId = f.id)`
      ).get() as { count: number } | undefined;
      return (orphans?.count ?? 0) > 0;
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const db = openMountIndexDbIfPresent();
    if (!db) {
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 0,
        message: 'No mount-index database present; nothing to migrate',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    let columnAdded = false;
    let orphansCollected = 0;
    let bytesReclaimed = 0;

    try {
      // ----------------------------------------------------------------------
      // Step 1: add the column + partial index (idempotent).
      // ----------------------------------------------------------------------
      if (!columnExists(db, 'doc_mount_file_links', COLUMN_NAME)) {
        db.exec(`ALTER TABLE "doc_mount_file_links" ADD COLUMN ${COLUMN_DEFINITION}`);
        columnAdded = true;
      }
      db.exec(
        `CREATE INDEX IF NOT EXISTS "${INDEX_NAME}" ` +
        `ON "doc_mount_file_links" ("linkGroupId") WHERE "linkGroupId" IS NOT NULL`
      );

      // ----------------------------------------------------------------------
      // Step 2: collect content rows no link references any more.
      // ----------------------------------------------------------------------
      const orphans = db.prepare(
        `SELECT f.id AS id, f.fileSizeBytes AS fileSizeBytes FROM doc_mount_files f
         WHERE NOT EXISTS (SELECT 1 FROM doc_mount_file_links l WHERE l.fileId = f.id)`
      ).all() as Array<{ id: string; fileSizeBytes: number }>;

      const total = orphans.length;
      // Delete the payload rows explicitly. ON DELETE CASCADE is only present
      // on databases whose tables came from add-doc-mount-file-links; tables
      // generated from the Zod schema carry no foreign keys, and there a
      // cascade would leave every document body behind.
      const deleteDocStmt = db.prepare('DELETE FROM doc_mount_documents WHERE fileId = ?');
      const deleteBlobStmt = db.prepare('DELETE FROM doc_mount_blobs WHERE fileId = ?');
      const deleteFileStmt = db.prepare('DELETE FROM doc_mount_files WHERE id = ?');

      for (let i = 0; i < orphans.length; i++) {
        const orphan = orphans[i];
        deleteDocStmt.run(orphan.id);
        deleteBlobStmt.run(orphan.id);
        const res = deleteFileStmt.run(orphan.id);
        if (res.changes > 0) {
          orphansCollected += 1;
          bytesReclaimed += orphan.fileSizeBytes ?? 0;
        }
        reportProgress(i + 1, total, 'orphaned files');
      }

      const message =
        `${columnAdded ? 'Added linkGroupId column; ' : 'linkGroupId column already present; '}` +
        `collected ${orphansCollected} orphaned content row(s) (${bytesReclaimed} bytes)`;
      logger.info(message, {
        context: `migration.${MIGRATION_ID}`,
        columnAdded,
        orphansCollected,
        bytesReclaimed,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: orphansCollected,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('add-doc-mount-link-groups migration aborted', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: orphansCollected,
        message: 'add-doc-mount-link-groups migration aborted',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  },
};
