/**
 * Document Mount Blobs Repository
 *
 * Stores binary asset content inside quilltap-mount-index.db, keyed by
 * fileId. Each blob row mirrors one doc_mount_files row (1:1 by fileId).
 * Multiple hard links to the same file share a single blob — bytes never
 * get duplicated when a file appears in two mount points.
 *
 * Per-link metadata (relative path, original filename, description,
 * extracted text) lives on doc_mount_file_links so each consumer can keep
 * its own values.
 *
 * The `data` column holds the raw bytes as a SQLite BLOB; this repository
 * bypasses the generic SQLiteCollection machinery for the same reason as
 * before — JSON serialisation paths would mangle binary content.
 *
 * Callers normally use:
 *   - Metadata-only reads (findByFileId, listByMountPoint) — cheap.
 *   - readData() — only when serving bytes to a client or tool.
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import { DocMountBlobMetadata, DocMountBlobMetadataSchema } from '@/lib/schemas/mount-index.types';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '../backends/sqlite/mount-index-client';

/**
 * Joined view: a blob row with the link metadata callers need to know where
 * this blob lives. Most legacy code paths want to enumerate blobs by mount
 * point and see their location, so we serve both in one shot.
 */
export interface DocMountBlobWithLink extends DocMountBlobMetadata {
  linkId: string;
  mountPointId: string;
  relativePath: string;
  fileName: string;
  folderId: string | null;
  originalFileName: string;
  originalMimeType: string;
  description: string;
  descriptionUpdatedAt: string | null;
  extractedText: string | null;
  extractedTextSha256: string | null;
  extractionStatus: 'none' | 'pending' | 'converted' | 'failed' | 'skipped';
  extractionError: string | null;
  lastModified: string;
}

export type ExtractionStatus = 'none' | 'pending' | 'converted' | 'failed' | 'skipped';

export interface UpdateExtractedTextInput {
  extractedText: string | null;
  extractedTextSha256: string | null;
  extractionStatus: ExtractionStatus;
  extractionError?: string | null;
}

const TABLE = 'doc_mount_blobs';

export interface UpsertBlobInput {
  fileId: string;
  /** Advisory only — upsertByFileId recomputes sha256 from `data`. */
  sha256: string;
  storedMimeType: string;
  data: Buffer;
}

/**
 * Legacy "give me a blob row at this (mount, path)" input — preserves the
 * old call shape on top of the new content/link split. Internally this
 * walks through docMountFileLinks.linkBlobContent to dedup by sha and
 * upsert the link row.
 */
export interface CreateBlobInput {
  mountPointId: string;
  relativePath: string;
  originalFileName: string;
  originalMimeType: string;
  storedMimeType: string;
  sha256: string;
  data: Buffer;
  description?: string;
  fileName?: string;
  folderId?: string | null;
  fileType?: 'pdf' | 'docx' | 'markdown' | 'txt' | 'json' | 'jsonl' | 'blob';
  /**
   * Explicit row ids for `preserveIds` imports (archive/rehydrate, spec F4).
   * Forwarded to linkBlobContent, which honors each only when the row in
   * question is actually being created — existing rows keep their own ids.
   */
  fileId?: string;
  linkId?: string;
  blobId?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowToMetadata(row: Record<string, unknown>): DocMountBlobMetadata {
  // Drop the `data` column if it leaked in — metadata queries should never
  // hydrate the blob bytes, but this guards against programmer error.
  const { data: _data, ...metadata } = row as Record<string, unknown> & { data?: Buffer };
  return DocMountBlobMetadataSchema.parse(metadata);
}

export class DocMountBlobsRepository {
  private tableInitialized = false;

  private db() {
    if (isMountIndexDegraded()) {
      throw new Error('Mount index database is in degraded mode');
    }
    const db = getRawMountIndexDatabase();
    if (!db) {
      throw new Error('Mount index database not initialized');
    }

    if (!this.tableInitialized) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS "${TABLE}" (
          "id" TEXT PRIMARY KEY,
          "fileId" TEXT NOT NULL,
          "sha256" TEXT NOT NULL,
          "sizeBytes" INTEGER NOT NULL,
          "storedMimeType" TEXT NOT NULL,
          "data" BLOB NOT NULL,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL,
          FOREIGN KEY ("fileId") REFERENCES "doc_mount_files" ("id") ON DELETE CASCADE
        )
      `);
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${TABLE}_fileId" ` +
        `ON "${TABLE}" ("fileId")`
      );

