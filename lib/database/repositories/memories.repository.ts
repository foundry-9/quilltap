/**
 * Database Abstraction Layer - Memories Repository
 *
 * Backend-agnostic repository for Memory entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles CRUD operations and advanced queries for Memory entities.
 * Each memory is stored as a document in the 'memories' collection/table.
 */

import { Memory, MemorySchema } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter, DatabaseCollection } from '../interfaces';
import { rawQuery, registerBlobColumns } from '../manager';
import { chunkArray, SQLITE_VARIABLE_CHUNK_SIZE } from '@/lib/utils/chunk';

/** Maximum allowed search query length to prevent ReDoS and excessive memory usage */
const MAX_SEARCH_QUERY_LENGTH = 1000;

/**
 * Memories Repository
 * Implements CRUD operations for memories with character-scoping and advanced search capabilities.
 */
export class MemoriesRepository extends AbstractBaseRepository<Memory> {
  private blobColumnsRegistered = false;

  constructor() {
    super('memories', MemorySchema);
  }

  /**
   * Override getCollection to register blob columns for embedding.
   * The embedding column stores Float32 BLOBs after the normalize-vector-storage migration.
   * Without this registration, BLOB embeddings are not deserialized to number[] and fail
   * Zod validation, causing memories to be silently filtered out.
   */
  protected async getCollection(): Promise<DatabaseCollection<Memory>> {
    if (!this.blobColumnsRegistered) {
      await registerBlobColumns('memories', ['embedding']);
      this.blobColumnsRegistered = true;
    }
    return super.getCollection();
  }

  /**
   * Find a memory by ID
   * @param id The memory ID
   * @returns Promise<Memory | null> The memory if found, null otherwise
   */
  async findById(id: string): Promise<Memory | null> {
    return this._findById(id);
  }

  /**
   * Find all memories
   * @returns Promise<Memory[]> Array of all memories
   */
  async findAll(): Promise<Memory[]> {
    return this._findAll();
  }

  /**
   * Find a specific memory by ID for a character
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<Memory | null> The memory if found and belongs to character, null otherwise
   */
  async findByIdForCharacter(characterId: string, memoryId: string): Promise<Memory | null> {
    return this.safeQuery(
      async () => {
        const memory = await this.findOneByFilter({
          id: memoryId,
          characterId,
        });

        return memory;
      },
      'Error finding memory by ID for character',
      { characterId, memoryId },
      null
    );
  }

