/**
 * Database Abstraction Layer - Conversation Chunks Repository
 *
 * Backend-agnostic repository for ConversationChunk entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles CRUD operations for conversation chunks used by
 * Project Scriptorium's conversation embedding system.
 * Includes BLOB column handling for vector embeddings.
 */

import {
  ConversationChunk,
  ConversationChunkInput,
  ConversationChunkSchema,
} from '@/lib/schemas/types';
import { AbstractBaseRepository } from './base.repository';
import { TypedQueryFilter, DatabaseCollection } from '../interfaces';
import { rawQuery, registerBlobColumns } from '../manager';

/**
 * Conversation Chunks Repository
 * Implements CRUD operations for conversation chunks with
 * chat-scoping and embedding storage.
 */
export class ConversationChunksRepository extends AbstractBaseRepository<ConversationChunk> {
  private blobColumnsRegistered = false;

  constructor() {
    super('conversation_chunks', ConversationChunkSchema);
  }

  /**
   * Override getCollection to register blob columns for embedding.
   * The embedding column stores Float32 BLOBs.
   * Without this registration, BLOB embeddings are not deserialized to number[] and fail
   * Zod validation, causing chunks to be silently filtered out.
   */
  protected async getCollection(): Promise<DatabaseCollection<ConversationChunk>> {
    if (!this.blobColumnsRegistered) {
      await registerBlobColumns('conversation_chunks', ['embedding']);
      this.blobColumnsRegistered = true;
    }
    return super.getCollection();
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<ConversationChunk, 'id' | 'createdAt' | 'updatedAt'>,
    options?: import('./base.repository').CreateOptions
  ): Promise<ConversationChunk> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<ConversationChunk>): Promise<ConversationChunk | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Total + embedded chunk counts per chat in bulk. One GROUP BY query —
   * lets chat-list enrichment derive Scriptorium status without an N+1 walk
   * of `findByChatId`. Chats with zero chunks are absent from the map.
   */
  async countByChatIds(
    chatIds: string[]
  ): Promise<Map<string, { total: number; embedded: number }>> {
    return this.safeQuery(
      async () => {
        if (chatIds.length === 0) {
          return new Map<string, { total: number; embedded: number }>();
        }
        const placeholders = chatIds.map(() => '?').join(', ');
        const sql = `
          SELECT chatId,
                 COUNT(*) AS total,
                 SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS embedded
          FROM conversation_chunks
          WHERE chatId IN (${placeholders})
          GROUP BY chatId
        `;
        const rows = await rawQuery<
          Array<{ chatId: string; total: number | bigint; embedded: number | bigint | null }>
        >(sql, chatIds);
        return new Map(
          rows.map((r) => [
            r.chatId,
            { total: Number(r.total), embedded: Number(r.embedded ?? 0) },
          ])
        );
      },
      'Error counting conversation chunks for chats',
      { chatIdCount: chatIds.length },
      new Map<string, { total: number; embedded: number }>()
    );
  }

  /**
   * Find all chunks for a chat, ordered by interchangeIndex
   * @param chatId The chat ID
   * @returns Promise<ConversationChunk[]> Array of chunks for the chat
   */
  async findByChatId(chatId: string): Promise<ConversationChunk[]> {
    return this.safeQuery(
      async () => {
        const chunks = await this.findByFilter(
          { chatId } as TypedQueryFilter<ConversationChunk>,
          { sort: { interchangeIndex: 1 } }
        );
        return chunks;
      },
      'Error finding chunks by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Find a specific chunk by chat ID and interchange index
   * @param chatId The chat ID
   * @param interchangeIndex The interchange index
   * @returns Promise<ConversationChunk | null> The chunk if found
   */
  async findByInterchangeIndex(
    chatId: string,
    interchangeIndex: number
  ): Promise<ConversationChunk | null> {
    return this.safeQuery(
      async () => {
        return this.findOneByFilter({
          chatId,
          interchangeIndex,
        } as TypedQueryFilter<ConversationChunk>);
      },
      'Error finding chunk by interchange index',
      { chatId, interchangeIndex },
      null
    );
  }

  /**
   * Insert or update a chunk.
   * If an existing chunk is found for the chatId+interchangeIndex, it is updated;
   * otherwise a new one is created with a generated ID.
   *
   * @param input The chunk input data
   * @returns Promise<ConversationChunk> The created or updated chunk
   */
  async upsert(input: ConversationChunkInput): Promise<ConversationChunk> {
    return this.safeQuery(
      async () => {
        const existing = await this.findOneByFilter({
          chatId: input.chatId,
          interchangeIndex: input.interchangeIndex,
        } as TypedQueryFilter<ConversationChunk>);

        if (existing) {

          // Only update content fields — preserve existing embedding
          // Embeddings are managed separately via updateEmbedding()
          const updateData: Partial<ConversationChunk> = {
            content: input.content,
            participantNames: input.participantNames,
            messageIds: input.messageIds,
          };
          // Only overwrite embedding if explicitly provided (non-undefined)
          if (input.embedding !== undefined) {
            updateData.embedding = input.embedding;
          }

          const updated = await this._update(existing.id, updateData);

          if (!updated) {
            throw new Error(`Failed to update chunk ${existing.id}`);
          }
          return updated;
        }

        return this._create(input as Omit<ConversationChunk, 'id' | 'createdAt' | 'updatedAt'>);
      },
      'Error upserting conversation chunk',
      { chatId: input.chatId, interchangeIndex: input.interchangeIndex }
    );
  }

  /**
   * Find all chunks that have embeddings (non-null embedding field)
   * Used by Scriptorium search to find semantically searchable chunks.
   * @returns Promise<ConversationChunk[]> Array of chunks with embeddings
   */
  async findAllWithEmbeddings(): Promise<ConversationChunk[]> {
    return this.safeQuery(
      async () => {
        const allChunks = await this._findAll();
        return allChunks.filter(
          chunk => chunk.embedding != null && chunk.embedding.length > 0
        );
      },
      'Error finding chunks with embeddings',
      {},
      []
    );
  }

  /**
   * Delete all chunks for a chat
   * @param chatId The chat ID
   */
  async deleteAllForChat(chatId: string): Promise<void> {
    await this.safeQuery(
      async () => {
        const count = await this.deleteMany({ chatId } as TypedQueryFilter<ConversationChunk>);
      },
      'Error deleting all chunks for chat',
      { chatId }
    );
  }

  /**
   * Cold-tier a chat's chunks: NULL every non-null embedding while keeping
   * `content`/`messageIds`/`interchangeIndex` intact, so the chat stays
   * keyword-searchable and can be re-embedded (embed-only, no re-chunk) when
   * reopened. Idempotent — the `embedding IS NOT NULL` guard makes a second
   * pass a no-op. Returns the number of rows cleared.
   *
   * `olderThan` (ISO-8601) restricts clearing to embeddings last written
   * before that moment. The maintenance sweep passes its staleness cutoff
   * here so an embedding minted by the reopen path (`cold-chunk-reembed`)
   * survives for a full retention window from the reopen: a chat the user
   * reads — without playing a message — stays semantically searchable
   * instead of being re-embedded (paid) on every open and cleared again by
   * every sweep. The embedding row's own `updatedAt` is the reopen signal;
   * nothing else writes chunk rows on a stale chat, because renders only
   * fire on played messages and the boot reconcile skips stale chats.
   *
   * Raw SQL rather than `_update` so a maintenance pass over a large stale
   * chat is one statement, and so `updatedAt` stamping stays explicit.
   */
  async clearEmbeddingsForChat(chatId: string, olderThan?: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const ageGuard = olderThan !== undefined ? ' AND updatedAt < ?' : '';
        const params: string[] = [new Date().toISOString(), chatId];
        if (olderThan !== undefined) params.push(olderThan);
        const result = await rawQuery<{ changes: number }>(
          `UPDATE conversation_chunks SET embedding = NULL, updatedAt = ?
            WHERE chatId = ? AND embedding IS NOT NULL${ageGuard}`,
          params
        );
        const cleared = Number(result?.changes ?? 0);
        return cleared;
      },
      'Error clearing chunk embeddings for chat',
      { chatId, olderThan },
      0
    );
  }

  /**
   * Update just the embedding field on a chunk
   * @param id The chunk ID
   * @param embedding The new embedding vector
   */
  async updateEmbedding(id: string, embedding: Float32Array): Promise<void> {
    await this.safeQuery(
      async () => {
        const updated = await this._update(id, {
          embedding,
        } as Partial<ConversationChunk>);

        if (!updated) {
          throw new Error(`Chunk not found for embedding update: ${id}`);
        }
      },
      'Error updating chunk embedding',
      { id }
    );
  }
}
