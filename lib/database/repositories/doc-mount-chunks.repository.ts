/**
 * Document Mount Chunks Repository
 *
 * Backend-agnostic repository for DocMountChunk entities. Chunks are now
 * keyed by linkId — one set of chunks per (mountPoint, relativePath) hard
 * link, so two consumers hard-linking the same content can re-extract /
 * re-embed independently.
 *
 * Includes BLOB column handling for vector embeddings — the `embedding`
 * column stores Float32 BLOBs that need special deserialization.
 *
 * When the mount index DB is in degraded mode, getCollection() throws and
 * all safeQuery fallbacks kick in.
 */

import { logger } from '@/lib/logger';
import {
  DocMountChunk,
  DocMountChunkSchema,
  EDITABLE_TEXT_FILE_TYPES,
} from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '../backends/sqlite/mount-index-client';
import { generateDDL, extractSchemaMetadata } from '../schema-translator';
import { invalidateMountPoint } from '@/lib/mount-index/mount-chunk-cache';
import { LIKE_ESCAPE_CHAR, likeContainsPattern } from './like-escape';

/**
 * A chunk matched by {@link DocMountChunksRepository.searchContent}, already
 * joined to its link row so the caller can render the document's location
 * without a second lookup. One row per document, not per chunk.
 */
export interface DocMountChunkTextMatch {
  linkId: string;
  mountPointId: string;
  relativePath: string;
  fileName: string;
  updatedAt: string;
  chunkIndex: number;
  content: string;
  headingContext: string | null;
}

