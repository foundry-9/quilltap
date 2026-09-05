/**
 * Document Mount Files Repository
 *
 * Backend-agnostic repository for DocMountFile entities — the **content row**
 * for files indexed by the mount-index DB. Identity is the bytes (sha256 is
 * UNIQUE). Location and per-link metadata live on doc_mount_file_links.
 *
 * Overrides getCollection() to route all operations to the dedicated mount
 * index database (quilltap-mount-index.db). When the mount index DB is in
 * degraded mode, getCollection() throws and safeQuery fallbacks kick in.
 */

import { logger } from '@/lib/logger';
import {
  DocMountFile,
  DocMountFileLinkWithContent,
  DocMountFileSchema,
} from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawMountIndexDatabase } from '../backends/sqlite/mount-index-client';
import { requireMountIndexDb } from '../backends/sqlite/mount-index-guard';
import { generateDDL, classifySchemaColumns } from '../schema-translator';

export class DocMountFilesRepository extends AbstractBaseRepository<DocMountFile> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('doc_mount_files', DocMountFileSchema);
  }

  /**
   * Override getCollection to return a collection from the dedicated mount index
   * database instead of the main database.
   */
  protected async getCollection(): Promise<DatabaseCollection<DocMountFile>> {
    const db = requireMountIndexDb();

    if (!this.mountIndexCollectionInitialized) {
      try {
        const ddlStatements = generateDDL(this.collectionName, this.schema);
        for (const sql of ddlStatements) {
          db.exec(sql);
        }

        // Sha256 lookup index. Not UNIQUE — existing instances may carry
        // duplicate sha rows that pre-date the content/link split (every
        // (mountPoint, relativePath) used to be its own file row, and the
        // migration deliberately keeps them rather than collapsing). Writers
        // call findOrCreateByContent to reuse on match.
        db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_mount_files_sha256 ON doc_mount_files (sha256)`);

        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure doc_mount_files table in mount index database', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    const { jsonColumns, arrayColumns, booleanColumns } = classifySchemaColumns(this.collectionName, this.schema);

    return new SQLiteCollection<DocMountFile>(db, this.collectionName, jsonColumns, arrayColumns, booleanColumns);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<DocMountFile, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountFile> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<DocMountFile>): Promise<DocMountFile | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Content-addressable helpers
  // ============================================================================

  /**
   * Find a content row by sha256. Returns null if no row matches.
   */
  async findBySha256(sha256: string): Promise<DocMountFile | null> {
    return this.safeQuery(
      async () => this.findOneByFilter({ sha256 } as TypedQueryFilter<DocMountFile>),
      'Error finding file by sha256',
      { sha256 },
      null
    );
  }

  /**
   * Get-or-create a content row keyed by sha256. If a row with this sha
   * already exists, returns the existing row (and crucially its existing
   * UUID is preserved — hard-linkers depend on this stability). If not,
   * inserts a fresh content row with the supplied attributes.
   */
  async findOrCreateByContent(
    data: Omit<DocMountFile, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountFile> {
    const existing = await this.findBySha256(data.sha256);
    if (existing) {
      return existing;
    }
    return this._create(data, options);
  }

  // ============================================================================
  // Joined-view facades — most callers want "what files are at this mount?"
  // and naturally hit the file repo first. Delegate to the link table.
  // ============================================================================

  /**
   * Return joined link + content rows for a mount point. Mirrors the
   * legacy DocMountFile shape (with mountPointId, relativePath, fileName,
   * etc.) so existing callers continue to compile.
   */
  async findByMountPointId(mountPointId: string): Promise<DocMountFileLinkWithContent[]> {
    return this.safeQuery(
      async () => {
        const db = getRawMountIndexDatabase();
        if (!db) return [];
        await this.getCollection();
        return queryLinks(db, 'WHERE l.mountPointId = ?', [mountPointId]);
      },
      'Error finding files by mount point ID',
      { mountPointId },
      []
    );
  }

  /**
   * Joined link + content row for a (mountPointId, relativePath) pair.
   */
  async findByMountPointAndPath(
    mountPointId: string,
    relativePath: string
  ): Promise<DocMountFileLinkWithContent | null> {
    return this.safeQuery(
      async () => {
        const db = getRawMountIndexDatabase();
        if (!db) return null;
        await this.getCollection();
        const rows = queryLinks(
          db,
          'WHERE l.mountPointId = ? AND LOWER(l.relativePath) = LOWER(?)',
          [mountPointId, relativePath]
        );
        return rows[0] ?? null;
      },
      'Error finding file by mount point and path',
      { mountPointId, relativePath },
      null
    );
  }

  /**
   * Bulk delete every link for a mount point with GC of the underlying
   * file rows. Returns the count of links deleted.
   */
  async deleteByMountPointId(mountPointId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const db = getRawMountIndexDatabase();
        if (!db) return 0;
        await this.getCollection();

        // Snapshot fileIds for GC.
        const affected = db.prepare(
          `SELECT DISTINCT fileId FROM doc_mount_file_links WHERE mountPointId = ?`
        ).all(mountPointId) as { fileId: string }[];

        let linksDeleted = 0;
        const tx = db.transaction(() => {
          const res = db.prepare(
            `DELETE FROM doc_mount_file_links WHERE mountPointId = ?`
          ).run(mountPointId);
          linksDeleted = res.changes;

          if (affected.length > 0) {
            const placeholders = affected.map(() => '?').join(',');
            const orphaned = db.prepare(
              `SELECT f.id FROM doc_mount_files f
               WHERE f.id IN (${placeholders})
                 AND NOT EXISTS (SELECT 1 FROM doc_mount_file_links l WHERE l.fileId = f.id)`
            ).all(...affected.map(a => a.fileId)) as { id: string }[];
            for (const f of orphaned) {
              db.prepare(`DELETE FROM doc_mount_files WHERE id = ?`).run(f.id);
            }
          }
        });
        tx();
        return linksDeleted;
      },
      'Error deleting files by mount point ID',
      { mountPointId }
    );
  }
}

/**
 * Shared helper: SELECT joined link + content rows. Identical projection to
 * DocMountFileLinksRepository.queryJoined but inlined here to keep the
 * facade independent of the link repo's class.
 */
function queryLinks(
  db: ReturnType<typeof getRawMountIndexDatabase>,
  whereClause: string,
  params: unknown[]
): DocMountFileLinkWithContent[] {
  if (!db) return [];
  const sql = `
    SELECT
      l.id, l.fileId, l.mountPointId, l.relativePath, l.fileName,
      l.folderId, l.originalFileName, l.originalMimeType,
      l.description, l.descriptionUpdatedAt,
      l.conversionStatus, l.conversionError, l.plainTextLength,
      l.extractedText, l.extractedTextSha256, l.extractionStatus, l.extractionError,
      l.chunkCount, l.lastModified, l.createdAt, l.updatedAt,
      f.sha256, f.fileSizeBytes, f.fileType, f.source
    FROM doc_mount_file_links l
    JOIN doc_mount_files f ON f.id = l.fileId
    ${whereClause}
  `;
  return db.prepare(sql).all(...params) as DocMountFileLinkWithContent[];
}
