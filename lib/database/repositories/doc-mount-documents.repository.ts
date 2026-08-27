/**
 * Document Mount Documents Repository
 *
 * Stores the text content of database-backed files inside
 * quilltap-mount-index.db. Content-addressable: keyed by fileId (UNIQUE),
 * mirroring the file row in doc_mount_files. Multiple hard links may
 * reference the same document via doc_mount_file_links.
 *
 * Path/mount lookups have moved to DocMountFileLinksRepository — consumers
 * that have a (mountPointId, relativePath) handle should resolve to a link
 * first and then call findByFileId here.
 */

import { logger } from '@/lib/logger';
import { DocMountDocument, DocMountDocumentSchema } from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawMountIndexDatabase } from '../backends/sqlite/mount-index-client';
import { requireMountIndexDb } from '../backends/sqlite/mount-index-guard';
import { generateDDL, classifySchemaColumns } from '../schema-translator';
import { ensureLinkGroupColumn } from './mount-index-case-repair';

/**
 * Joined view: a document row with the link metadata callers need to know
 * "where this document lives." Most overlay code paths want to iterate
 * documents AND see their (mountPointId, relativePath, fileName) tuple, so
 * we serve both in one shot rather than forcing two queries.
 */
export interface DocMountDocumentWithLink extends DocMountDocument {
  linkId: string;
  mountPointId: string;
  relativePath: string;
  fileName: string;
  folderId: string | null;
  fileType: 'pdf' | 'docx' | 'markdown' | 'txt' | 'json' | 'jsonl' | 'blob';
  lastModified: string;
  /** Set when this link is part of a deliberate hard-link group. */
  linkGroupId: string | null;
}

