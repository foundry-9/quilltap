/**
 * Database Abstraction Layer - Help Document Chunks Repository
 *
 * Backend-agnostic repository for HelpDocChunk entities — the section-level
 * slices of each help document that section-precise semantic search runs over.
 * Includes BLOB column handling for vector embeddings.
 */

import { HelpDocChunk, HelpDocChunkSchema } from '@/lib/schemas/help-doc-chunk.types';
import { AbstractBaseRepository } from './base.repository';
import { TypedQueryFilter, DatabaseCollection } from '../interfaces';
import { registerBlobColumns } from '../manager';

/**
 * Help Document Chunks Repository
 */
export class HelpDocChunksRepository extends AbstractBaseRepository<HelpDocChunk> {
  constructor() {
    super('help_doc_chunks', HelpDocChunkSchema);
  }

  /**
   * Override getCollection to register blob columns for embedding.
   *
   * Same reasoning as HelpDocsRepository: registration is keyed to the backend,
   * so it must be re-asserted rather than remembered on the instance. A stale
   * "already registered" flag would leave a fresh backend without blob
   * handling, and the write path would then persist an index-keyed JSON object
   * (`{"0":...}`) where a BLOB belongs.
   */
  protected async getCollection(): Promise<DatabaseCollection<HelpDocChunk>> {
    await registerBlobColumns('help_doc_chunks', ['embedding']);
    return super.getCollection();
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<HelpDocChunk, 'id' | 'createdAt' | 'updatedAt'>,
    options?: import('./base.repository').CreateOptions
  ): Promise<HelpDocChunk> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<HelpDocChunk>): Promise<HelpDocChunk | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find every chunk belonging to one help document, in document order.
   */
  async findByDocId(docId: string): Promise<HelpDocChunk[]> {
    return this.safeQuery(
      async () => {
        const chunks = await this.findByFilter({ docId } as TypedQueryFilter<HelpDocChunk>);
        return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      },
      'Error finding help doc chunks by doc',
      { docId },
      []
    );
  }

  /**
   * Delete every chunk belonging to one help document.
   * Called when a doc's content changes (the old slices are meaningless) and
   * when a doc is pruned, so the rows never outlive their parent even where
   * foreign-key cascade is not enforced.
   *
   * @returns the number of chunks removed
   */
  async deleteByDocId(docId: string): Promise<number> {
    return this.safeQuery(
      async () => this.deleteMany({ docId } as TypedQueryFilter<HelpDocChunk>),
      'Error deleting help doc chunks by doc',
      { docId },
      0
    );
  }

  /**
   * Replace a document's chunks wholesale, leaving every embedding null for
   * the embedding job to fill.
   *
   * Delete-then-insert rather than a diff: chunk boundaries move when the
   * prose above them changes, so matching old rows to new ones by index would
   * preserve embeddings that no longer describe their content.
   *
   * @returns the number of chunk rows written
   */
  async replaceForDoc(
    docId: string,
    chunks: ReadonlyArray<{ chunkIndex: number; heading: string | null; content: string }>
  ): Promise<number> {
    await this.deleteByDocId(docId);

    let created = 0;
    for (const chunk of chunks) {
      await this.create({
        docId,
        chunkIndex: chunk.chunkIndex,
        heading: chunk.heading,
        content: chunk.content,
        embedding: null,
      });
      created++;
    }
    return created;
  }

  /**
   * Store the embedding for one chunk.
   */
  async updateEmbedding(id: string, embedding: Float32Array): Promise<void> {
    await this.safeQuery(
      async () => {
        await this._update(id, { embedding } as Partial<HelpDocChunk>);
      },
      'Error updating help doc chunk embedding',
      { id }
    );
  }

  /**
   * Every chunk that carries a usable embedding — the corpus help search
   * scores against.
   */
  async findAllWithEmbeddings(): Promise<HelpDocChunk[]> {
    return this.safeQuery(
      async () => {
        const all = await this._findAll();
        return all.filter(chunk => chunk.embedding != null && chunk.embedding.length > 0);
      },
      'Error finding help doc chunks with embeddings',
      {},
      []
    );
  }

  /**
   * Drop every stored chunk embedding, leaving the chunk text in place.
   * Used by a full reindex so the re-embedding pass writes into a known-empty
   * column.
   */
  async clearAllEmbeddings(): Promise<number> {
    return this.safeQuery(
      async () => this.updateMany(
        {} as TypedQueryFilter<HelpDocChunk>,
        { embedding: null } as Partial<HelpDocChunk>
      ),
      'Error clearing all help doc chunk embeddings',
      {},
      0
    );
  }

  /**
   * Remove chunks whose owning document no longer exists.
   *
   * Foreign-key cascade covers this on SQLite when `PRAGMA foreign_keys` is
   * on, but the sync path prunes docs through the repository layer and this
   * gives the sweep something to call regardless.
   *
   * @param liveDocIds IDs of the help docs that still exist
   * @returns the number of orphaned chunks removed
   */
  async deleteOrphaned(liveDocIds: ReadonlySet<string>): Promise<number> {
    return this.safeQuery(
      async () => {
        const all = await this._findAll();
        let removed = 0;
        for (const chunk of all) {
          if (!liveDocIds.has(chunk.docId)) {
            await this._delete(chunk.id);
            removed++;
          }
        }
        return removed;
      },
      'Error deleting orphaned help doc chunks',
      {},
      0
    );
  }
}

export default HelpDocChunksRepository;