      this.tableInitialized = true;
    }

    return db;
  }

  async findById(id: string): Promise<DocMountBlobMetadata | null> {
    try {
      const row = this.db().prepare(
        `SELECT id, fileId, sha256, sizeBytes, storedMimeType, createdAt, updatedAt
         FROM "${TABLE}" WHERE id = ?`
      ).get(id) as Record<string, unknown> | undefined;
      return row ? rowToMetadata(row) : null;
    } catch (error) {
      logger.warn('Failed to find blob by id', { id, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  async findByFileId(fileId: string): Promise<DocMountBlobMetadata | null> {
    try {
      const row = this.db().prepare(
        `SELECT id, fileId, sha256, sizeBytes, storedMimeType, createdAt, updatedAt
         FROM "${TABLE}" WHERE fileId = ?`
      ).get(fileId) as Record<string, unknown> | undefined;
      return row ? rowToMetadata(row) : null;
    } catch (error) {
      logger.warn('Failed to find blob by fileId', {
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async findManyByFileIds(fileIds: string[]): Promise<DocMountBlobMetadata[]> {
    if (fileIds.length === 0) return [];
    try {
      const placeholders = fileIds.map(() => '?').join(',');
      const rows = this.db().prepare(
        `SELECT id, fileId, sha256, sizeBytes, storedMimeType, createdAt, updatedAt
         FROM "${TABLE}" WHERE fileId IN (${placeholders})`
      ).all(...fileIds) as Array<Record<string, unknown>>;
      return rows.map(rowToMetadata);
    } catch (error) {
      logger.warn('Failed to find blobs by fileIds', {
        fileIdCount: fileIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Read the raw bytes for a blob row. Resolves either an id or a fileId
   * (the latter is more common now since callers usually hold a file
   * reference, not a blob row).
   */
  async readData(id: string): Promise<Buffer | null> {
    try {
      const row = this.db().prepare(
        `SELECT data FROM "${TABLE}" WHERE id = ?`
      ).get(id) as { data: Buffer } | undefined;
      return row ? row.data : null;
    } catch (error) {
      logger.warn('Failed to read blob data', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async readDataByFileId(fileId: string): Promise<Buffer | null> {
    try {
      const row = this.db().prepare(
        `SELECT data FROM "${TABLE}" WHERE fileId = ?`
      ).get(fileId) as { data: Buffer } | undefined;
      return row ? row.data : null;
    } catch (error) {
      logger.warn('Failed to read blob data by fileId', {
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Insert or replace the blob row for a fileId. If a row already exists,
   * its bytes are overwritten (preserving the blob's id). If not, a new
   * row is minted. Callers are responsible for ensuring the file row
   * already exists in doc_mount_files.
   */
  async upsertByFileId(input: UpsertBlobInput): Promise<DocMountBlobMetadata> {
    const now = nowIso();
    const sizeBytes = input.data.length;
    const db = this.db();

    // Recompute the content hash from the actual bytes — the store owns its
    // own hashes; the caller's sha256 is advisory. Keeps the invariant
    // sha256 == sha256(stored bytes) (see linkBlobContent for the same rule).
    const computed = sha256OfBuffer(input.data);
    logger.debug('upsertByFileId: computed content hash', {
      fileId: input.fileId,
      passedSha: input.sha256,
      computedSha: computed,
      sizeBytes,
    });
    if (input.sha256 !== computed) {
      logger.warn('upsertByFileId: caller sha256 disagrees with stored bytes; using computed', {
        fileId: input.fileId,
        passedSha: input.sha256,
        computedSha: computed,
        sizeBytes,
      });
    }

    const existing = db.prepare(
      `SELECT id FROM "${TABLE}" WHERE fileId = ?`
    ).get(input.fileId) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE "${TABLE}" SET
           sha256 = ?, sizeBytes = ?, storedMimeType = ?, data = ?, updatedAt = ?
         WHERE id = ?`
      ).run(computed, sizeBytes, input.storedMimeType, input.data, now, existing.id);
      const updated = await this.findById(existing.id);
      if (!updated) {
        throw new Error(`Blob disappeared after update: ${existing.id}`);
      }
      return updated;
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO "${TABLE}" (
         id, fileId, sha256, sizeBytes, storedMimeType, data, createdAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, input.fileId, computed, sizeBytes,
      input.storedMimeType, input.data, now, now
    );
    const created = await this.findById(id);
    if (!created) {
      throw new Error(`Blob disappeared immediately after creation: ${id}`);
    }
    return created;
  }

  /**
   * Legacy facade for callers that hold a (mountPointId, relativePath)
   * tuple and want one-call write semantics. Delegates to
   * docMountFileLinks.linkBlobContent, returning the resulting blob row
   * (with link metadata attached via the joined view for compatibility
   * with old call sites that read mountPointId / relativePath / etc).
   */
  async create(input: CreateBlobInput): Promise<DocMountBlobWithLink> {
    const path = await import('path');
    // Late-bind the link repo via the repository factory to avoid a circular import.
    const { getRepositories } = await import('@/lib/repositories/factory');
    const repos = getRepositories();
    const { link } = await repos.docMountFileLinks.linkBlobContent({
      mountPointId: input.mountPointId,
      relativePath: input.relativePath,
      fileName: input.fileName ?? path.posix.basename(input.relativePath),
      folderId: input.folderId ?? null,
      fileType: input.fileType ?? 'blob',
      originalFileName: input.originalFileName,
      originalMimeType: input.originalMimeType,
      storedMimeType: input.storedMimeType,
      sha256: input.sha256,
      data: input.data,
      description: input.description,
      fileId: input.fileId,
      linkId: input.linkId,
      blobId: input.blobId,
    });

    const found = await this.findByMountPointAndPath(link.mountPointId, link.relativePath);
    if (!found) {
      throw new Error(
        `Blob row not visible after upsert: ${link.mountPointId}/${link.relativePath}`
      );
    }
    return found;
  }

  /**
   * Plain delete by id. After the content/link split, in normal use the
   * cascade from doc_mount_files (when its last link is removed) handles
   * cleanup; this is for migration and reconciliation paths.
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = this.db().prepare(`DELETE FROM "${TABLE}" WHERE id = ?`).run(id);
      return result.changes > 0;
    } catch (error) {
      logger.warn('Failed to delete blob', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Update the relativePath of the link associated with a blob. Legacy
   * facade; mirrors the old per-blob updatePath semantics by writing to
   * the first matching link row.
   */
  async updatePath(id: string, newRelativePath: string): Promise<boolean> {
    try {
      const db = this.db();
      const blob = await this.findById(id);
      if (!blob) return false;
      const link = db.prepare(
        `SELECT id FROM doc_mount_file_links WHERE fileId = ? LIMIT 1`
      ).get(blob.fileId) as { id: string } | undefined;
      if (!link) return false;
      const now = new Date().toISOString();
      const res = db.prepare(
        `UPDATE doc_mount_file_links SET relativePath = ?, updatedAt = ? WHERE id = ?`
      ).run(newRelativePath, now, link.id);
      return res.changes > 0;
    } catch (error) {
      logger.warn('Failed to update blob path', {
        id,
        newRelativePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Delete a blob row directly. In normal use the cascade from
   * doc_mount_files (when its last link is removed) handles cleanup; this
   * is for migration and reconciliation paths that hold a fileId directly.
   */
  async deleteByFileId(fileId: string): Promise<boolean> {
    try {
      const result = this.db().prepare(
        `DELETE FROM "${TABLE}" WHERE fileId = ?`
      ).run(fileId);
      return result.changes > 0;
    } catch (error) {
      logger.warn('Failed to delete blob by fileId', {
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // ============================================================================
  // Joined-view helpers (blob + link metadata)
  // ============================================================================

  /**
   * Find a blob at a (mountPointId, relativePath) location. Joins through
   * doc_mount_file_links to resolve the location. Returns the blob
   * metadata with link fields attached.
   */
  async findByMountPointAndPath(
    mountPointId: string,
    relativePath: string
  ): Promise<DocMountBlobWithLink | null> {
    try {
      const db = this.db();
      const row = db.prepare(
        `SELECT
           b.id, b.fileId, b.sha256, b.sizeBytes, b.storedMimeType,
           b.createdAt, b.updatedAt,
           l.id AS linkId, l.mountPointId, l.relativePath, l.fileName,
           l.folderId, l.originalFileName, l.originalMimeType,
           l.description, l.descriptionUpdatedAt,
           l.extractedText, l.extractedTextSha256, l.extractionStatus, l.extractionError,
           l.lastModified
         FROM doc_mount_file_links l
         JOIN doc_mount_blobs b ON b.fileId = l.fileId
         WHERE l.mountPointId = ? AND LOWER(l.relativePath) = LOWER(?)`
      ).get(mountPointId, relativePath) as DocMountBlobWithLink | undefined;
      return row ?? null;
    } catch (error) {
      logger.warn('Failed to find blob by path', {
        mountPointId,
        relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * List every blob visible at a mount point (joined through links).
   * Honors an optional folder filter — when set, results are limited to
   * blobs whose relativePath sits inside that folder prefix.
   */
  async listByMountPoint(
    mountPointId: string,
    options: { folder?: string } = {}
  ): Promise<DocMountBlobWithLink[]> {
    try {
      const db = this.db();
      const baseSelect = `
        SELECT
           b.id, b.fileId, b.sha256, b.sizeBytes, b.storedMimeType,
           b.createdAt, b.updatedAt,
           l.id AS linkId, l.mountPointId, l.relativePath, l.fileName,
           l.folderId, l.originalFileName, l.originalMimeType,
           l.description, l.descriptionUpdatedAt,
           l.extractedText, l.extractedTextSha256, l.extractionStatus, l.extractionError,
           l.lastModified
        FROM doc_mount_file_links l
        JOIN doc_mount_blobs b ON b.fileId = l.fileId
        WHERE l.mountPointId = ?`;

      let rows: DocMountBlobWithLink[];
      if (options.folder !== undefined) {
        const folderPrefix = options.folder.endsWith('/') ? options.folder : `${options.folder}/`;
        rows = db.prepare(
          `${baseSelect} AND l.relativePath LIKE ? ORDER BY l.relativePath ASC`
        ).all(mountPointId, `${folderPrefix}%`) as DocMountBlobWithLink[];
      } else {
        rows = db.prepare(
          `${baseSelect} ORDER BY l.relativePath ASC`
        ).all(mountPointId) as DocMountBlobWithLink[];
      }
      return rows;
    } catch (error) {
      logger.warn('Failed to list blobs by mount point', {
        mountPointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Update the description on the link associated with a blob row. Blobs
   * themselves don't carry per-link metadata anymore; the description is
   * a property of the (mountPoint, path) link. If the blob is hard-linked
   * to multiple paths, only the link the caller passes through gets
   * updated. The two-argument form (id only) updates the first link found
   * — used by routes that don't track linkId yet.
   */
  async updateDescription(
    id: string,
    description: string,
    linkId?: string
  ): Promise<DocMountBlobWithLink | null> {
    try {
      const db = this.db();
      const now = new Date().toISOString();

      const blob = await this.findById(id);
      if (!blob) return null;

      let targetLinkId = linkId;
      if (!targetLinkId) {
        const link = db.prepare(
          `SELECT id FROM doc_mount_file_links WHERE fileId = ? LIMIT 1`
        ).get(blob.fileId) as { id: string } | undefined;
        targetLinkId = link?.id;
      }
      if (!targetLinkId) return null;

      db.prepare(
        `UPDATE doc_mount_file_links
         SET description = ?, descriptionUpdatedAt = ?, updatedAt = ?
         WHERE id = ?`
      ).run(description, now, now, targetLinkId);

      // Return the joined view so callers can pick up the new metadata.
      return db.prepare(
        `SELECT
           b.id, b.fileId, b.sha256, b.sizeBytes, b.storedMimeType,
           b.createdAt, b.updatedAt,
           l.id AS linkId, l.mountPointId, l.relativePath, l.fileName,
           l.folderId, l.originalFileName, l.originalMimeType,
           l.description, l.descriptionUpdatedAt,
           l.extractedText, l.extractedTextSha256, l.extractionStatus, l.extractionError,
           l.lastModified
         FROM doc_mount_file_links l
         JOIN doc_mount_blobs b ON b.fileId = l.fileId
         WHERE l.id = ?`
      ).get(targetLinkId) as DocMountBlobWithLink | null;
    } catch (error) {
      logger.warn('Failed to update blob description', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Update the extracted-text / extraction-status fields on the link
   * associated with a blob row. Same per-link semantics as
   * updateDescription.
   */
  async updateExtractedText(
    id: string,
    input: UpdateExtractedTextInput,
    linkId?: string
  ): Promise<DocMountBlobWithLink | null> {
    try {
      const db = this.db();
      const now = new Date().toISOString();

      const blob = await this.findById(id);
      if (!blob) return null;

      let targetLinkId = linkId;
      if (!targetLinkId) {
        const link = db.prepare(
          `SELECT id FROM doc_mount_file_links WHERE fileId = ? LIMIT 1`
        ).get(blob.fileId) as { id: string } | undefined;
        targetLinkId = link?.id;
      }
      if (!targetLinkId) return null;

      db.prepare(
        `UPDATE doc_mount_file_links SET
           extractedText = ?, extractedTextSha256 = ?,
           extractionStatus = ?, extractionError = ?, updatedAt = ?
         WHERE id = ?`
      ).run(
        input.extractedText,
        input.extractedTextSha256,
        input.extractionStatus,
        input.extractionError ?? null,
        now,
        targetLinkId
      );

      return db.prepare(
        `SELECT
           b.id, b.fileId, b.sha256, b.sizeBytes, b.storedMimeType,
           b.createdAt, b.updatedAt,
           l.id AS linkId, l.mountPointId, l.relativePath, l.fileName,
           l.folderId, l.originalFileName, l.originalMimeType,
           l.description, l.descriptionUpdatedAt,
           l.extractedText, l.extractedTextSha256, l.extractionStatus, l.extractionError,
           l.lastModified
         FROM doc_mount_file_links l
         JOIN doc_mount_blobs b ON b.fileId = l.fileId
         WHERE l.id = ?`
      ).get(targetLinkId) as DocMountBlobWithLink | null;
    } catch (error) {
      logger.warn('Failed to update blob extracted text', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Delete the link at (mountPointId, relativePath) with GC of the file
   * row if this was the last link. The blob bytes cascade off the file
   * row deletion. Returns true when a link was deleted (regardless of
   * whether the underlying file survived).
   */
  async deleteByMountPointAndPath(mountPointId: string, relativePath: string): Promise<boolean> {
    try {
      const db = this.db();
      const link = db.prepare(
        `SELECT id, fileId FROM doc_mount_file_links
         WHERE mountPointId = ? AND relativePath = ?`
      ).get(mountPointId, relativePath) as { id: string; fileId: string } | undefined;
      if (!link) return false;

      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM doc_mount_file_links WHERE id = ?`).run(link.id);
        const remaining = db.prepare(
          `SELECT COUNT(*) AS count FROM doc_mount_file_links WHERE fileId = ?`
        ).get(link.fileId) as { count: number };
        if (remaining.count === 0) {
          db.prepare(`DELETE FROM doc_mount_files WHERE id = ?`).run(link.fileId);
        }
      });
      tx();
      return true;
    } catch (error) {
      logger.warn('Failed to delete blob by path', {
        mountPointId,
        relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Bulk delete every link in a mount, GC'ing files (and their blobs) as
   * each one's reference count hits zero. Mirrors the legacy semantic.
   */
  async deleteByMountPointId(mountPointId: string): Promise<number> {
    try {
      const db = this.db();
      // Snapshot affected fileIds, then drop links + orphaned files.
      const affected = db.prepare(
        `SELECT DISTINCT fileId FROM doc_mount_file_links WHERE mountPointId = ?`
      ).all(mountPointId) as { fileId: string }[];

      let deletedBlobs = 0;
      const tx = db.transaction(() => {
        db.prepare(
          `DELETE FROM doc_mount_file_links WHERE mountPointId = ?`
        ).run(mountPointId);
        if (affected.length > 0) {
          const placeholders = affected.map(() => '?').join(',');
          const orphaned = db.prepare(
            `SELECT f.id FROM doc_mount_files f
             WHERE f.id IN (${placeholders})
               AND NOT EXISTS (SELECT 1 FROM doc_mount_file_links l WHERE l.fileId = f.id)`
          ).all(...affected.map(a => a.fileId)) as { id: string }[];
          for (const f of orphaned) {
            db.prepare(`DELETE FROM doc_mount_files WHERE id = ?`).run(f.id);
            deletedBlobs += 1;
          }
        }
      });
      tx();
      return deletedBlobs;
    } catch (error) {
      logger.warn('Failed to delete blobs by mount point', {
        mountPointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
