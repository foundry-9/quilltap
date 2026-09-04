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
import { tableExists } from '@/lib/database/backends/sqlite/introspection';

/**
 * Minimal synchronous handle {@link gcOrphanedFileRow} needs — satisfied by
 * better-sqlite3's `Database` and by the repositories' structural `SyncDb`.
 */
export interface OrphanGcDb {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number };
  };
}

/** Per-table rows removed for one content row by {@link gcOrphanedFileRow}. */
export interface OrphanedFileRowGc {
  documents: number;
  blobs: number;
  files: number;
}

/**
 * Drop a content row (`doc_mount_files` plus its document/blob payload) that
 * no link references any more. Shared by the link repository's delete and
 * write paths and by the store cascade so all three collect content the same
 * way.
 *
 * Every write to a database-backed mount is content-addressed: it finds-or-
 * creates a `doc_mount_files` row for the NEW sha and repoints the link at it.
 * Without this the row the link just left behind lingers forever, holding its
 * `doc_mount_documents` / `doc_mount_blobs` payload — a slow leak that had
 * accumulated dozens of orphans in the wild. Content rows still referenced by
 * some other link (a real hard link, or an unrelated file that happens to have
 * identical bytes) are left alone.
 *
 * Returns `null` — nothing collected — when `fileId` is null or another link
 * still references the file; otherwise the per-table counts removed.
 *
 * The payload rows are deleted explicitly rather than left to the FK cascade.
 * `ON DELETE CASCADE` is only present on databases whose tables came from the
 * add-doc-mount-file-links migration; tables created from the Zod schema by
 * generateDDL carry no foreign keys at all, so on those instances a cascade
 * would silently keep every payload forever. Deleting children first is a
 * no-op where the cascade does exist.
 *
 * The payload tables are created lazily by their repositories on first access
 * (`doc_mount_blobs` has no Zod schema, so `generateDDL` never mints it; a
 * document-only or restored-from-old-backup index may likewise never have held
 * a blob). Deleting from a table that has never been created throws
 * `no such table` — a hard failure on the second write to any path (Bug 13).
 * So each payload delete is guarded behind a table-existence check; a missing
 * table has nothing to collect anyway.
 *
 * Runs synchronously inside the caller's `db.transaction(...)`.
 */
export function gcOrphanedFileRow(db: OrphanGcDb, fileId: string | null): OrphanedFileRowGc | null {
  if (!fileId) return null;
  const still = db.prepare(
    'SELECT COUNT(*) AS count FROM doc_mount_file_links WHERE fileId = ?'
  ).get(fileId) as { count: number } | undefined;
  if ((still?.count ?? 0) > 0) return null;

  const counts: OrphanedFileRowGc = { documents: 0, blobs: 0, files: 0 };
  if (tableExists(db, 'doc_mount_documents')) {
    counts.documents = db.prepare('DELETE FROM doc_mount_documents WHERE fileId = ?').run(fileId).changes;
  }
  if (tableExists(db, 'doc_mount_blobs')) {
    counts.blobs = db.prepare('DELETE FROM doc_mount_blobs WHERE fileId = ?').run(fileId).changes;
  }
  if (tableExists(db, 'doc_mount_files')) {
    counts.files = db.prepare('DELETE FROM doc_mount_files WHERE id = ?').run(fileId).changes;
  }
  return counts;
}

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
