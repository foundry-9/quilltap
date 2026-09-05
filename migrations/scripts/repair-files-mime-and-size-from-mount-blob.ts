/**
 * Migration: Repair drifted `files.mimeType` / `files.size` on mount-blob rows
 *
 * The Scriptorium storage bridges (`writeProjectFileToMountStore`,
 * `writeUserUploadToMountStore`, `writeLanternBackgroundToMountStore`,
 * `writeCharacterAvatarToVault`) transcode bitmap uploads to WebP before
 * persisting them, via `transcodeToWebP`. Their return value carries the
 * post-transcode `storedMimeType` and `sizeBytes`, but prior to this fix
 * the callers (FileStorageManager.uploadFile, uploadFileToProject,
 * character-avatar / story-background handlers, the v1 file/image/wardrobe
 * routes, restore-service) discarded those values and stamped the resulting
 * `files` row with the *input* mimeType and `buffer.length`.
 *
 * Consequence: every FileEntry whose underlying mount blob is WebP but whose
 * `mimeType` says `image/jpeg` (or PNG, HEIC, etc.) was a ticking bomb. The
 * symptom that prompted this repair was Anthropic rejecting attachments with
 * `messages.N.content.M.image.source.base64: The image was specified using
 * the image/jpeg media type, but the image appears to be a image/webp image`.
 * HTTP `Content-Type` headers on `/api/v1/files/[id]?action=download` and the
 * proxy route were similarly lying.
 *
 * This migration walks every `files` row whose `storageKey` starts with
 * `mount-blob:`, joins to the mount-index DB's `doc_mount_blobs` table by
 * the blob id encoded in the storage key, and UPDATEs `mimeType` / `size`
 * when they disagree with the blob's `storedMimeType` / `sizeBytes`.
 *
 * `sha256` is *not* touched here. At the time this was written the legacy
 * `files.sha256` was the input bytes' hash and load-bearing for upload-time
 * deduplication (`findBySha256` runs before the transcode), so rewriting it to
 * the stored sha would have broken dedup of same-source re-uploads.
 *
 * That carve-out turned out to be bug 117: it left `files` speaking input-hash
 * while the mount index spoke stored-hash, and every join between them
 * returned an empty result its caller read as "no such file". The forward fix
 * removed the conflict rather than choosing between its halves — chat uploads
 * now run the bridge's own transcode *before* hashing, so dedup and the join
 * compare the same thing — and `realign-file-entry-sha256-v1` repairs the rows
 * this migration left behind.
 *
 * Idempotent: rows already in agreement are skipped. Rows whose mount blob
 * has been removed (orphaned storage key) are logged and left alone — they
 * are a separate cleanup problem.
 *
 * Migration ID: repair-files-mime-and-size-from-mount-blob-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import { getMountIndexDatabasePath } from '../../lib/paths';

const MIGRATION_ID = 'repair-files-mime-and-size-from-mount-blob-v1';
const STORAGE_KEY_PREFIX = 'mount-blob:';
const BATCH_SIZE = 500;

function openMountIndexDb(): DatabaseType | null {
  const dbPath = getMountIndexDatabasePath();
  if (!fs.existsSync(path.dirname(dbPath))) return null;
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath);
  try {
    const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
    if (pepper) {
      const keyHex = Buffer.from(pepper, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
    }
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    return db;
  } catch (error) {
    try { db.close(); } catch { /* ignore */ }
    throw error;
  }
}

function parseBlobId(storageKey: string): string | null {
  if (!storageKey.startsWith(STORAGE_KEY_PREFIX)) return null;
  const rest = storageKey.slice(STORAGE_KEY_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 1 || sep === rest.length - 1) return null;
  return rest.slice(sep + 1);
}

interface FileRow {
  id: string;
  mimeType: string;
  size: number;
  storageKey: string;
}

interface BlobRow {
  storedMimeType: string;
  sizeBytes: number;
}