  /**
   * Find all memories for a specific character
   * @param characterId The character ID
   * @returns Promise<Memory[]> Array of memories for the character
   */
  async findByCharacterId(characterId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({ characterId });
        return memories;
      },
      'Error finding memories by character ID',
      { characterId },
      []
    );
  }

  /**
   * Stream a character's memories in fixed-size batches, sorted by id for a
   * stable page boundary. Housekeeping uses this so that a character with
   * tens of thousands of memories can yield to the event loop between pages
   * instead of doing one ~19k-row Zod-validated read in a single synchronous
   * chunk.
   */
  async *findByCharacterIdInBatches(
    characterId: string,
    batchSize: number,
  ): AsyncGenerator<Memory[], void, unknown> {
    if (batchSize <= 0) {
      throw new Error('batchSize must be positive');
    }
    let skip = 0;
    while (true) {
      const batch = await this.safeQuery(
        async () =>
          this.findByFilter(
            { characterId },
            { limit: batchSize, skip, sort: { id: 1 } },
          ),
        'Error loading memory batch',
        { characterId, skip, batchSize },
        [],
      );
      if (batch.length === 0) return;
      yield batch;
      if (batch.length < batchSize) return;
      skip += batchSize;
    }
  }

  /**
   * Find memories by a list of IDs. Missing IDs are silently dropped.
   * @param ids Array of memory IDs
   * @returns Promise<Memory[]> Array of memories matching any of the given IDs
   */
  async findByIds(ids: string[]): Promise<Memory[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({
          id: { $in: ids },
        } as TypedQueryFilter<Memory>);
        return memories;
      },
      'Error finding memories by IDs',
      { count: ids.length },
      []
    );
  }

  /**
   * Find memories for a character with pagination support.
   * Returns a page of memories and the total count matching the filter.
   *
   * @param characterId The character ID
   * @param options Pagination, sorting, and filtering options
   * @returns Promise with memories array and totalCount
   */
  async findByCharacterIdPaginated(
    characterId: string,
    options: {
      limit: number
      offset: number
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
      search?: string
      source?: 'AUTO' | 'MANUAL'
      minImportance?: number
    }
  ): Promise<{ memories: Memory[]; totalCount: number }> {
    return this.safeQuery(
      async () => {
        const { limit, offset, sortBy = 'createdAt', sortOrder = 'desc', search, source, minImportance } = options;

        // Build filter
        const filter: TypedQueryFilter<Memory> = { characterId };
        if (source) {
          (filter as any).source = source;
        }
        if (minImportance !== undefined) {
          (filter as any).importance = { $gte: minImportance };
        }

        // Get total count before pagination (but after filtering except search,
        // since search is applied in-memory)
        let allMatching = await this.findByFilter(filter, {
          sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 },
        });

        // Apply text search in-memory (same as existing behavior)
        if (search) {
          const searchLower = search.toLowerCase();
          allMatching = allMatching.filter((memory) =>
            memory.content.toLowerCase().includes(searchLower) ||
            memory.summary.toLowerCase().includes(searchLower) ||
            memory.keywords.some((k) => k.toLowerCase().includes(searchLower))
          );
        }

        const totalCount = allMatching.length;
        const memories = allMatching.slice(offset, offset + limit);

        return { memories, totalCount };
      },
      'Error finding paginated memories for character',
      { characterId, limit: options.limit, offset: options.offset },
      { memories: [], totalCount: 0 }
    );
  }

  /**
   * Find memories containing any of the specified keywords
   * @param characterId The character ID
   * @param keywords Array of keywords to search for
   * @returns Promise<Memory[]> Array of memories containing any keyword
   */
  async findByKeywords(characterId: string, keywords: string[]): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (keywords.length === 0) {
          return [];
        }

        const memories = await this.findByFilter({
          characterId,
          keywords: { $in: keywords },
        });
        return memories;
      },
      'Error finding memories by keywords',
      { characterId, keywordCount: keywords.length },
      []
    );
  }

  /**
   * Text search in memory content and summary
   * @param characterId The character ID
   * @param query Search query string
   * @returns Promise<Memory[]> Array of memories matching the search query
   */
  async searchByContent(characterId: string, query: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (query.length > MAX_SEARCH_QUERY_LENGTH) {
          logger.warn('Search query exceeds maximum length', {
            characterId,
            queryLength: query.length,
            maxLength: MAX_SEARCH_QUERY_LENGTH,
          });
          return [];
        }
        // Escape special regex characters to treat query as literal text
        const escapedQuery = this.escapeRegex(query);
        const regex = new RegExp(escapedQuery, 'i'); // Case-insensitive regex search

        const memories = await this.findByFilter({
          characterId,
          $or: [{ content: { $regex: regex } }, { summary: { $regex: regex } }],
        });
        return memories;
      },
      'Error searching memories by content',
      { characterId, queryLength: query.length },
      []
    );
  }

  /**
   * Find memories with importance >= minImportance threshold
   * @param characterId The character ID
   * @param minImportance Minimum importance value (0-1)
   * @returns Promise<Memory[]> Array of memories meeting importance threshold
   */
  async findByImportance(characterId: string, minImportance: number): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (minImportance < 0 || minImportance > 1) {
          logger.warn('Invalid importance threshold', { minImportance });
          return [];
        }

        const memories = await this.findByFilter({
          characterId,
          importance: { $gte: minImportance },
        });
        return memories;
      },
      'Error finding memories by importance',
      { characterId, minImportance },
      []
    );
  }

  /**
   * Find memories by source type
   * @param characterId The character ID
   * @param source Source type ('AUTO' or 'MANUAL')
   * @returns Promise<Memory[]> Array of memories with the specified source
   */
  async findBySource(characterId: string, source: 'AUTO' | 'MANUAL'): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({
          characterId,
          source,
        });
        return memories;
      },
      'Error finding memories by source',
      { characterId, source },
      []
    );
  }

  /**
   * Find the most recent memories for a character
   * @param characterId The character ID
   * @param limit Maximum number of memories to return (default: 10)
   * @returns Promise<Memory[]> Array of recent memories, sorted by creation date (newest first)
   */
  async findRecent(characterId: string, limit: number = 10): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter(
          { characterId },
          {
            sort: { createdAt: -1 },
            limit,
          }
        );
        return memories;
      },
      'Error finding recent memories',
      { characterId, limit },
      []
    );
  }

  /**
   * Find the most important memories for a character
   * @param characterId The character ID
   * @param limit Maximum number of memories to return (default: 10)
   * @returns Promise<Memory[]> Array of important memories, sorted by importance (highest first)
   */
  async findMostImportant(characterId: string, limit: number = 10): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter(
          { characterId },
          {
            sort: { importance: -1 },
            limit,
          }
        );
        return memories;
      },
      'Error finding most important memories',
      { characterId, limit },
      []
    );
  }

  /**
   * Find recent memories for a character across importance tiers.
   * Returns three arrays: high (≥0.7), medium (0.3–0.7), low (<0.3),
   * each sorted by createdAt descending (newest first).
   * Uses reinforcedImportance when available, otherwise importance.
   *
   * @param characterId The character ID
   * @param limits Optional per-tier limits (defaults: highLimit=20, mediumLimit=10, lowLimit=5)
   * @returns Promise with high, medium, and low importance memory arrays
   */
  async findRecentByImportanceTier(
    characterId: string,
    limits: { high?: number; medium?: number; low?: number } = {}
  ): Promise<{ high: Memory[]; medium: Memory[]; low: Memory[] }> {
    const highLimit = limits.high ?? 20;
    const mediumLimit = limits.medium ?? 10;
    const lowLimit = limits.low ?? 5;

    const [high, medium, low] = await Promise.all([
      this.safeQuery(
        async () => {
          const memories = await this.findByFilter(
            { characterId, importance: { $gte: 0.7 } },
            { sort: { createdAt: -1 }, limit: highLimit }
          );
          return memories;
        },
        'Error finding high-importance memories',
        { characterId, limit: highLimit },
        []
      ),
      this.safeQuery(
        async () => {
          // Medium tier: importance >= 0.3 AND < 0.7
          const allAboveLow = await this.findByFilter(
            { characterId, importance: { $gte: 0.3 } },
            { sort: { createdAt: -1 } }
          );
          // Filter out high-importance memories and apply limit
          return allAboveLow
            .filter(m => (m.reinforcedImportance ?? m.importance) < 0.7)
            .slice(0, mediumLimit);
        },
        'Error finding medium-importance memories',
        { characterId, limit: mediumLimit },
        []
      ),
      this.safeQuery(
        async () => {
          const memories = await this.findByFilter(
            { characterId, importance: { $lt: 0.3 } },
            { sort: { createdAt: -1 }, limit: lowLimit }
          );
          return memories;
        },
        'Error finding low-importance memories',
        { characterId, limit: lowLimit },
        []
      ),
    ]);

    return { high, medium, low };
  }

  /**
   * Create a new memory
   * @param data The memory data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<Memory> The created memory with generated id and timestamps
   */
  async create(
    data: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Memory> {
    return this.safeQuery(
      async () => {
        const memory = await this._create(data, options);
        return memory;
      },
      'Error creating memory',
      { characterId: data.characterId }
    );
  }

  /**
   * Update a memory
   * @param id The memory ID
   * @param data Partial memory data to update
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async update(id: string, data: Partial<Memory>): Promise<Memory | null> {
    return this.safeQuery(
      async () => {
        const memory = await this._update(id, data);
        return memory;
      },
      'Error updating memory',
      { memoryId: id }
    );
  }

  /**
   * Update a specific character's memory
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @param data Partial memory data to update
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async updateForCharacter(
    characterId: string,
    memoryId: string,
    data: Partial<Memory>
  ): Promise<Memory | null> {
    return this.safeQuery(
      async () => {
        const memory = await this.findById(memoryId);
        if (!memory) {
          logger.warn('Memory not found for update', { memoryId, characterId });
          return null;
        }

        if (memory.characterId !== characterId) {
          logger.warn('Memory does not belong to character', { characterId, memoryId });
          return null;
        }

        return await this.update(memoryId, data);
      },
      'Error updating memory for character',
      { characterId, memoryId }
    );
  }

  /**
   * Delete a memory
   * @param id The memory ID
   * @returns Promise<boolean> True if memory was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);
        return result;
      },
      'Error deleting memory',
      { memoryId: id }
    );
  }

  /**
   * Delete a specific character's memory
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<boolean> True if memory was deleted, false if not found or doesn't belong to character
   */
  async deleteForCharacter(characterId: string, memoryId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const memory = await this.findById(memoryId);
        if (!memory) {
          logger.warn('Memory not found for deletion', { memoryId, characterId });
          return false;
        }

        if (memory.characterId !== characterId) {
          logger.warn('Memory does not belong to character', { characterId, memoryId });
          return false;
        }

        return await this.delete(memoryId);
      },
      'Error deleting memory for character',
      { characterId, memoryId }
    );
  }

  /**
   * Delete multiple memories for a character
   * @param characterId The character ID
   * @param memoryIds Array of memory IDs to delete
   * @returns Promise<number> Number of memories successfully deleted
   */
  async bulkDelete(characterId: string, memoryIds: string[]): Promise<number> {
    return this.safeQuery(
      async () => {
        if (memoryIds.length === 0) {
          return 0;
        }

        // Chunked: the query translator expands `$in` to one bind variable
        // per ID, and a full-wipe cascade can exceed SQLITE_MAX_VARIABLE_NUMBER.
        let deletedCount = 0;
        for (const chunk of chunkArray(memoryIds, SQLITE_VARIABLE_CHUNK_SIZE)) {
          deletedCount += await this.deleteMany({
            characterId,
            id: { $in: chunk },
          });
        }
        return deletedCount;
      },
      'Error bulk deleting memories for character',
      { characterId, count: memoryIds.length }
    );
  }

  /**
   * Update the lastAccessedAt timestamp for a memory
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async updateAccessTime(characterId: string, memoryId: string): Promise<Memory | null> {
    return this.safeQuery(
      async () => {
        const memory = await this.findById(memoryId);
        if (!memory) {
          logger.warn('Memory not found for access time update', { memoryId, characterId });
          return null;
        }

        if (memory.characterId !== characterId) {
          logger.warn('Memory does not belong to character', { characterId, memoryId });
          return null;
        }

        const now = this.getCurrentTimestamp();
        return await this.update(memoryId, { lastAccessedAt: now });
      },
      'Error updating memory access time',
      { characterId, memoryId }
    );
  }

  /**
   * Bulk-update lastAccessedAt for a set of memories.
   * Used by the semantic search return path so the recent-access signal in the
   * blended protection score reflects actual usage. Character-scoped so a
   * compromised id list can only affect that character's rows.
   * Returns the number of rows updated.
   */
  async updateAccessTimeBulk(characterId: string, memoryIds: string[]): Promise<number> {
    return this.safeQuery(
      async () => {
        if (memoryIds.length === 0) {
          return 0;
        }
        const now = this.getCurrentTimestamp();
        return await this.updateMany(
          { characterId, id: { $in: memoryIds } },
          { lastAccessedAt: now },
        );
      },
      'Error bulk-updating memory access times',
      { characterId, count: memoryIds.length },
      0,
    );
  }

  /**
   * Count the number of memories for a character
   * @param characterId The character ID
   * @returns Promise<number> Number of memories for the character
   */
  async countByCharacterId(characterId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ characterId });
        return count;
      },
      'Error counting memories for character',
      { characterId },
      0
    );
  }

  /**
   * Count memories created for a character at or after the given ISO timestamp.
   * Used by the extraction rate-limiter.
   * @param characterId The character ID
   * @param since ISO-8601 timestamp; memories with createdAt >= since are counted
   * @returns Promise<number> Number of matching memories
   */
  async countCreatedSince(characterId: string, since: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({
          characterId,
          createdAt: { $gte: since },
        } as TypedQueryFilter<Memory>);
        return count;
      },
      'Error counting memories created since timestamp',
      { characterId, since },
      0
    );
  }

  /**
   * Count memories that are missing an embedding, optionally filtered by character.
   * A memory is "missing" if its embedding column is null (the BLOB either
   * never landed because the pre-PR-2 keyword-fallback gate wrote the row
   * without one, or a subsequent re-embed failed).
   */
  async countWithoutEmbedding(characterId?: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const filter: TypedQueryFilter<Memory> = characterId
          ? { characterId, embedding: null } as TypedQueryFilter<Memory>
          : { embedding: null } as TypedQueryFilter<Memory>;
        return await this.count(filter);
      },
      'Error counting memories without embedding',
      { characterId },
      0
    );
  }

  /**
   * Find memory IDs that are missing an embedding, optionally filtered by
   * character. Returns at most `limit` IDs per call so the caller can batch
   * the backfill through the background-job queue without overwhelming it.
   */
  async findIdsWithoutEmbedding(options: { characterId?: string; limit?: number } = {}): Promise<Array<{ id: string; characterId: string }>> {
    return this.safeQuery(
      async () => {
        const filter: TypedQueryFilter<Memory> = options.characterId
          ? { characterId: options.characterId, embedding: null } as TypedQueryFilter<Memory>
          : { embedding: null } as TypedQueryFilter<Memory>;
        const memories = await this.findByFilter(filter, {
          sort: { createdAt: -1 as any },
          limit: options.limit ?? 500,
        });
        return memories.map(m => ({ id: m.id, characterId: m.characterId }));
      },
      'Error finding memories without embedding',
      { characterId: options.characterId, limit: options.limit },
      []
    );
  }

  /**
   * Find memories that a character has about another character
   * @param characterId The character who owns the memory
   * @param aboutCharacterId The character the memory is about
   * @returns Promise<Memory[]> Array of memories about the other character
   */
  async findByCharacterAboutCharacter(
    characterId: string,
    aboutCharacterId: string
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter(
          { characterId, aboutCharacterId },
          {
            sort: { importance: -1, createdAt: -1 },
          }
        );
        return memories;
      },
      'Error finding memories about character',
      { characterId, aboutCharacterId },
      []
    );
  }

  /**
   * Find memories a character has about any of the specified characters,
   * capped per about-character via a window function so SQLite ranks and
   * truncates each partition before returning rows.
   *
   * Sort key approximates {@link calculateEffectiveWeight}: raw importance
   * dominates, with `lastReinforcedAt` (falling back to `createdAt`) breaking
   * ties so a recently-reinforced memory beats a stale one of equal score.
   *
   * The caller (context-manager) sizes `limitPerCharacter` from the
   * inter-character whisper budget plus a buffer; any further re-ranking by
   * effective weight happens in JS over this much smaller set.
   */
  async findByCharacterAboutCharacters(
    characterId: string,
    aboutCharacterIds: string[],
    limitPerCharacter: number
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (aboutCharacterIds.length === 0 || limitPerCharacter <= 0) {
          return [];
        }

        const placeholders = aboutCharacterIds.map(() => '?').join(', ');
        const sql = `
          WITH ranked AS (
            SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY aboutCharacterId
                ORDER BY importance DESC,
                         COALESCE(lastReinforcedAt, createdAt) DESC
              ) AS rn
            FROM memories
            WHERE characterId = ?
              AND aboutCharacterId IN (${placeholders})
          )
          SELECT * FROM ranked WHERE rn <= ?
        `;
        const params: unknown[] = [characterId, ...aboutCharacterIds, limitPerCharacter];

        const rows = await rawQuery<Record<string, unknown>[]>(sql, params);

        const memories: Memory[] = [];
        for (const row of rows) {
          // rn is a synthetic column; strip it before validation
          delete row.rn;

          // Hydrate JSON-encoded array columns. SQLiteCollection does this for
          // us via getCollection(); when we drop down to rawQuery to use the
          // window function, we have to do it by hand.
          for (const col of ['keywords', 'tags', 'relatedMemoryIds', 'entities']) {
            const val = row[col];
            if (typeof val === 'string') {
              try {
                row[col] = JSON.parse(val);
              } catch {
                row[col] = [];
              }
            }
          }

          const validation = MemorySchema.safeParse(row);
          if (validation.success) {
            memories.push(validation.data);
          } else {
            logger.warn('Memory failed validation in partition fetch', {
              memoryId: row.id,
              error: validation.error.message,
            });
          }
        }
        return memories;
      },
      'Error finding memories about characters',
      { characterId, aboutCharacterCount: aboutCharacterIds.length, limitPerCharacter },
      []
    );
  }

  /**
   * Find all memories associated with a specific chat
   * @param chatId The chat ID
   * @returns Promise<Memory[]> Array of memories associated with the chat
   */
  async findByChatId(chatId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({ chatId });
        return memories;
      },
      'Error finding memories by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Find all memories associated with a specific source message
   * @param sourceMessageId The source message ID
   * @returns Promise<Memory[]> Array of memories created from the message
   */
  async findBySourceMessageId(sourceMessageId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({ sourceMessageId });
        return memories;
      },
      'Error finding memories by source message ID',
      { sourceMessageId },
      []
    );
  }

  /**
   * Find a character's memories whose sourceMessageId is any of the given
   * message IDs. Used by the fold-time episode pass to link a consolidated
   * episode to the per-turn fragment memories from the same window.
   */
  async findByCharacterAndSourceMessageIds(
    characterId: string,
    sourceMessageIds: string[],
  ): Promise<Memory[]> {
    if (sourceMessageIds.length === 0) return [];
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({
          characterId,
          sourceMessageId: { $in: sourceMessageIds },
        } as TypedQueryFilter<Memory>);
        return memories;
      },
      'Error finding memories by character and source message IDs',
      { characterId, count: sourceMessageIds.length },
      []
    );
  }

  /**
   * Delete all memories associated with a specific source message
   * @param sourceMessageId The source message ID
   * @returns Promise<number> Number of memories deleted
   */
  async deleteBySourceMessageId(sourceMessageId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const deletedCount = await this.deleteMany({ sourceMessageId });
        return deletedCount;
      },
      'Error deleting memories by source message ID',
      { sourceMessageId }
    );
  }

  /**
   * Delete all memories associated with multiple source messages (for swipe groups)
   * @param sourceMessageIds Array of source message IDs
   * @returns Promise<number> Number of memories deleted
   */
  async deleteBySourceMessageIds(sourceMessageIds: string[]): Promise<number> {
    return this.safeQuery(
      async () => {
        if (sourceMessageIds.length === 0) {
          return 0;
        }

        const deletedCount = await this.deleteMany({
          sourceMessageId: { $in: sourceMessageIds },
        });
        return deletedCount;
      },
      'Error deleting memories by source message IDs',
      { count: sourceMessageIds.length }
    );
  }

  /**
   * Count memories associated with a specific source message
   * @param sourceMessageId The source message ID
   * @returns Promise<number> Number of memories for the message
   */
  async countBySourceMessageId(sourceMessageId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ sourceMessageId });
        return count;
      },
      'Error counting memories for source message',
      { sourceMessageId },
      0
    );
  }

  /**
   * Count memories associated with multiple source messages (for swipe groups)
   * @param sourceMessageIds Array of source message IDs
   * @returns Promise<number> Total number of memories
   */
  async countBySourceMessageIds(sourceMessageIds: string[]): Promise<number> {
    return this.safeQuery(
      async () => {
        if (sourceMessageIds.length === 0) {
          return 0;
        }

        const count = await this.count({
          sourceMessageId: { $in: sourceMessageIds },
        });
        return count;
      },
      'Error counting memories for source messages',
      { count: sourceMessageIds.length },
      0
    );
  }

  /**
   * Delete all memories associated with a specific chat
   * @param chatId The chat ID
   * @returns Promise<number> Number of memories deleted
   */
  async deleteByChatId(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const deletedCount = await this.deleteMany({ chatId });
        return deletedCount;
      },
      'Error deleting memories by chat ID',
      { chatId }
    );
  }

  /**
   * Count memories associated with a specific chat
   * @param chatId The chat ID
   * @returns Promise<number> Number of memories for the chat
   */
  async countByChatId(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ chatId });
        return count;
      },
      'Error counting memories for chat',
      { chatId },
      0
    );
  }

  /**
   * Count memories per chat in bulk for a set of chat IDs. Single GROUP BY
   * query — used by chat-list enrichment to avoid N+1 `countByChatId` calls.
   * Chats with zero memories are absent from the returned map.
   */
  async countByChatIds(chatIds: string[]): Promise<Map<string, number>> {
    return this.safeQuery(
      async () => {
        if (chatIds.length === 0) return new Map<string, number>();
        const placeholders = chatIds.map(() => '?').join(', ');
        const sql = `
          SELECT chatId, COUNT(*) AS count
          FROM memories
          WHERE chatId IN (${placeholders})
          GROUP BY chatId
        `;
        const rows = await rawQuery<Array<{ chatId: string; count: number | bigint }>>(sql, chatIds);
        return new Map(rows.map((r) => [r.chatId, Number(r.count)]));
      },
      'Error counting memories for chats',
      { chatIdCount: chatIds.length },
      new Map<string, number>()
    );
  }

  /**
   * Find every distinct, non-null chatId currently referenced by any memory.
   *
   * Used by the regenerate-all fan-out to spot orphan memories whose chat
   * has been deleted — much cheaper than walking each character's memories
   * individually on instances with tens of thousands of rows.
   */
  async findDistinctChatIds(): Promise<string[]> {
    return this.safeQuery(
      async () => {
        const rows = (await rawQuery<Array<{ chatId: string | null }>>(
          'SELECT DISTINCT chatId FROM memories WHERE chatId IS NOT NULL'
        )) ?? [];
        return rows
          .map((r) => r.chatId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
      },
      'Error listing distinct memory chatIds',
      {},
      []
    );
  }

  /**
   * Find every distinct characterId that owns at least one memory.
   *
   * Used by the reindex-all fan-out instead of the characters repository:
   * `characters.findAll`/`findByUserId` silently DROP characters whose vault
   * is unavailable, which would leave those characters' memories permanently
   * un-re-embedded after a profile switch. Memories are the ground truth for
   * "who needs re-embedding".
   */
  async findDistinctCharacterIds(): Promise<string[]> {
    return this.safeQuery(
      async () => {
        const rows = (await rawQuery<Array<{ characterId: string | null }>>(
          'SELECT DISTINCT characterId FROM memories WHERE characterId IS NOT NULL'
        )) ?? [];
        return rows
          .map((r) => r.characterId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
      },
      'Error listing distinct memory characterIds',
      {},
      []
    );
  }

  // ============================================================================
  // SEARCH AND REPLACE OPERATIONS
  // ============================================================================

  /**
   * Find all memories about a specific character
   * @param aboutCharacterId The character ID this memory is about
   * @returns Promise<Memory[]> Array of memories about the character
   */
  async findByAboutCharacterId(aboutCharacterId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({
          aboutCharacterId,
        });
        return memories;
      },
      'Error finding memories by aboutCharacterId',
      { aboutCharacterId },
      []
    );
  }

  /**
   * Count memories containing specific text
   * Searches in content, summary, and keywords fields
   * @param characterId Optional character ID filter
   * @param chatId Optional chat ID filter
   * @param searchText Text to search for
   * @returns Number of memories containing the text
   */
  async countMemoriesWithText(
    characterId: string | null,
    chatId: string | null,
    searchText: string
  ): Promise<number> {
    return this.safeQuery(
      async () => {
        if (searchText.length > MAX_SEARCH_QUERY_LENGTH) {
          logger.warn('Search text exceeds maximum length', {
            characterId,
            queryLength: searchText.length,
            maxLength: MAX_SEARCH_QUERY_LENGTH,
          });
          return 0;
        }
        const regex = new RegExp(this.escapeRegex(searchText), 'i');

        // Build the query filter - search in content, summary, and keywords
        const filter: TypedQueryFilter<Memory> = {
          $or: [
            { content: { $regex: regex } },
            { summary: { $regex: regex } },
            { keywords: { $regex: regex } },
          ],
        };

        if (characterId) filter.characterId = characterId;
        if (chatId) filter.chatId = chatId;

        const count = await this.count(filter);
        return count;
      },
      'Error counting memories with text',
      { characterId, chatId },
      0
    );
  }

  /**
   * Find memories containing specific text
   * Searches in content, summary, and keywords fields
   * @param characterId Optional character ID filter
   * @param chatId Optional chat ID filter
   * @param searchText Text to search for
   * @returns Array of memories containing the text
   */
  async findMemoriesWithText(
    characterId: string | null,
    chatId: string | null,
    searchText: string
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (searchText.length > MAX_SEARCH_QUERY_LENGTH) {
          logger.warn('Search text exceeds maximum length', {
            characterId,
            queryLength: searchText.length,
            maxLength: MAX_SEARCH_QUERY_LENGTH,
          });
          return [];
        }
        const regex = new RegExp(this.escapeRegex(searchText), 'i');

        // Build the query filter - search in content, summary, and keywords
        const filter: TypedQueryFilter<Memory> = {
          $or: [
            { content: { $regex: regex } },
            { summary: { $regex: regex } },
            { keywords: { $regex: regex } },
          ],
        };

        if (characterId) filter.characterId = characterId;
        if (chatId) filter.chatId = chatId;

        const memories = await this.findByFilter(filter);
        return memories;
      },
      'Error finding memories with text',
      { characterId, chatId },
      []
    );
  }

  /**
   * Replace text in memory content, summary, and keywords for specific memories
   * @param memoryIds Array of memory IDs to update
   * @param searchText Text to find
   * @param replaceText Text to replace with
   * @returns Array of updated memories (for embedding regeneration)
   */
  async replaceInMemories(
    memoryIds: string[],
    searchText: string,
    replaceText: string
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (memoryIds.length === 0) {
          return [];
        }

        const updatedMemories: Memory[] = [];

        for (const memoryId of memoryIds) {
          const memory = await this.findById(memoryId);
          if (!memory) {
            logger.warn('Memory not found for replacement', { memoryId });
            continue;
          }

          let contentChanged = false;
          let newContent = memory.content;
          let newSummary = memory.summary;
          let newKeywords = memory.keywords;

          // Replace in content
          if (memory.content.includes(searchText)) {
            newContent = memory.content.split(searchText).join(replaceText);
            contentChanged = true;
          }

          // Replace in summary
          if (memory.summary.includes(searchText)) {
            newSummary = memory.summary.split(searchText).join(replaceText);
            contentChanged = true;
          }

          // Replace in keywords array
          if (memory.keywords && memory.keywords.length > 0) {
            const updatedKeywords = memory.keywords.map(keyword => {
              if (keyword.includes(searchText)) {
                contentChanged = true;
                return keyword.split(searchText).join(replaceText);
              }
              return keyword;
            });
            newKeywords = updatedKeywords;
          }

          if (contentChanged) {
            const updated = await this.update(memoryId, {
              content: newContent,
              summary: newSummary,
              keywords: newKeywords,
            });

            if (updated) {
              updatedMemories.push(updated);
            }
          }
        }

        logger.info('Replaced text in memories', { updatedCount: updatedMemories.length });
        return updatedMemories;
      },
      'Error replacing text in memories',
      { memoryCount: memoryIds.length }
    );
  }

  /**
   * Text search in memory content and summary for memories about a specific character
   * @param characterId The character who owns the memories
   * @param aboutCharacterId The character the memories are about
   * @param query Search query string
   * @returns Promise<Memory[]> Array of memories matching the search query
   */
  async searchByContentAboutCharacter(
    characterId: string,
    aboutCharacterId: string,
    query: string
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        // Escape special regex characters to treat query as literal text
        const escapedQuery = this.escapeRegex(query);
        const regex = new RegExp(escapedQuery, 'i');

        const memories = await this.findByFilter({
          characterId,
          aboutCharacterId,
          $or: [{ content: { $regex: regex } }, { summary: { $regex: regex } }],
        });
        return memories;
      },
      'Error searching memories about character by content',
      { characterId, aboutCharacterId, queryLength: query.length },
      []
    );
  }
}
