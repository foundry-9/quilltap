/**
 * MongoDB Memories Repository
 *
 * Handles CRUD operations and advanced queries for Memory entities.
 * Each memory is stored as a document in the 'memories' MongoDB collection.
 */

import { Memory, MemorySchema } from '@/lib/schemas/types';
import { MongoBaseRepository } from './base.repository';
import { logger } from '@/lib/logger';

export class MemoriesRepository extends MongoBaseRepository<Memory> {
  constructor() {
    super('memories', MemorySchema);
    logger.debug('MemoriesRepository initialized');
  }

  /**
   * Find a memory by ID
   * @param id The memory ID
   * @returns Promise<Memory | null> The memory if found, null otherwise
   */
  async findById(id: string): Promise<Memory | null> {
    logger.debug('Finding memory by ID', { memoryId: id });
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id });

      if (!result) {
        logger.debug('Memory not found', { memoryId: id });
        return null;
      }

      const validated = this.validate(result);
      logger.debug('Memory found and validated', { memoryId: id });
      return validated;
    } catch (error) {
      logger.error('Error finding memory by ID', {
        memoryId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all memories
   * @returns Promise<Memory[]> Array of all memories
   */
  async findAll(): Promise<Memory[]> {
    logger.debug('Finding all memories');
    try {
      const collection = await this.getCollection();
      const results = await collection.find({}).toArray();

      const memories = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((memory): memory is Memory => memory !== null);

      logger.debug('Retrieved all memories', { count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding all memories', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find a specific memory by ID for a character
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<Memory | null> The memory if found and belongs to character, null otherwise
   */
  async findByIdForCharacter(characterId: string, memoryId: string): Promise<Memory | null> {
    logger.debug('Finding memory by ID for character', { characterId, memoryId });
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id: memoryId, characterId });

      if (!result) {
        logger.debug('Memory not found for character', { characterId, memoryId });
        return null;
      }

      const validated = this.validate(result);
      logger.debug('Memory found and validated', { characterId, memoryId });
      return validated;
    } catch (error) {
      logger.error('Error finding memory by ID for character', {
        characterId,
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all memories for a specific character
   * @param characterId The character ID
   * @returns Promise<Memory[]> Array of memories for the character
   */
  async findByCharacterId(characterId: string): Promise<Memory[]> {
    logger.debug('Finding memories by character ID', { characterId });
    try {
      const collection = await this.getCollection();
      const results = await collection.find({ characterId }).toArray();

      const memories = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((memory): memory is Memory => memory !== null);

      logger.debug('Found memories for character', { characterId, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding memories by character ID', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find memories containing any of the specified keywords
   * @param characterId The character ID
   * @param keywords Array of keywords to search for
   * @returns Promise<Memory[]> Array of memories containing any keyword
   */
  async findByKeywords(characterId: string, keywords: string[]): Promise<Memory[]> {
    logger.debug('Finding memories by keywords', { characterId, keywordCount: keywords.length });
    try {
      if (keywords.length === 0) {
        logger.debug('Empty keywords array provided', { characterId });
        return [];
      }

      const collection = await this.getCollection();
      const results = await collection.find({
        characterId,
        keywords: { $in: keywords },
      }).toArray();

      const memories = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((memory): memory is Memory => memory !== null);

      logger.debug('Found memories by keywords', { characterId, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding memories by keywords', {
        characterId,
        keywordCount: keywords.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Text search in memory content and summary
   * @param characterId The character ID
   * @param query Search query string
   * @returns Promise<Memory[]> Array of memories matching the search query
   */
  async searchByContent(characterId: string, query: string): Promise<Memory[]> {
    logger.debug('Searching memories by content', { characterId, queryLength: query.length });
    try {
      const collection = await this.getCollection();
      const regex = new RegExp(query, 'i'); // Case-insensitive regex search

      const results = await collection.find({
        characterId,
        $or: [
          { content: { $regex: regex } },
          { summary: { $regex: regex } },
        ],
      }).toArray();

      const memories = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((memory): memory is Memory => memory !== null);

      logger.debug('Found memories by content search', { characterId, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error searching memories by content', {
        characterId,
        queryLength: query.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find memories with importance >= minImportance threshold
   * @param characterId The character ID
   * @param minImportance Minimum importance value (0-1)
   * @returns Promise<Memory[]> Array of memories meeting importance threshold
   */
  async findByImportance(characterId: string, minImportance: number): Promise<Memory[]> {
    logger.debug('Finding memories by importance', { characterId, minImportance });
    try {
      if (minImportance < 0 || minImportance > 1) {
        logger.warn('Invalid importance threshold', { minImportance });
        return [];
      }

      const collection = await this.getCollection();
      const results = await collection.find({
        characterId,
        importance: { $gte: minImportance },
      }).toArray();

      const memories = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((memory): memory is Memory => memory !== null);

      logger.debug('Found memories by importance', { characterId, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding memories by importance', {
        characterId,
        minImportance,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find memories by source type
   * @param characterId The character ID
   * @param source Source type ('AUTO' or 'MANUAL')
   * @returns Promise<Memory[]> Array of memories with the specified source
   */
  async findBySource(characterId: string, source: 'AUTO' | 'MANUAL'): Promise<Memory[]> {
    logger.debug('Finding memories by source', { characterId, source });
    try {
      const collection = await this.getCollection();
      const results = await collection.find({
        characterId,
        source,
      }).toArray();

      const memories = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((memory): memory is Memory => memory !== null);

      logger.debug('Found memories by source', { characterId, source, count: memories.length });
      return memories;
    } catch (error) {
      logger.error('Error finding memories by source', {
        characterId,
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find the most recent memories for a character
   * @param characterId The character ID
   * @param limit Maximum number of memories to return (default: 10)
   * @returns Promise<Memory[]> Array of recent memories, sorted by creation date (newest first)
   */
  async findRecent(characterId: string, limit: number = 10): Promise<Memory[]> {
    logger.debug('Finding recent memories', { characterId, limit });
    try {
      const collection = await this.getCollection();
      const results = await collection
        .find({ characterId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      const memories = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((memory): memory is Memory => memory !== null);

      logger.debug('Found recent memories', { characterId, count: memories.length, limit });
      return memories;
    } catch (error) {
      logger.error('Error finding recent memories', {
        characterId,
        limit,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find the most important memories for a character
   * @param characterId The character ID
   * @param limit Maximum number of memories to return (default: 10)
   * @returns Promise<Memory[]> Array of important memories, sorted by importance (highest first)
   */
  async findMostImportant(characterId: string, limit: number = 10): Promise<Memory[]> {
    logger.debug('Finding most important memories', { characterId, limit });
    try {
      const collection = await this.getCollection();
      const results = await collection
        .find({ characterId })
        .sort({ importance: -1 })
        .limit(limit)
        .toArray();

      const memories = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((memory): memory is Memory => memory !== null);

      logger.debug('Found most important memories', { characterId, count: memories.length, limit });
      return memories;
    } catch (error) {
      logger.error('Error finding most important memories', {
        characterId,
        limit,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Create a new memory
   * @param data The memory data (without id, createdAt, updatedAt)
   * @returns Promise<Memory> The created memory with generated id and timestamps
   */
  async create(data: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
    logger.debug('Creating new memory', { characterId: data.characterId });
    try {
      const id = this.generateId();
      const now = this.getCurrentTimestamp();

      const memory: Memory = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(memory);
      const collection = await this.getCollection();
      await collection.insertOne(validated as any);

      logger.debug('Memory created successfully', { memoryId: id, characterId: data.characterId });
      return validated;
    } catch (error) {
      logger.error('Error creating memory', {
        characterId: data.characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a memory
   * @param id The memory ID
   * @param data Partial memory data to update
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async update(id: string, data: Partial<Memory>): Promise<Memory | null> {
    logger.debug('Updating memory', { memoryId: id });
    try {
      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Memory not found for update', { memoryId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: Memory = {
        ...existing,
        ...data,
        id: existing.id, // Preserve ID
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: now,
      };

      const validated = this.validate(updated);
      const collection = await this.getCollection();

      await collection.updateOne({ id }, { $set: validated as any });

      logger.debug('Memory updated successfully', { memoryId: id });
      return validated;
    } catch (error) {
      logger.error('Error updating memory', {
        memoryId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    logger.debug('Updating memory for character', { characterId, memoryId });
    try {
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
    } catch (error) {
      logger.error('Error updating memory for character', {
        characterId,
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a memory
   * @param id The memory ID
   * @returns Promise<boolean> True if memory was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    logger.debug('Deleting memory', { memoryId: id });
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Memory not found for deletion', { memoryId: id });
        return false;
      }

      logger.debug('Memory deleted successfully', { memoryId: id });
      return true;
    } catch (error) {
      logger.error('Error deleting memory', {
        memoryId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a specific character's memory
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<boolean> True if memory was deleted, false if not found or doesn't belong to character
   */
  async deleteForCharacter(characterId: string, memoryId: string): Promise<boolean> {
    logger.debug('Deleting memory for character', { characterId, memoryId });
    try {
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
    } catch (error) {
      logger.error('Error deleting memory for character', {
        characterId,
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete multiple memories for a character
   * @param characterId The character ID
   * @param memoryIds Array of memory IDs to delete
   * @returns Promise<number> Number of memories successfully deleted
   */
  async bulkDelete(characterId: string, memoryIds: string[]): Promise<number> {
    logger.debug('Bulk deleting memories for character', { characterId, count: memoryIds.length });
    try {
      if (memoryIds.length === 0) {
        logger.debug('Empty memory IDs array provided', { characterId });
        return 0;
      }

      const collection = await this.getCollection();
      const result = await collection.deleteMany({
        characterId,
        id: { $in: memoryIds },
      });

      logger.debug('Bulk deletion completed', { characterId, deletedCount: result.deletedCount });
      return result.deletedCount || 0;
    } catch (error) {
      logger.error('Error bulk deleting memories for character', {
        characterId,
        count: memoryIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update the lastAccessedAt timestamp for a memory
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async updateAccessTime(characterId: string, memoryId: string): Promise<Memory | null> {
    logger.debug('Updating memory access time', { characterId, memoryId });
    try {
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
    } catch (error) {
      logger.error('Error updating memory access time', {
        characterId,
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Count the number of memories for a character
   * @param characterId The character ID
   * @returns Promise<number> Number of memories for the character
   */
  async countByCharacterId(characterId: string): Promise<number> {
    logger.debug('Counting memories for character', { characterId });
    try {
      const collection = await this.getCollection();
      const count = await collection.countDocuments({ characterId });

      logger.debug('Memory count retrieved', { characterId, count });
      return count;
    } catch (error) {
      logger.error('Error counting memories for character', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