export const repairFilesMimeAndSizeFromMountBlobMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Reconcile files.mimeType and files.size with the mount blob they point at; the storage bridges transcode bitmaps to WebP and the FileEntry must reflect what is on disk',
  introducedInVersion: '4.6.0',
  dependsOn: [
    'relink-files-to-mount-blobs-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('files')) return false;
    if (!fs.existsSync(getMountIndexDatabasePath())) return false;

    const db = getSQLiteDatabase();
    const row = db.prepare(
      `SELECT COUNT(*) AS n
         FROM "files"
        WHERE storageKey LIKE 'mount-blob:%'`,
    ).get() as { n: number };
    return row.n > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let mountDb: DatabaseType | null = null;
    let scanned = 0;
    let updated = 0;
    let orphaned = 0;
    let malformedKey = 0;

    try {
      mountDb = openMountIndexDb();
      if (!mountDb) {
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: 0,
          message: 'No mount-index database present; nothing to reconcile',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const mainDb = getSQLiteDatabase();

      const total = (mainDb.prepare(
        `SELECT COUNT(*) AS n FROM "files" WHERE storageKey LIKE 'mount-blob:%'`,
      ).get() as { n: number }).n;

      if (total === 0) {
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: 0,
          message: 'No mount-blob FileEntries to reconcile',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const selectBatch = mainDb.prepare(
        `SELECT id, mimeType, size, storageKey
           FROM "files"
          WHERE storageKey LIKE 'mount-blob:%'
            AND id > ?
          ORDER BY id
          LIMIT ?`,
      );

      const findBlob = mountDb.prepare(
        `SELECT storedMimeType, sizeBytes FROM "doc_mount_blobs" WHERE id = ?`,
      );

      const updateFile = mainDb.prepare(
        `UPDATE "files" SET mimeType = ?, size = ?, updatedAt = ? WHERE id = ?`,
      );

      let lastId = '';
      while (true) {
        const batch = selectBatch.all(lastId, BATCH_SIZE) as FileRow[];
        if (batch.length === 0) break;

        // Read every blob's metadata up-front (no writes), then apply
        // updates inside a single batch transaction. Keeping the read /
        // write phases separate lets us tolerate orphaned blob references
        // without aborting the whole batch.
        const updates: Array<{ id: string; mimeType: string; size: number }> = [];
        for (const row of batch) {
          scanned++;
          const blobId = parseBlobId(row.storageKey);
          if (!blobId) {
            malformedKey++;
            logger.warn('Malformed mount-blob storage key; skipping', {
              context: `migration.${MIGRATION_ID}`,
              fileId: row.id,
              storageKey: row.storageKey,
            });
            continue;
          }
          const blob = findBlob.get(blobId) as BlobRow | undefined;
          if (!blob) {
            orphaned++;
            logger.warn('Mount blob missing for FileEntry; mime/size left untouched', {
              context: `migration.${MIGRATION_ID}`,
              fileId: row.id,
              blobId,
            });
            continue;
          }
          if (blob.storedMimeType === row.mimeType && blob.sizeBytes === row.size) {
            continue;
          }
          updates.push({
            id: row.id,
            mimeType: blob.storedMimeType,
            size: blob.sizeBytes,
          });
        }

        if (updates.length > 0) {
          const now = new Date().toISOString();
          const tx = mainDb.transaction((rows: typeof updates) => {
            for (const u of rows) {
              updateFile.run(u.mimeType, u.size, now, u.id);
              updated++;
            }
          });
          tx(updates);
        }

        reportProgress(scanned, total, 'files');
        lastId = batch[batch.length - 1].id;
      }

      const message = `Scanned ${scanned} mount-blob FileEntries; reconciled ${updated}; ${orphaned} orphaned (no matching blob), ${malformedKey} malformed storage keys`;
      logger.info(message, {
        context: `migration.${MIGRATION_ID}`,
        scanned,
        updated,
        orphaned,
        malformedKey,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: updated,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Repair-files-mime-and-size-from-mount-blob migration aborted', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
        scanned,
        updated,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: updated,
        message: 'Repair-files-mime-and-size-from-mount-blob migration aborted',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } finally {
      if (mountDb) {
        try { mountDb.close(); } catch { /* ignore */ }
      }
    }
  },
};
