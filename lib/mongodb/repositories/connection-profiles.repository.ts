/**
 * MongoDB Connection Profiles Repository
 *
 * Handles CRUD operations for ConnectionProfile and ApiKey entities in MongoDB.
 * Provides methods for managing connection profiles, API keys, and their relationships.
 * Uses two collections: 'connection_profiles' and 'api_keys'
 */

import { Collection } from 'mongodb';
import {
  ConnectionProfile,
  ConnectionProfileSchema,
  ApiKey,
  ApiKeySchema,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { MongoBaseRepository } from './base.repository';

/**
 * Connection Profiles Repository
 * Manages both ConnectionProfile and ApiKey entities
 */
export class ConnectionProfilesRepository extends MongoBaseRepository<ConnectionProfile> {
  constructor() {
    super('connection_profiles', ConnectionProfileSchema);
  }

  // ============================================================================
  // CONNECTION PROFILE OPERATIONS
  // ============================================================================

  /**
   * Find a connection profile by ID
   */
  async findById(id: string): Promise<ConnectionProfile | null> {
    try {
      logger.debug('Finding connection profile by ID', {
        profileId: id,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const doc = await collection.findOne({ id });

      if (!doc) {
        logger.debug('Connection profile not found', { profileId: id });
        return null;
      }

      const validated = this.validate(doc);
      logger.debug('Connection profile found and validated', { profileId: id });
      return validated;
    } catch (error) {
      logger.error('Error finding connection profile by ID', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all connection profiles
   */
  async findAll(): Promise<ConnectionProfile[]> {
    try {
      logger.debug('Finding all connection profiles', { collection: this.collectionName });

      const collection = await this.getCollection();
      const docs = await collection.find({}).toArray();

      logger.debug('Retrieved connection profiles from database', { count: docs.length });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('All connection profiles validated', {
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding all connection profiles', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find connection profiles by user ID
   */
  async findByUserId(userId: string): Promise<ConnectionProfile[]> {
    try {
      logger.debug('Finding connection profiles by user ID', {
        userId,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const docs = await collection.find({ userId }).toArray();

      logger.debug('Retrieved connection profiles for user', {
        userId,
        count: docs.length,
      });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('User connection profiles validated', {
        userId,
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding connection profiles by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find connection profiles with a specific tag
   */
  async findByTag(tagId: string): Promise<ConnectionProfile[]> {
    try {
      logger.debug('Finding connection profiles by tag', {
        tagId,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const docs = await collection.find({ tags: tagId }).toArray();

      logger.debug('Retrieved connection profiles with tag', {
        tagId,
        count: docs.length,
      });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('Tag connection profiles validated', {
        tagId,
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding connection profiles by tag', {
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find default connection profile for user
   */
  async findDefault(userId: string): Promise<ConnectionProfile | null> {
    try {
      logger.debug('Finding default connection profile for user', {
        userId,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const doc = await collection.findOne({ userId, isDefault: true });

      if (!doc) {
        logger.debug('No default connection profile found for user', { userId });
        return null;
      }

      const validated = this.validate(doc);
      logger.debug('Default connection profile found for user', { userId });
      return validated;
    } catch (error) {
      logger.error('Error finding default connection profile', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a new connection profile
   */
  async create(
    data: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ConnectionProfile> {
    try {
      logger.debug('Creating new connection profile', {
        userId: data.userId,
        name: data.name,
        provider: data.provider,
        collection: this.collectionName,
      });

      const id = this.generateId();
      const now = this.getCurrentTimestamp();

      const profile: ConnectionProfile = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(profile);

      const collection = await this.getCollection();
      const result = await collection.insertOne(validated as any);

      logger.info('Connection profile created successfully', {
        profileId: id,
        userId: data.userId,
        provider: data.provider,
        insertedId: result.insertedId.toString(),
      });

      return validated;
    } catch (error) {
      logger.error('Error creating connection profile', {
        userId: data.userId,
        name: data.name,
        provider: data.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a connection profile
   */
  async update(id: string, data: Partial<ConnectionProfile>): Promise<ConnectionProfile | null> {
    try {
      logger.debug('Updating connection profile', {
        profileId: id,
        collection: this.collectionName,
      });

      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Connection profile not found for update', { profileId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: ConnectionProfile = {
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

      logger.info('Connection profile updated successfully', {
        profileId: id,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });

      return validated;
    } catch (error) {
      logger.error('Error updating connection profile', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a connection profile
   */
  async delete(id: string): Promise<boolean> {
    try {
      logger.debug('Deleting connection profile', {
        profileId: id,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Connection profile not found for deletion', { profileId: id });
        return false;
      }

      logger.info('Connection profile deleted successfully', {
        profileId: id,
        deletedCount: result.deletedCount,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting connection profile', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add a tag to a connection profile
   */
  async addTag(profileId: string, tagId: string): Promise<ConnectionProfile | null> {
    try {
      logger.debug('Adding tag to connection profile', {
        profileId,
        tagId,
        collection: this.collectionName,
      });

      const profile = await this.findById(profileId);
      if (!profile) {
        logger.warn('Connection profile not found for tag addition', { profileId });
        return null;
      }

      if (!profile.tags.includes(tagId)) {
        profile.tags.push(tagId);
        logger.debug('Tag added to connection profile tags array', {
          profileId,
          tagId,
          totalTags: profile.tags.length,
        });
        return await this.update(profileId, { tags: profile.tags });
      }

      logger.debug('Tag already exists for connection profile', { profileId, tagId });
      return profile;
    } catch (error) {
      logger.error('Error adding tag to connection profile', {
        profileId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a tag from a connection profile
   */
  async removeTag(profileId: string, tagId: string): Promise<ConnectionProfile | null> {
    try {
      logger.debug('Removing tag from connection profile', {
        profileId,
        tagId,
        collection: this.collectionName,
      });

      const profile = await this.findById(profileId);
      if (!profile) {
        logger.warn('Connection profile not found for tag removal', { profileId });
        return null;
      }

      const initialLength = profile.tags.length;
      profile.tags = profile.tags.filter((id) => id !== tagId);

      if (profile.tags.length < initialLength) {
        logger.debug('Tag removed from connection profile tags array', {
          profileId,
          tagId,
          totalTags: profile.tags.length,
        });
        return await this.update(profileId, { tags: profile.tags });
      }

      logger.debug('Tag not found in connection profile tags', { profileId, tagId });
      return profile;
    } catch (error) {
      logger.error('Error removing tag from connection profile', {
        profileId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // API KEY OPERATIONS
  // ============================================================================

  /**
   * Get the API keys collection
   */
  private async getApiKeysCollection(): Promise<Collection> {
    try {
      const db = await this.getCollection();
      const mongoDb = db.db;
      logger.debug('Retrieved MongoDB API keys collection', { collection: 'api_keys' });
      return mongoDb.collection('api_keys');
    } catch (error) {
      logger.error('Failed to get MongoDB API keys collection', {
        collection: 'api_keys',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all API keys
   */
  async getAllApiKeys(): Promise<ApiKey[]> {
    try {
      logger.debug('Finding all API keys', { collection: 'api_keys' });

      const collection = await this.getApiKeysCollection();
      const docs = await collection.find({}).toArray();

      logger.debug('Retrieved API keys from database', { count: docs.length });

      const validated = docs
        .map((doc) => {
          const result = ApiKeySchema.safeParse(doc);
          if (!result.success) {
            logger.warn('API key validation failed', {
              keyId: (doc as any).id,
              error: result.error.message,
            });
            return null;
          }
          return result.data;
        })
        .filter((key) => key !== null) as ApiKey[];

      logger.debug('All API keys validated', {
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding all API keys', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find API key by ID
   */
  async findApiKeyById(id: string): Promise<ApiKey | null> {
    try {
      logger.debug('Finding API key by ID', {
        keyId: id,
        collection: 'api_keys',
      });

      const collection = await this.getApiKeysCollection();
      const doc = await collection.findOne({ id });

      if (!doc) {
        logger.debug('API key not found', { keyId: id });
        return null;
      }

      const validated = ApiKeySchema.parse(doc);
      logger.debug('API key found and validated', { keyId: id });
      return validated;
    } catch (error) {
      logger.error('Error finding API key by ID', {
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a new API key
   */
  async createApiKey(data: Omit<ApiKey, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiKey> {
    try {
      logger.debug('Creating new API key', {
        label: data.label,
        provider: data.provider,
        collection: 'api_keys',
      });

      const id = this.generateId();
      const now = this.getCurrentTimestamp();

      const apiKey: ApiKey = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = ApiKeySchema.parse(apiKey);

      const collection = await this.getApiKeysCollection();
      const result = await collection.insertOne(validated as any);

      logger.info('API key created successfully', {
        keyId: id,
        label: data.label,
        provider: data.provider,
        insertedId: result.insertedId.toString(),
      });

      return validated;
    } catch (error) {
      logger.error('Error creating API key', {
        label: data.label,
        provider: data.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update an API key
   */
  async updateApiKey(id: string, data: Partial<ApiKey>): Promise<ApiKey | null> {
    try {
      logger.debug('Updating API key', {
        keyId: id,
        collection: 'api_keys',
      });

      const existing = await this.findApiKeyById(id);
      if (!existing) {
        logger.warn('API key not found for update', { keyId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: ApiKey = {
        ...existing,
        ...data,
        id: existing.id, // Preserve ID
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: now,
      };

      const validated = ApiKeySchema.parse(updated);

      const collection = await this.getApiKeysCollection();
      const result = await collection.updateOne(
        { id },
        { $set: validated as any }
      );

      logger.info('API key updated successfully', {
        keyId: id,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });

      return validated;
    } catch (error) {
      logger.error('Error updating API key', {
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete an API key
   */
  async deleteApiKey(id: string): Promise<boolean> {
    try {
      logger.debug('Deleting API key', {
        keyId: id,
        collection: 'api_keys',
      });

      const collection = await this.getApiKeysCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('API key not found for deletion', { keyId: id });
        return false;
      }

      logger.info('API key deleted successfully', {
        keyId: id,
        deletedCount: result.deletedCount,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting API key', {
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update API key last used timestamp
   */
  async recordApiKeyUsage(id: string): Promise<ApiKey | null> {
    try {
      logger.debug('Recording API key usage', {
        keyId: id,
        collection: 'api_keys',
      });

      const result = await this.updateApiKey(id, { lastUsed: this.getCurrentTimestamp() });

      if (result) {
        logger.debug('API key usage recorded', { keyId: id });
      }

      return result;
    } catch (error) {
      logger.error('Error recording API key usage', {
        keyId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
