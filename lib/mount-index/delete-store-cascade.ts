/**
 * Atomic teardown of a document store and every row that hangs off it.
 *
 * Deleting a store touches nine tables in the mount-index DB (chunks, links,
 * file/document/blob content, folders, project & group links, the mount-point
 * row itself). Before Bug 9's fix the route ran these as seven independent,
 * un-transacted repository calls, in an order that left two steps reading a
 * table an earlier step had already emptied — so a partial failure minted a
 * permanent orphan and native-text documents leaked outright. Because read
 * connections keep foreign keys off, the orphans sat silent until a backup
 * carried them (raw `SELECT *`) into a restore where constraints are live,
 * which then failed with `FOREIGN KEY constraint failed`.
 *
 * Everything a store owns lives in the single mount-index database, so the
 * whole cascade fits in one `db.transaction(...)`: a mid-cascade throw rolls
 * back the lot, and the ordering GC's content rows against a fresh link count
 * rather than a table an earlier step emptied.
 *
 * @module mount-index/delete-store-cascade
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '@/lib/logger';
import { getRawMountIndexDatabase } from '@/lib/database/backends/sqlite/mount-index-client';
import { invalidateMountPoint } from '@/lib/mount-index/mount-chunk-cache';

/** Per-table row counts removed by {@link deleteStoreCascade}. */
export interface StoreCascadeDeleteCounts {
  chunks: number;
  links: number;
  files: number;
  documents: number;
  blobs: number;
  folders: number;
  projectLinks: number;
  groupLinks: number;
  mountPoint: number;
}

function tableExists(db: DatabaseType, name: string): boolean {
  return !!db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name);
}

/**
 * Delete a document store and all of its children atomically.
 *
 * Runs a single synchronous transaction on the mount-index DB. Missing child
 * tables (a store with no database-backed content may never have created
 * `doc_mount_documents` / `doc_mount_blobs`) are skipped rather than throwing,
 * so the cascade is safe on any instance.
 *
 * @param mountPointId the store to tear down
 * @returns the per-table counts removed
 */
export function deleteStoreCascade(mountPointId: string): StoreCascadeDeleteCounts {
  const db = getRawMountIndexDatabase();
  if (!db) {
    throw new Error('Mount index database not initialized');
  }

  const counts: StoreCascadeDeleteCounts = {
    chunks: 0,
    links: 0,
    files: 0,
    documents: 0,
    blobs: 0,
    folders: 0,
    projectLinks: 0,
    groupLinks: 0,
    mountPoint: 0,
  };

  const has = (name: string) => tableExists(db, name);

  const tx = db.transaction(() => {
    // Snapshot the fileIds this store's links reference BEFORE deleting the
    // links, so content rows can be GC'd against a live ref-count instead of a
    // table an earlier step already emptied (the v4 dead-step bug).
    const affectedFileIds = has('doc_mount_file_links')
      ? (
          db
            .prepare(
              `SELECT DISTINCT fileId FROM doc_mount_file_links WHERE mountPointId = ?`
            )
            .all(mountPointId) as { fileId: string }[]
        ).map((r) => r.fileId)
      : [];

    // Embedding chunks (denormalised mountPointId; also FK to links).
    if (has('doc_mount_chunks')) {
      counts.chunks = db
        .prepare(`DELETE FROM doc_mount_chunks WHERE mountPointId = ?`)
        .run(mountPointId).changes;
    }

    // The location rows.
    if (has('doc_mount_file_links')) {
      counts.links = db
        .prepare(`DELETE FROM doc_mount_file_links WHERE mountPointId = ?`)
        .run(mountPointId).changes;
    }

    // Content rows whose last link just went away. Documents and blobs are
    // deleted explicitly (not left to an ON DELETE CASCADE): generateDDL tables
    // carry no foreign keys, so a cascade would silently keep the payload
    // forever on those instances. Deleting children first is a no-op where the
    // cascade does exist.
    for (const fileId of affectedFileIds) {
      const stillLinked = has('doc_mount_file_links')
        ? (
            db
              .prepare(
                `SELECT COUNT(*) AS count FROM doc_mount_file_links WHERE fileId = ?`
              )
              .get(fileId) as { count: number }
          ).count
        : 0;
      if (stillLinked > 0) continue;
      if (has('doc_mount_documents')) {
        counts.documents += db
          .prepare(`DELETE FROM doc_mount_documents WHERE fileId = ?`)
          .run(fileId).changes;
      }
      if (has('doc_mount_blobs')) {
        counts.blobs += db
          .prepare(`DELETE FROM doc_mount_blobs WHERE fileId = ?`)
          .run(fileId).changes;
      }
      if (has('doc_mount_files')) {
        counts.files += db
          .prepare(`DELETE FROM doc_mount_files WHERE id = ?`)
          .run(fileId).changes;
      }
    }

    // Folder hierarchy — keyed on mountPointId, no FK to anything above, so it
    // would otherwise leak (118 orphaned rows measured on the Friday copy).
    if (has('doc_mount_folders')) {
      counts.folders = db
        .prepare(`DELETE FROM doc_mount_folders WHERE mountPointId = ?`)
        .run(mountPointId).changes;
    }

    // Project links.
    if (has('project_doc_mount_links')) {
      counts.projectLinks = db
        .prepare(`DELETE FROM project_doc_mount_links WHERE mountPointId = ?`)
        .run(mountPointId).changes;
    }

    // Group links — never deleted by the v4 route (it deleted project links
    // only), so a group's additional-store links outlived the store.
    if (has('group_doc_mount_links')) {
      counts.groupLinks = db
        .prepare(`DELETE FROM group_doc_mount_links WHERE mountPointId = ?`)
        .run(mountPointId).changes;
    }

    // Finally the store row itself, inside the same transaction so a throw
    // anywhere above leaves the store (and its children) intact.
    if (has('doc_mount_points')) {
      counts.mountPoint = db
        .prepare(`DELETE FROM doc_mount_points WHERE id = ?`)
        .run(mountPointId).changes;
    }
  });

  tx();
  invalidateMountPoint(mountPointId);

  logger.debug('[delete-store-cascade] Store torn down', { mountPointId, ...counts });
  return counts;
}