export class DocMountChunksRepository extends AbstractBaseRepository<DocMountChunk> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('doc_mount_chunks', DocMountChunkSchema);
  }

  protected async getCollection(): Promise<DatabaseCollection<DocMountChunk>> {
    if (isMountIndexDegraded()) {
      throw new Error('Mount index database is in degraded mode');
    }

    const db = getRawMountIndexDatabase();
    if (!db) {
      throw new Error('Mount index database not initialized');
    }

    if (!this.mountIndexCollectionInitialized) {
      try {
        const ddlStatements = generateDDL(this.collectionName, this.schema);
        for (const sql of ddlStatements) {
          db.exec(sql);
        }

        db.exec(
          `CREATE INDEX IF NOT EXISTS "idx_${this.collectionName}_linkId" ` +
          `ON "${this.collectionName}" ("linkId")`
        );
        db.exec(
          `CREATE INDEX IF NOT EXISTS "idx_${this.collectionName}_mp" ` +
          `ON "${this.collectionName}" ("mountPointId")`
        );

        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure doc_mount_chunks table in mount index database', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    const metadata = extractSchemaMetadata(this.collectionName, this.schema);
    const jsonColumns = metadata.fields
      .filter(f => f.type === 'array' || f.type === 'object')
      .map(f => f.name);
    const arrayColumns = metadata.fields
      .filter(f => f.type === 'array')
      .map(f => f.name);
    const booleanColumns = metadata.fields
      .filter(f => f.type === 'boolean')
      .map(f => f.name);

    // Float32 BLOBs in the embedding column need explicit blob-column
    // handling so they're deserialized to Float32Array instead of being
    // run through JSON.parse.
    const blobColumns = ['embedding'];

    return new SQLiteCollection<DocMountChunk>(
      db, this.collectionName, jsonColumns, arrayColumns, booleanColumns, blobColumns
    );
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<DocMountChunk, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountChunk> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<DocMountChunk>): Promise<DocMountChunk | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find all chunks for a link, ordered by chunkIndex.
   */
  async findByLinkId(linkId: string): Promise<DocMountChunk[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter(
          { linkId } as TypedQueryFilter<DocMountChunk>,
          { sort: { chunkIndex: 1 } }
        );
        return results;
      },
      'Error finding chunks by link ID',
      { linkId },
      []
    );
  }

  /**
   * Find all chunks for a mount point.
   */
  async findByMountPointId(mountPointId: string): Promise<DocMountChunk[]> {
    return this.safeQuery(
      async () => this.findByFilter({ mountPointId } as TypedQueryFilter<DocMountChunk>),
      'Error finding chunks by mount point ID',
      { mountPointId },
      []
    );
  }

  /**
   * Count embedded chunks per mount point without hydrating the embeddings.
   * Single GROUP BY query — avoids the multi-megabyte BLOB decode that
   * findAllWithEmbeddingsByMountPointIds incurs when the caller only wants
   * counts (e.g. the Scriptorium settings UI).
   */
  async countEmbeddedByMountPointIds(mountPointIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (mountPointIds.length === 0) return result;

    return this.safeQuery(
      async () => {
        if (isMountIndexDegraded()) return result;
        const db = getRawMountIndexDatabase();
        if (!db) return result;

        const placeholders = mountPointIds.map(() => '?').join(',');
        const rows = db.prepare(
          `SELECT mountPointId, COUNT(*) AS count
           FROM doc_mount_chunks
           WHERE mountPointId IN (${placeholders}) AND embedding IS NOT NULL
           GROUP BY mountPointId`
        ).all(...mountPointIds) as { mountPointId: string; count: number }[];

        for (const row of rows) {
          result.set(row.mountPointId, row.count);
        }
        return result;
      },
      'Error counting embedded chunks by mount point IDs',
      { mountPointIdCount: mountPointIds.length },
      result
    );
  }

  /**
   * Substring-search chunk text across a set of mount points, returning one
   * row per matching document (the lowest-index matching chunk). Powers the
   * content half of the global search bar's Documents chip
   * ({@link ../../mount-index/document-text-search}).
   *
   * The `GROUP BY c.linkId` with `MIN(c.chunkIndex)` relies on SQLite's
   * documented bare-column rule: when a query has a single `min()`/`max()`
   * aggregate, the bare columns come from the row that produced it — so
   * `content` and `headingContext` belong to the earliest matching chunk, not
   * an arbitrary one. `l.*` columns are constant within a group (the join is
   * 1:1 on linkId).
   *
   * Scoped to {@link EDITABLE_TEXT_FILE_TYPES} to match
   * `searchByNameOrPath`; `%`/`_` in the user's query are escaped so they
   * match literally, and `LIMIT` caps the scan.
   */
  async searchContent(
    query: string,
    mountPointIds: string[],
    limit: number
  ): Promise<DocMountChunkTextMatch[]> {
    if (mountPointIds.length === 0 || query.length === 0) return [];
    return this.safeQuery(
      async () => {
        if (isMountIndexDegraded()) return [];
        const db = getRawMountIndexDatabase();
        if (!db) return [];
        await this.getCollection();

        const placeholders = mountPointIds.map(() => '?').join(',');
        const typePlaceholders = EDITABLE_TEXT_FILE_TYPES.map(() => '?').join(',');
        const pattern = likeContainsPattern(query);

        const rows = db.prepare(
          `SELECT c.linkId AS linkId,
                  MIN(c.chunkIndex) AS chunkIndex,
                  c.content AS content,
                  c.headingContext AS headingContext,
                  l.mountPointId AS mountPointId,
                  l.relativePath AS relativePath,
                  l.fileName AS fileName,
                  l.updatedAt AS updatedAt
             FROM doc_mount_chunks c
             JOIN doc_mount_file_links l ON l.id = c.linkId
             JOIN doc_mount_files f ON f.id = l.fileId
            WHERE c.mountPointId IN (${placeholders})
              AND f.fileType IN (${typePlaceholders})
              AND LOWER(c.content) LIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}'
            GROUP BY c.linkId
            ORDER BY l.updatedAt DESC
            LIMIT ?`
        ).all(
          ...mountPointIds,
          ...EDITABLE_TEXT_FILE_TYPES,
          pattern,
          limit
        ) as DocMountChunkTextMatch[];

        return rows;
      },
      'Error searching chunk content',
      { mountPointIdCount: mountPointIds.length, queryLength: query.length },
      []
    );
  }

  /**
   * Find all chunks with non-null embeddings for a set of mount point IDs.
   */
  async findAllWithEmbeddingsByMountPointIds(mountPointIds: string[]): Promise<DocMountChunk[]> {
    return this.safeQuery(
      async () => {
        if (mountPointIds.length === 0) {
          return [];
        }

        const allChunks: DocMountChunk[] = [];
        for (const mountPointId of mountPointIds) {
          const chunks = await this.findByFilter(
            { mountPointId } as TypedQueryFilter<DocMountChunk>
          );
          allChunks.push(...chunks);
        }

        const withEmbeddings = allChunks.filter(
          chunk => chunk.embedding != null && chunk.embedding.length > 0
        );

        return withEmbeddings;
      },
      'Error finding chunks with embeddings by mount point IDs',
      { mountPointIdCount: mountPointIds.length },
      []
    );
  }

  /**
   * NULL out the embedding for every chunk of a link without deleting the
   * chunk rows. Used to enforce `embed:false`: the chunk text survives for
   * non-RAG uses and can be re-embedded if the flag flips back, but the
   * vectors are gone so the document can't surface in semantic retrieval.
   * Returns the number of chunks whose embedding was cleared (already-NULL
   * rows are not recounted). Invalidates the mount-chunk cache when it
   * actually clears anything.
   */
  async clearEmbeddingsByLinkId(linkId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        if (isMountIndexDegraded()) return 0;
        const db = getRawMountIndexDatabase();
        if (!db) return 0;

        const mp = db.prepare(
          'SELECT mountPointId FROM doc_mount_chunks WHERE linkId = ? LIMIT 1'
        ).get(linkId) as { mountPointId: string } | undefined;

        const res = db.prepare(
          'UPDATE doc_mount_chunks SET embedding = NULL WHERE linkId = ? AND embedding IS NOT NULL'
        ).run(linkId);

        if (res.changes > 0 && mp?.mountPointId) {
          invalidateMountPoint(mp.mountPointId);
        }
        return res.changes;
      },
      'Error clearing embeddings by link ID',
      { linkId },
      0
    );
  }

  /**
   * Delete all chunks for a link.
   */
  async deleteByLinkId(linkId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const sample = await this.findByFilter(
          { linkId } as TypedQueryFilter<DocMountChunk>,
          { limit: 1 }
        );
        const mountPointId = sample[0]?.mountPointId;
        const count = await this.deleteMany(
          { linkId } as TypedQueryFilter<DocMountChunk>
        );
        if (mountPointId) {
          invalidateMountPoint(mountPointId);
        }
        return count;
      },
      'Error deleting chunks by link ID',
      { linkId }
    );
  }

  /**
   * Delete all chunks for a mount point.
   */
  async deleteByMountPointId(mountPointId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.deleteMany(
          { mountPointId } as TypedQueryFilter<DocMountChunk>
        );
        invalidateMountPoint(mountPointId);
        return count;
      },
      'Error deleting chunks by mount point ID',
      { mountPointId }
    );
  }

  /**
   * Update the embedding vector for a chunk.
   */
  async updateEmbedding(id: string, embedding: Float32Array): Promise<void> {
    await this.safeQuery(
      async () => {
        const updated = await this._update(id, {
          embedding,
        } as Partial<DocMountChunk>);

        if (!updated) {
          throw new Error(`Doc mount chunk not found for embedding update: ${id}`);
        }

        // Invalidate the in-memory mount-chunk cache: until embedding lands,
        // findAllWithEmbeddingsByMountPointIds excludes this chunk, so the
        // cache that powers searchDocumentChunks won't surface it on its own.
        invalidateMountPoint(updated.mountPointId);
      },
      'Error updating doc mount chunk embedding',
      { id }
    );
  }

  // ============================================================================
  // Legacy-name aliases — callers that used to hold a "fileId" actually held a
  // link id under the old 1:1 schema. After the content/link split they hold
  // the link's UUID. These aliases let those callers keep their variable
  // names while gradually migrating.
  // ============================================================================

  /** Alias for findByLinkId. The argument now is treated as a linkId. */
  async findByFileId(linkId: string): Promise<DocMountChunk[]> {
    return this.findByLinkId(linkId);
  }

  /** Alias for deleteByLinkId. The argument now is treated as a linkId. */
  async deleteByFileId(linkId: string): Promise<number> {
    return this.deleteByLinkId(linkId);
  }

  /**
   * Bulk insert multiple chunks. The ORM does not support native bulk
   * insert, so this iterates and calls _create for each chunk.
   */
  async bulkInsert(
    chunks: Array<Omit<DocMountChunk, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<DocMountChunk[]> {
    return this.safeQuery(
      async () => {
        const created: DocMountChunk[] = [];
        for (const chunk of chunks) {
          const result = await this._create(chunk);
          created.push(result);
        }

        // Invalidate the mount-chunk cache for every mount touched. See
        // updateEmbedding for the cache-staleness reasoning.
        const touchedMounts = new Set<string>();
        for (const chunk of chunks) {
          if (chunk.mountPointId) touchedMounts.add(chunk.mountPointId);
        }
        for (const mountPointId of touchedMounts) {
          invalidateMountPoint(mountPointId);
        }

        return created;
      },
      'Error bulk inserting doc mount chunks',
      { count: chunks.length }
    );
  }
}
