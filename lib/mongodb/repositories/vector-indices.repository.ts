/**
 * MongoDB Vector Indices Repository
 *
 * Stores character vector indices (embeddings for semantic search) in MongoDB.
 * Each document represents a complete vector index for a single character.
 */

import { Collection } from 'mongodb';
import { z } from 'zod';
import { getMongoDatabase } from '../client';
import { logger } from '@/lib/logger';

/**
 * Schema for a single vector entry
 */
const VectorEntrySchema = z.object({
  id: z.string(),
  embedding: z.array(z.number()),
  metadata: z.object({
    memoryId: z.string(),
    characterId: z.string(),
    content: z.string().optional(),
  }).passthrough(),
  createdAt: z.string(),
});

/**
 * Schema for a complete vector index document
 */
const VectorIndexSchema = z.object({
  id: z.string(), // characterId
  characterId: z.string(),
  version: z.number(),
  dimensions: z.number(),
  entries: z.array(VectorEntrySchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type VectorEntry = z.infer<typeof VectorEntrySchema>;
export type VectorIndex = z.infer<typeof VectorIndexSchema>;

/**
 * MongoDB repository for vector indices
 */
export class MongoVectorIndicesRepository {
  private readonly collectionName = 'vector_indices';

  /**
   * Get the MongoDB collection
   */
  private async getCollection(): Promise<Collection<VectorIndex>> {
    const db = await getMongoDatabase();
    logger.debug('Retrieved MongoDB vector_indices collection', {
      context: 'MongoVectorIndicesRepository',
    });
    return db.collection<VectorIndex>(this.collectionName);
  }

  /**
   * Find a vector index by character ID
   */
  async findByCharacterId(characterId: string): Promise<VectorIndex | null> {
    try {
      logger.debug('Finding vector index by character ID', {
        context: 'MongoVectorIndicesRepository.findByCharacterId',
        characterId,
      });

      const collection = await this.getCollection();
      const doc = await collection.findOne({ characterId });

      if (!doc) {
        logger.debug('Vector index not found', { characterId });
        return null;
      }

      // Validate and return
      const validated = VectorIndexSchema.parse(doc);
      logger.debug('Vector index found', {
        characterId,
        entryCount: validated.entries.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding vector index', {
        context: 'MongoVectorIndicesRepository.findByCharacterId',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Save a complete vector index for a character
   * Uses upsert to create or replace the entire index
   */
  async save(characterId: string, index: Omit<VectorIndex, 'id'>): Promise<VectorIndex> {
    try {
      logger.debug('Saving vector index', {
        context: 'MongoVectorIndicesRepository.save',
        characterId,
        entryCount: index.entries.length,
      });

      const collection = await this.getCollection();
      const now = new Date().toISOString();

      const doc: VectorIndex = {
        ...index,
        id: characterId,
        characterId,
        updatedAt: now,
      };

      await collection.updateOne(
        { characterId },
        { $set: doc },
        { upsert: true }
      );

      logger.debug('Vector index saved', { characterId });
      return doc;
    } catch (error) {
      logger.error('Error saving vector index', {
        context: 'MongoVectorIndicesRepository.save',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a vector index by character ID
   */
  async delete(characterId: string): Promise<boolean> {
    try {
      logger.debug('Deleting vector index', {
        context: 'MongoVectorIndicesRepository.delete',
        characterId,
      });

      const collection = await this.getCollection();
      const result = await collection.deleteOne({ characterId });

      const deleted = result.deletedCount > 0;
      logger.debug('Vector index deletion result', { characterId, deleted });
      return deleted;
    } catch (error) {
      logger.error('Error deleting vector index', {
        context: 'MongoVectorIndicesRepository.delete',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Check if a vector index exists for a character
   */
  async exists(characterId: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      const count = await collection.countDocuments({ characterId }, { limit: 1 });
      return count > 0;
    } catch (error) {
      logger.error('Error checking vector index existence', {
        context: 'MongoVectorIndicesRepository.exists',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get all character IDs that have vector indices
   */
  async getAllCharacterIds(): Promise<string[]> {
    try {
      const collection = await this.getCollection();
      const docs = await collection
        .find({}, { projection: { characterId: 1 } })
        .toArray();
      return docs.map((d) => d.characterId);
    } catch (error) {
      logger.error('Error getting all character IDs', {
        context: 'MongoVectorIndicesRepository.getAllCharacterIds',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

// Singleton instance
let instance: MongoVectorIndicesRepository | null = null;

export function getMongoVectorIndicesRepository(): MongoVectorIndicesRepository {
  if (!instance) {
    instance = new MongoVectorIndicesRepository();
  }
  return instance;
}
