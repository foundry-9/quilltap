/**
 * MongoDB Embedding Profiles Repository
 *
 * Handles CRUD operations for EmbeddingProfile entities in MongoDB.
 * Provides methods for managing embedding profiles and their relationships with tags.
 * Uses the 'embedding_profiles' collection.
 */

import { Collection } from 'mongodb';
import {
  EmbeddingProfile,
  EmbeddingProfileSchema,
} from '@/lib/json-store/schemas/types';
import { logger } from '@/lib/logger';
import { MongoBaseRepository } from './base.repository';

/**
 * Embedding Profiles Repository
 * Manages EmbeddingProfile entities
 */
export class EmbeddingProfilesRepository extends MongoBaseRepository<EmbeddingProfile> {
  constructor() {
    super('embedding_profiles', EmbeddingProfileSchema);
  }

  // ============================================================================
  // EMBEDDING PROFILE OPERATIONS
  // ============================================================================

  /**
   * Find an embedding profile by ID
   */
  async findById(id: string): Promise<EmbeddingProfile | null> {
    try {
      logger.debug('Finding embedding profile by ID', {
        profileId: id,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const doc = await collection.findOne({ id });

      if (!doc) {
        logger.debug('Embedding profile not found', { profileId: id });
        return null;
      }

      const validated = this.validate(doc);
      logger.debug('Embedding profile found and validated', { profileId: id });
      return validated;
    } catch (error) {
      logger.error('Error finding embedding profile by ID', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all embedding profiles
   */
  async findAll(): Promise<EmbeddingProfile[]> {
    try {
      logger.debug('Finding all embedding profiles', { collection: this.collectionName });

      const collection = await this.getCollection();
      const docs = await collection.find({}).toArray();

      logger.debug('Retrieved embedding profiles from database', { count: docs.length });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('All embedding profiles validated', {
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding all embedding profiles', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find embedding profiles by user ID
   */
  async findByUserId(userId: string): Promise<EmbeddingProfile[]> {
    try {
      logger.debug('Finding embedding profiles by user ID', {
        userId,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const docs = await collection.find({ userId }).toArray();

      logger.debug('Retrieved embedding profiles for user', {
        userId,
        count: docs.length,
      });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('User embedding profiles validated', {
        userId,
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding embedding profiles by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find embedding profiles with a specific tag
   */
  async findByTag(tagId: string): Promise<EmbeddingProfile[]> {
    try {
      logger.debug('Finding embedding profiles by tag', {
        tagId,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const docs = await collection.find({ tags: tagId }).toArray();

      logger.debug('Retrieved embedding profiles with tag', {
        tagId,
        count: docs.length,
      });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('Tag embedding profiles validated', {
        tagId,
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding embedding profiles by tag', {
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find default embedding profile for user
   */
  async findDefault(userId: string): Promise<EmbeddingProfile | null> {
    try {
      logger.debug('Finding default embedding profile for user', {
        userId,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const doc = await collection.findOne({ userId, isDefault: true });

      if (!doc) {
        logger.debug('No default embedding profile found for user', { userId });
        return null;
      }

      const validated = this.validate(doc);
      logger.debug('Default embedding profile found for user', { userId });
      return validated;
    } catch (error) {
      logger.error('Error finding default embedding profile', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find embedding profile by name for a specific user
   */
  async findByName(userId: string, name: string): Promise<EmbeddingProfile | null> {
    try {
      logger.debug('Finding embedding profile by name for user', {
        userId,
        name,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const doc = await collection.findOne({ userId, name });

      if (!doc) {
        logger.debug('Embedding profile not found by name for user', {
          userId,
          name,
        });
        return null;
      }

      const validated = this.validate(doc);
      logger.debug('Embedding profile found by name for user', {
        userId,
        name,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding embedding profile by name', {
        userId,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a new embedding profile
   */
  async create(
    data: Omit<EmbeddingProfile, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<EmbeddingProfile> {
    try {
      logger.debug('Creating new embedding profile', {
        userId: data.userId,
        name: data.name,
        provider: data.provider,
        collection: this.collectionName,
      });

      const id = this.generateId();
      const now = this.getCurrentTimestamp();

      const profile: EmbeddingProfile = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(profile);

      const collection = await this.getCollection();
      const result = await collection.insertOne(validated as any);

      logger.info('Embedding profile created successfully', {
        profileId: id,
        userId: data.userId,
        name: data.name,
        provider: data.provider,
        insertedId: result.insertedId.toString(),
      });

      return validated;
    } catch (error) {
      logger.error('Error creating embedding profile', {
        userId: data.userId,
        name: data.name,
        provider: data.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update an embedding profile
   */
  async update(id: string, data: Partial<EmbeddingProfile>): Promise<EmbeddingProfile | null> {
    try {
      logger.debug('Updating embedding profile', {
        profileId: id,
        collection: this.collectionName,
      });

      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Embedding profile not found for update', { profileId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: EmbeddingProfile = {
        ...existing,
        ...data,
        id: existing.id, // Preserve ID
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: now,
      };

      const validated = this.validate(updated);

      const collection = await this.getCollection();
      const result = await collection.updateOne(
        { id },
        { $set: validated as any }
      );

      logger.info('Embedding profile updated successfully', {
        profileId: id,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });

      return validated;
    } catch (error) {
      logger.error('Error updating embedding profile', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete an embedding profile
   */
  async delete(id: string): Promise<boolean> {
    try {
      logger.debug('Deleting embedding profile', {
        profileId: id,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Embedding profile not found for deletion', { profileId: id });
        return false;
      }

      logger.info('Embedding profile deleted successfully', {
        profileId: id,
        deletedCount: result.deletedCount,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting embedding profile', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add a tag to an embedding profile
   */
  async addTag(profileId: string, tagId: string): Promise<EmbeddingProfile | null> {
    try {
      logger.debug('Adding tag to embedding profile', {
        profileId,
        tagId,
        collection: this.collectionName,
      });

      const profile = await this.findById(profileId);
      if (!profile) {
        logger.warn('Embedding profile not found for tag addition', { profileId });
        return null;
      }

      if (!profile.tags.includes(tagId)) {
        profile.tags.push(tagId);
        logger.debug('Tag added to embedding profile tags array', {
          profileId,
          tagId,
          totalTags: profile.tags.length,
        });
        return await this.update(profileId, { tags: profile.tags });
      }

      logger.debug('Tag already exists for embedding profile', { profileId, tagId });
      return profile;
    } catch (error) {
      logger.error('Error adding tag to embedding profile', {
        profileId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a tag from an embedding profile
   */
  async removeTag(profileId: string, tagId: string): Promise<EmbeddingProfile | null> {
    try {
      logger.debug('Removing tag from embedding profile', {
        profileId,
        tagId,
        collection: this.collectionName,
      });

      const profile = await this.findById(profileId);
      if (!profile) {
        logger.warn('Embedding profile not found for tag removal', { profileId });
        return null;
      }

      const initialLength = profile.tags.length;
      profile.tags = profile.tags.filter((id) => id !== tagId);

      if (profile.tags.length < initialLength) {
        logger.debug('Tag removed from embedding profile tags array', {
          profileId,
          tagId,
          totalTags: profile.tags.length,
        });
        return await this.update(profileId, { tags: profile.tags });
      }

      logger.debug('Tag not found in embedding profile tags', { profileId, tagId });
      return profile;
    } catch (error) {
      logger.error('Error removing tag from embedding profile', {
        profileId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Unset all embedding profiles for a user as default
   * Used when setting a new default profile
   */
  async unsetAllDefaults(userId: string): Promise<boolean> {
    try {
      logger.debug('Unsetting all default embedding profiles for user', {
        userId,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const result = await collection.updateMany(
        { userId, isDefault: true },
        { $set: { isDefault: false, updatedAt: this.getCurrentTimestamp() } }
      );

      logger.info('All default embedding profiles unset for user', {
        userId,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });

      return result.modifiedCount > 0 || result.matchedCount === 0;
    } catch (error) {
      logger.error('Error unsetting all default embedding profiles', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
