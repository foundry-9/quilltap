/**
 * Database Abstraction Layer - Help Documents Repository
 *
 * Backend-agnostic repository for HelpDoc entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles CRUD operations for help documents used by
 * the help documentation embedding system.
 * Includes BLOB column handling for vector embeddings.
 */

import { HelpDoc, HelpDocSchema } from '@/lib/schemas/help-doc.types';
import { AbstractBaseRepository } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter, DatabaseCollection } from '../interfaces';
import { registerBlobColumns } from '../manager';

/**
 * Help Documents Repository
 *
 * Implements CRUD operations for help documents with
 * embedding storage for semantic search.
 */
export class HelpDocsRepository extends AbstractBaseRepository<HelpDoc> {
  constructor() {
    super('help_docs', HelpDocSchema);
  }

  /**
   * Override getCollection to register blob columns for embedding.
   * The embedding column stores Float32 BLOBs.
   *
   * Registration is keyed to the backend, so it must be re-asserted rather than
   * remembered on this instance: a repository outlives the backend it first ran
   * against (reconnect, or a dev-server reload), and a stale "already registered"
   * flag would leave the fresh backend without blob handling. The write path would
   * then reach JSON.stringify with a Float32Array and persist an index-keyed object
   * (`{"0":...}`) in place of the BLOB, corrupting the embedding on the next write.
   * Merging an already-registered column is a no-op, so re-asserting is cheap.
   *
   * `lib/database/manager.ts` also registers this column when it builds a backend,
   * which is what makes the common path safe; this override covers a backend built
   * elsewhere.
   */
  protected async getCollection(): Promise<DatabaseCollection<HelpDoc>> {
    await registerBlobColumns('help_docs', ['embedding']);
    return super.getCollection();
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<HelpDoc, 'id' | 'createdAt' | 'updatedAt'>,
    options?: import('./base.repository').CreateOptions
  ): Promise<HelpDoc> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<HelpDoc>): Promise<HelpDoc | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find a help document by its relative file path.
   * @param path The relative path, e.g. "help/aurora.md"
   * @returns Promise<HelpDoc | null> The document if found
   */
  async findByPath(path: string): Promise<HelpDoc | null> {
    return this.safeQuery(
      async () => {
        return this.findOneByFilter({ path } as TypedQueryFilter<HelpDoc>);
      },
      'Error finding help doc by path',
      { path },
      null
    );
  }

  /**
   * Insert or update a help document by its file path.
   * If a doc with this path already exists, updates content fields
   * (title, url, content, contentHash) but preserves the existing embedding.
   * If no doc exists, creates a new one.
   *
   * @param path The relative file path
   * @param data The document data (excluding id, timestamps, and embedding)
   * @returns Promise<HelpDoc> The created or updated document
   */
  async upsertByPath(
    path: string,
    data: Omit<HelpDoc, 'id' | 'createdAt' | 'updatedAt' | 'embedding'>
  ): Promise<HelpDoc> {
    return this.safeQuery(
      async () => {
        const existing = await this.findByPath(path);
        if (existing) {

          const updated = await this._update(existing.id, {
            title: data.title,
            url: data.url,
            content: data.content,
            contentHash: data.contentHash,
          });
          if (!updated) throw new Error(`Failed to update help doc: ${path}`);
          return updated;
        }

        return this._create(data as Omit<HelpDoc, 'id' | 'createdAt' | 'updatedAt'>);
      },
      'Error upserting help doc',
      { path }
    );
  }

  /**
   * Update just the embedding field on a help document.
   * @param id The document ID
   * @param embedding The new embedding vector
   */
  async updateEmbedding(id: string, embedding: Float32Array): Promise<void> {
    await this.safeQuery(
      async () => {
        const updated = await this._update(id, {
          embedding,
        } as Partial<HelpDoc>);

        if (!updated) {
          throw new Error(`Help doc not found for embedding update: ${id}`);
        }
      },
      'Error updating help doc embedding',
      { id }
    );
  }

  /**
   * Clear all embeddings by setting them to null.
   * Useful when the embedding model changes and all docs need re-embedding.
   * @returns Promise<number> The number of documents modified
   */
  async clearAllEmbeddings(): Promise<number> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const result = await collection.updateMany(
          {},
          { $set: { embedding: null, updatedAt: this.getCurrentTimestamp() } }
        );

        return result.modifiedCount;
      },
      'Error clearing all help doc embeddings',
      {},
      0
    );
  }

  /**
   * Clear the embedding for a single help document.
   * Used when a doc's content changes and its embedding is no longer valid.
   * @param id The document ID
   */
  async clearAllEmbeddingsForDoc(id: string): Promise<void> {
    await this.safeQuery(
      async () => {
        await this._update(id, { embedding: null } as Partial<HelpDoc>);
      },
      'Error clearing help doc embedding',
      { id }
    );
  }

  /**
   * Find all help documents that have embeddings (non-null, non-empty array).
   * Used for semantic search over help content.
   * @returns Promise<HelpDoc[]> Array of documents with embeddings
   */
  async findAllWithEmbeddings(): Promise<HelpDoc[]> {
    return this.safeQuery(
      async () => {
        const allDocs = await this._findAll();
        return allDocs.filter(
          doc => doc.embedding != null && doc.embedding.length > 0
        );
      },
      'Error finding help docs with embeddings',
      {},
      []
    );
  }

  /**
   * Find all help documents that need embedding (embedding is null).
   * Used to identify docs that need to be sent through the embedding pipeline.
   * @returns Promise<HelpDoc[]> Array of documents needing embeddings
   */
  async findAllNeedingEmbedding(): Promise<HelpDoc[]> {
    return this.safeQuery(
      async () => {
        const allDocs = await this._findAll();
        return allDocs.filter(doc => doc.embedding == null);
      },
      'Error finding help docs needing embedding',
      {},
      []
    );
  }
}
