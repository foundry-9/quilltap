/**
 * Reaper for doc-store children stranded when their mount point vanished (Bug 9).
 *
 * A pre-fix non-atomic store delete (or a hand-built index) could leave
 * `doc_mount_file_links` / `doc_mount_folders` rows pointing at a mount point
 * that no longer exists, plus `doc_mount_documents` rows whose file lost every
 * link. Read connections keep foreign keys off, so these sit silent until a
 * backup carries them (raw `SELECT *`) into a restore where constraints are
 * live, which then fails with `FOREIGN KEY constraint failed`.
 *
 * This is a pure, synchronous sweep over a raw mount-index DB handle so it can
 * be unit-tested directly and reused from the repository method, boot, and the
 * daily maintenance sweep. Healthy rows (whose mount point still exists) are
 * left untouched.
 *
 * @module mount-index/orphan-store-reaper
 */

import type { Database as DatabaseType } from 'better-sqlite3';

export interface OrphanedStoreChildrenSwept {
  links: number;
  folders: number;
  documents: number;
}

/**
 * Reap orphaned store children in one transaction. Returns the per-table
 * counts removed.
 */
export function reapOrphanedStoreChildren(db: DatabaseType): OrphanedStoreChildrenSwept {
  const result: OrphanedStoreChildrenSwept = { links: 0, folders: 0, documents: 0 };
  const tx = db.transaction(() => {
    // Links whose mount point is gone.
    result.links = db.prepare(
      `DELETE FROM doc_mount_file_links
       WHERE mountPointId NOT IN (SELECT id FROM doc_mount_points)`
    ).run().changes;
    // Folders whose mount point is gone.
    result.folders = db.prepare(
      `DELETE FROM doc_mount_folders
       WHERE mountPointId NOT IN (SELECT id FROM doc_mount_points)`
    ).run().changes;
    // Text documents whose file no longer has any link — including files whose
    // last link was just reaped above. Documents carry no mountPointId, so this
    // is the join-through path for "mount point no longer exists."
    result.documents = db.prepare(
      `DELETE FROM doc_mount_documents
       WHERE fileId NOT IN (SELECT DISTINCT fileId FROM doc_mount_file_links)`
    ).run().changes;
  });
  tx();
  return result;
}
