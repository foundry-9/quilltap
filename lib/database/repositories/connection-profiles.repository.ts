/**
 * Connection Profiles Repository
 *
 * Backend-agnostic repository for ConnectionProfile and ApiKey entities.
 * Works with SQLite through the database abstraction layer.
 * Manages connection profiles, API keys, and their relationships.
 */

import { logger } from '@/lib/logger';
import {
  ConnectionProfile,
  ConnectionProfileSchema,
  ApiKey,
  ApiKeySchema,
} from '@/lib/schemas/types';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter, UpdateSpec } from '../interfaces';
import { getCollection, ensureCollection } from '../manager';

/**
 * Connection Profiles Repository
 * Manages both ConnectionProfile and ApiKey entities
 */
export class ConnectionProfilesRepository extends TaggableBaseRepository<ConnectionProfile> {
  constructor() {
    super('connection_profiles', ConnectionProfileSchema);
  }

  // ============================================================================
  // CONNECTION PROFILE OPERATIONS
  // ============================================================================

  /**
   * Find connection profiles with a specific tag
   */
  async findByTag(tagId: string): Promise<ConnectionProfile[]> {
    return super.findByTag(tagId);
  }

  /**
   * Find default connection profile for user
   */
  async findDefault(userId: string): Promise<ConnectionProfile | null> {
    return this.safeQuery(
      async () => {
        const profile = await this.findOneByFilter({
          userId,
          isDefault: true,
        });

        if (!profile) {
          return null;
        }
        return profile;
      },
      'Error finding default connection profile',
      { userId },
      null
    );
  }

  /**
   * Create a new connection profile
   * @param data The connection profile data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<ConnectionProfile> {
    return this.safeQuery(
      async () => {
        const profile = await this._create(data, options);

        logger.info('Connection profile created successfully', {
          profileId: profile.id,
          userId: data.userId,
          provider: data.provider,
        });

        return profile;
      },
      'Error creating connection profile',
      { userId: data.userId, name: data.name, provider: data.provider }
    );
  }

  /**
   * Update a connection profile
   */
  async update(id: string, data: Partial<ConnectionProfile>): Promise<ConnectionProfile | null> {
    return this.safeQuery(
      async () => {
        const profile = await this._update(id, data);

        if (profile) {
          logger.info('Connection profile updated successfully', { profileId: id });
        }

        return profile;
      },
      'Error updating connection profile',
      { profileId: id }
    );
  }

  /**
   * Delete a connection profile.
   *
   * Also releases the deleted profile from any *other* profile that had named
   * it as its fallback understudy. `fallbackProfileId` is deliberately not a
   * foreign key — `buildFallbackChain()` already drops a target it cannot
   * find, so a stale reference is harmless at call time — but leaving it in
   * the row is a lie the profile editor would then render as a dropdown
   * pointing at nothing.
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          const releasedCount = await this.updateMany(
            { fallbackProfileId: id } as TypedQueryFilter<ConnectionProfile>,
            { fallbackProfileId: null }
          );

          logger.info('Connection profile deleted successfully', {
            profileId: id,
            fallbackReferencesCleared: releasedCount,
          });
        }

        return result;
      },
      'Error deleting connection profile',
      { profileId: id }
    );
  }

  /**
   * Add a tag to a connection profile
   */
  async addTag(profileId: string, tagId: string): Promise<ConnectionProfile | null> {
    return super.addTag(profileId, tagId);
  }

  /**
   * Remove a tag from a connection profile
   */
  async removeTag(profileId: string, tagId: string): Promise<ConnectionProfile | null> {
    return super.removeTag(profileId, tagId);
  }

  // ============================================================================
  // TOKEN USAGE TRACKING
  // ============================================================================

  /**
   * Increment token usage counters for a connection profile
   * Uses atomic operations for thread safety
   */
  async incrementTokenUsage(
    profileId: string,
    promptTokens: number,
    completionTokens: number
  ): Promise<void> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const now = this.getCurrentTimestamp();

        const result = await collection.updateOne(
          { id: profileId },
          {
            $inc: {
              totalTokens: promptTokens + completionTokens,
              totalPromptTokens: promptTokens,
              totalCompletionTokens: completionTokens,
              messageCount: 1,
            },
            $set: { updatedAt: now },
          } as UpdateSpec<ConnectionProfile>
        );