export class DocMountDocumentsRepository extends AbstractBaseRepository<DocMountDocument> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('doc_mount_documents', DocMountDocumentSchema);
  }

  protected async getCollection(): Promise<DatabaseCollection<DocMountDocument>> {
    const db = requireMountIndexDb();

    if (!this.mountIndexCollectionInitialized) {
      try {
        const ddlStatements = generateDDL(this.collectionName, this.schema);
        for (const sql of ddlStatements) {
          db.exec(sql);
        }

        // fileId is the natural key; UNIQUE so one document per file row.
        db.exec(
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${this.collectionName}_fileId" ` +
          `ON "${this.collectionName}" ("fileId")`
        );

        // The joined views below select l.linkGroupId off doc_mount_file_links.
        // This repository's init is reachable without the links repository's
        // having run, so align that column here too rather than depending on
        // initialization order (a missing column reads as "document not found").
        ensureLinkGroupColumn(db);

        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure doc_mount_documents table in mount index database', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    const { jsonColumns, arrayColumns, booleanColumns } = classifySchemaColumns(this.collectionName, this.schema);

    return new SQLiteCollection<DocMountDocument>(
      db, this.collectionName, jsonColumns, arrayColumns, booleanColumns
    );
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<DocMountDocument, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountDocument> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<DocMountDocument>): Promise<DocMountDocument | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Content-addressable queries
  // ============================================================================

  /**
   * Fetch the document content for a given file row.
   */
  async findByFileId(fileId: string): Promise<DocMountDocument | null> {
    return this.safeQuery(
      async () => this.findOneByFilter({ fileId } as TypedQueryFilter<DocMountDocument>),
      'Error finding document by file ID',
      { fileId },
      null
    );
  }

  /**
   * Batch fetch documents for a set of file IDs. Used to hydrate many
   * documents at once when overlay loaders already have their links.
   */
  async findManyByFileIds(fileIds: string[]): Promise<DocMountDocument[]> {
    if (fileIds.length === 0) return [];
    return this.safeQuery(
      async () =>
        this.findByFilter({
          fileId: { $in: fileIds },
        } as TypedQueryFilter<DocMountDocument>),
      'Error finding documents by file IDs',
      { fileIdCount: fileIds.length },
      []
    );
  }

  // ============================================================================
  // Joined-view helpers (document + link metadata)
  // ============================================================================

  /**
   * Find a document at a (mountPointId, relativePath) location. Joins
   * through doc_mount_file_links to resolve the location; documents
   * themselves are no longer indexed by path. Returns the document content
   * with link metadata attached.
   *
   * Case-insensitive on relativePath (matches the legacy lookup the
   * vault-driven overlays depend on for `manifesto.md` vs `Manifesto.md`).
   */
  async findByMountPointAndPath(
    mountPointId: string,
    relativePath: string
  ): Promise<DocMountDocumentWithLink | null> {
    return this.safeQuery(
      async () => {
        const db = getRawMountIndexDatabase();
        if (!db) return null;
        await this.getCollection();
        const row = db.prepare(
          `SELECT
             d.id, d.fileId, d.content, d.contentSha256, d.plainTextLength,
             d.createdAt, d.updatedAt,
             l.id AS linkId, l.mountPointId, l.relativePath, l.fileName,
             l.folderId, l.lastModified, l.linkGroupId,
             f.fileType
           FROM doc_mount_file_links l
           JOIN doc_mount_documents d ON d.fileId = l.fileId
           JOIN doc_mount_files f ON f.id = l.fileId
           WHERE l.mountPointId = ? AND LOWER(l.relativePath) = LOWER(?)
           LIMIT 1`
        ).get(mountPointId, relativePath) as DocMountDocumentWithLink | undefined;
        return row ?? null;
      },
      'Error finding document by mount point and path',
      { mountPointId, relativePath },
      null
    );
  }

  /**
   * Batch resolve documents at the same relativePath across many mount
   * points. Used by overlay loaders (character properties.json, etc.) to
   * hydrate bulk character lists without N+1 queries.
   */
  async findManyByMountPointsAndPath(
    mountPointIds: string[],
    relativePath: string
  ): Promise<DocMountDocumentWithLink[]> {
    if (mountPointIds.length === 0) return [];
    return this.safeQuery(
      async () => {
        const db = getRawMountIndexDatabase();
        if (!db) return [];
        await this.getCollection();
        const placeholders = mountPointIds.map(() => '?').join(',');
        return db.prepare(
          `SELECT
             d.id, d.fileId, d.content, d.contentSha256, d.plainTextLength,
             d.createdAt, d.updatedAt,
             l.id AS linkId, l.mountPointId, l.relativePath, l.fileName,
             l.folderId, l.lastModified, l.linkGroupId,
             f.fileType
           FROM doc_mount_file_links l
           JOIN doc_mount_documents d ON d.fileId = l.fileId
           JOIN doc_mount_files f ON f.id = l.fileId
           WHERE l.mountPointId IN (${placeholders})
             AND LOWER(l.relativePath) = LOWER(?)`
        ).all(...mountPointIds, relativePath) as DocMountDocumentWithLink[];
      },
      'Error finding documents by mount point IDs and path',
      { mountPointIdCount: mountPointIds.length, relativePath },
      []
    );
  }

  /**
   * Find documents with a specific extension inside a named folder, across
   * many mount points. Used by overlay loaders that enumerate directories
   * (Prompts/*.md, Scenarios/*.md) to avoid N+1 queries.
   *
   * Default behavior (`options.recursive = false`) returns only top-level
   * files — nested folders are excluded so existing overlay loaders see the
   * same shape as before. Pass `recursive: true` to include nested files
   * (e.g. `Core/manifesto.md` + `Core/desires/love.md`).
   */
  async findManyByMountPointsInFolder(
    mountPointIds: string[],
    folder: string,
    extension: string = '.md',
    options: { recursive?: boolean } = {}
  ): Promise<DocMountDocumentWithLink[]> {
    if (mountPointIds.length === 0) return [];
    const prefix = `${folder}/`;
    const prefixLower = prefix.toLowerCase();
    const extensionLower = extension.toLowerCase();
    const recursive = options.recursive === true;
    return this.safeQuery(
      async () => {
        const db = getRawMountIndexDatabase();
        if (!db) return [];
        await this.getCollection();
        const placeholders = mountPointIds.map(() => '?').join(',');
        const rows = db.prepare(
          `SELECT
             d.id, d.fileId, d.content, d.contentSha256, d.plainTextLength,
             d.createdAt, d.updatedAt,
             l.id AS linkId, l.mountPointId, l.relativePath, l.fileName,
             l.folderId, l.lastModified, l.linkGroupId,
             f.fileType
           FROM doc_mount_file_links l
           JOIN doc_mount_documents d ON d.fileId = l.fileId
           JOIN doc_mount_files f ON f.id = l.fileId
           WHERE l.mountPointId IN (${placeholders})
             AND LOWER(l.relativePath) LIKE ?`
        ).all(...mountPointIds, `${prefixLower}%`) as DocMountDocumentWithLink[];
        return rows.filter((doc) => {
          const pathLower = doc.relativePath.toLowerCase();
          if (!pathLower.startsWith(prefixLower)) return false;
          const rest = pathLower.slice(prefixLower.length);
          if (rest.length === 0) return false;
          if (!recursive && rest.includes('/')) return false;
          return rest.endsWith(extensionLower);
        });
      },
      'Error finding documents by mount point IDs and folder',
      { mountPointIdCount: mountPointIds.length, folder, extension, recursive },
      []
    );
  }

  /**
   * Joined-view list of every document at a mount point. Uses the link
   * table to drive enumeration so the returned rows carry mountPointId,
   * relativePath, fileName, etc.
   */
  async findByMountPointId(mountPointId: string): Promise<DocMountDocumentWithLink[]> {
    return this.safeQuery(
      async () => {
        const db = getRawMountIndexDatabase();
        if (!db) return [];
        await this.getCollection();
        return db.prepare(
          `SELECT
             d.id, d.fileId, d.content, d.contentSha256, d.plainTextLength,
             d.createdAt, d.updatedAt,
             l.id AS linkId, l.mountPointId, l.relativePath, l.fileName,
             l.folderId, l.lastModified, l.linkGroupId,
             f.fileType
           FROM doc_mount_file_links l
           JOIN doc_mount_documents d ON d.fileId = l.fileId
           JOIN doc_mount_files f ON f.id = l.fileId
           WHERE l.mountPointId = ?`
        ).all(mountPointId) as DocMountDocumentWithLink[];
      },
      'Error finding documents by mount point ID',
      { mountPointId },
      []
    );
  }

  /**
   * Bulk delete every document row associated with the given mount point's
   * links. Walks doc_mount_file_links (which carries the mountPointId
   * post-refactor) and removes the matching documents. Cascade from
   * doc_mount_files only fires when the file's last link goes away —
   * the deleteByMountPointId on docMountFileLinks handles that cleanup.
   * Kept here as a convenience for code that wants to clear documents
   * without going through the link table.
   */
  async deleteByMountPointId(mountPointId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const db = getRawMountIndexDatabase();
        if (!db) return 0;
        await this.getCollection();
        const res = db.prepare(
          `DELETE FROM doc_mount_documents
           WHERE fileId IN (
             SELECT DISTINCT fileId FROM doc_mount_file_links WHERE mountPointId = ?
           )`
        ).run(mountPointId);
        return res.changes;
      },
      'Error deleting documents by mount point ID',
      { mountPointId }
    );
  }
}