        if (result.matchedCount === 0) {
          logger.warn('Connection profile not found for token usage increment', { profileId });
          return;
        }
      },
      'Error incrementing token usage',
      { profileId, promptTokens, completionTokens },
      undefined
    );
  }

  /**
   * Reset token usage counters for a connection profile
   */
  async resetTokenUsage(profileId: string): Promise<ConnectionProfile | null> {
    return this.safeQuery(
      () => this.update(profileId, {
        totalTokens: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        messageCount: 0,
      } as Partial<ConnectionProfile>),
      'Error resetting token usage',
      { profileId }
    );
  }

  // ============================================================================
  // API KEY OPERATIONS
  // ============================================================================

  /**
   * Get the API keys collection
   */
  private async getApiKeysCollection() {
    return this.safeQuery(
      async () => {
        // Ensure the API keys collection exists
        await ensureCollection('api_keys', ApiKeySchema);
        // Get the API keys collection from the manager
        return getCollection<ApiKey>('api_keys');
      },
      'Failed to get API keys collection',
      {}
    );
  }

  /**
   * Get all API keys for a specific user
   */
  async getApiKeysByUserId(userId: string): Promise<ApiKey[]> {
    return this.safeQuery(
      async () => {
        const collection = await this.getApiKeysCollection();
        const docs = await collection.find({ userId });
        const validated = docs
          .map((doc) => {
            const result = ApiKeySchema.safeParse(doc);
            if (!result.success) {
              logger.warn('API key validation failed', {
                keyId: (doc as any).id,
                userId,
                error: result.error.message,
              });
              return null;
            }
            return result.data;
          })
          .filter((key) => key !== null) as ApiKey[];
        return validated;
      },
      'Error finding API keys by user ID',
      { userId },
      []
    );
  }

  /**
   * Find API key by ID
   */
  async findApiKeyById(id: string): Promise<ApiKey | null> {
    return this.safeQuery(
      async () => {
        const collection = await this.getApiKeysCollection();
        const doc = await collection.findOne({ id });

        if (!doc) {
          return null;
        }

        const validated = ApiKeySchema.parse(doc);
        return validated;
      },
      'Error finding API key by ID',
      { keyId: id },
      null
    );
  }

  /**
   * Find API key by ID and verify ownership
   */
  async findApiKeyByIdAndUserId(id: string, userId: string): Promise<ApiKey | null> {
    return this.safeQuery(
      async () => {
        const collection = await this.getApiKeysCollection();
        const doc = await collection.findOne({ id, userId });

        if (!doc) {
          return null;
        }

        const validated = ApiKeySchema.parse(doc);
        return validated;
      },
      'Error finding API key by ID and user ID',
      { keyId: id, userId },
      null
    );
  }

  /**
   * Create a new API key
   */
  async createApiKey(data: Omit<ApiKey, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiKey> {
    return this.safeQuery(
      async () => {
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
        await collection.insertOne(validated);

        logger.info('API key created successfully', {
          keyId: id,
          label: data.label,
          provider: data.provider,
        });

        return validated;
      },
      'Error creating API key',
      { label: data.label, provider: data.provider }
    );
  }

  /**
   * Update an API key
   */
  async updateApiKey(id: string, data: Partial<ApiKey>): Promise<ApiKey | null> {
    return this.safeQuery(
      async () => {
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
          { $set: validated } as UpdateSpec<ApiKey>
        );

        logger.info('API key updated successfully', {
          keyId: id,
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount,
        });

        return validated;
      },
      'Error updating API key',
      { keyId: id }
    );
  }

  /**
   * Delete an API key
   */
  async deleteApiKey(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
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
      },
      'Error deleting API key',
      { keyId: id }
    );
  }

  /**
   * Update API key last used timestamp
   */
  async recordApiKeyUsage(id: string): Promise<ApiKey | null> {
    return this.safeQuery(
      () => this.updateApiKey(id, { lastUsed: this.getCurrentTimestamp() }),
      'Error recording API key usage',
      { keyId: id }
    );
  }
}
