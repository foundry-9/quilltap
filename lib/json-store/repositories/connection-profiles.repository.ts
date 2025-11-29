/**
 * Connection Profiles Repository
 *
 * Handles CRUD operations for ConnectionProfile and ApiKey entities.
 * Data is stored in: data/settings/connection-profiles.json
 */

import { JsonStore } from '../core/json-store';
import { BaseRepository } from './base.repository';
import {
  ConnectionProfile,
  ConnectionProfileSchema,
  ApiKey,
  ApiKeySchema,
  ConnectionProfilesFile,
  ConnectionProfilesFileSchema,
} from '../schemas/types';

export class ConnectionProfilesRepository extends BaseRepository<ConnectionProfile> {
  constructor(jsonStore: JsonStore) {
    super(jsonStore, ConnectionProfileSchema);
  }

  /**
   * Get the connection profiles file path
   */
  private getFilePath(): string {
    return 'settings/connection-profiles.json';
  }

  /**
   * Read connection profiles file with default structure
   */
  private async readProfilesFile(): Promise<ConnectionProfilesFile> {
    try {
      const filePath = this.getFilePath();
      const data = await this.jsonStore.readJson<ConnectionProfilesFile>(filePath);
      return ConnectionProfilesFileSchema.parse(data);
    } catch (error) {
      // Return default structure if file doesn't exist
      return {
        version: 1,
        apiKeys: [],
        llmProfiles: [],
        createdAt: this.getCurrentTimestamp(),
        updatedAt: this.getCurrentTimestamp(),
      };
    }
  }

  /**
   * Write connection profiles file with validation
   */
  private async writeProfilesFile(data: ConnectionProfilesFile): Promise<void> {
    const validated = ConnectionProfilesFileSchema.parse({
      ...data,
      updatedAt: this.getCurrentTimestamp(),
    });
    await this.jsonStore.writeJson(this.getFilePath(), validated);
  }

  /**
   * Find a connection profile by ID
   */
  async findById(id: string): Promise<ConnectionProfile | null> {
    const file = await this.readProfilesFile();
    return file.llmProfiles.find(profile => profile.id === id) || null;
  }

  /**
   * Find all connection profiles
   */
  async findAll(): Promise<ConnectionProfile[]> {
    const file = await this.readProfilesFile();
    return file.llmProfiles;
  }

  /**
   * Find connection profiles by user ID
   */
  async findByUserId(userId: string): Promise<ConnectionProfile[]> {
    const file = await this.readProfilesFile();
    return file.llmProfiles.filter(profile => profile.userId === userId);
  }

  /**
   * Find connection profiles with a specific tag
   */
  async findByTag(tagId: string): Promise<ConnectionProfile[]> {
    const file = await this.readProfilesFile();
    return file.llmProfiles.filter(profile => profile.tags.includes(tagId));
  }

  /**
   * Find default connection profile for user
   */
  async findDefault(userId: string): Promise<ConnectionProfile | null> {
    const file = await this.readProfilesFile();
    return (
      file.llmProfiles.find(
        profile => profile.userId === userId && profile.isDefault
      ) || null
    );
  }

  /**
   * Create a new connection profile
   */
  async create(
    data: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ConnectionProfile> {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    const profile: ConnectionProfile = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const validated = this.validate(profile);
    const file = await this.readProfilesFile();
    file.llmProfiles.push(validated);
    await this.writeProfilesFile(file);

    // Force cache clear to ensure subsequent reads get fresh data
    this.jsonStore.clearCache();

    return validated;
  }

  /**
   * Update a connection profile
   */
  async update(id: string, data: Partial<ConnectionProfile>): Promise<ConnectionProfile | null> {
    const file = await this.readProfilesFile();
    const index = file.llmProfiles.findIndex(profile => profile.id === id);

    if (index === -1) {
      return null;
    }

    const existing = file.llmProfiles[index];
    const now = this.getCurrentTimestamp();

    const updated: ConnectionProfile = {
      ...existing,
      ...data,
      id: existing.id, // Preserve ID
      createdAt: existing.createdAt, // Preserve creation timestamp
      updatedAt: now,
    };

    const validated = this.validate(updated);
    file.llmProfiles[index] = validated;
    await this.writeProfilesFile(file);

    // Force cache clear to ensure subsequent reads get fresh data
    this.jsonStore.clearCache();

    return validated;
  }

  /**
   * Delete a connection profile
   */
  async delete(id: string): Promise<boolean> {
    const file = await this.readProfilesFile();
    const initialLength = file.llmProfiles.length;

    file.llmProfiles = file.llmProfiles.filter(profile => profile.id !== id);

    if (file.llmProfiles.length === initialLength) {
      return false; // Profile not found
    }

    await this.writeProfilesFile(file);
    
    // Force cache clear to ensure subsequent reads get fresh data
    this.jsonStore.clearCache();
    
    return true;
  }

  /**
   * Add a tag to a connection profile
   */
  async addTag(profileId: string, tagId: string): Promise<ConnectionProfile | null> {
    const profile = await this.findById(profileId);
    if (!profile) {
      return null;
    }

    if (!profile.tags.includes(tagId)) {
      profile.tags.push(tagId);
      return await this.update(profileId, { tags: profile.tags });
    }

    return profile;
  }

  /**
   * Remove a tag from a connection profile
   */
  async removeTag(profileId: string, tagId: string): Promise<ConnectionProfile | null> {
    const profile = await this.findById(profileId);
    if (!profile) {
      return null;
    }

    profile.tags = profile.tags.filter(id => id !== tagId);
    return await this.update(profileId, { tags: profile.tags });
  }

  // ============================================================================
  // API KEY OPERATIONS
  // ============================================================================

  /**
   * Get all API keys
   */
  async getAllApiKeys(): Promise<ApiKey[]> {
    const file = await this.readProfilesFile();
    return file.apiKeys;
  }

  /**
   * Find API key by ID
   */
  async findApiKeyById(id: string): Promise<ApiKey | null> {
    const file = await this.readProfilesFile();
    return file.apiKeys.find(key => key.id === id) || null;
  }

  /**
   * Create a new API key
   */
  async createApiKey(
    data: Omit<ApiKey, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ApiKey> {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    const apiKey: ApiKey = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const validated = ApiKeySchema.parse(apiKey);
    const file = await this.readProfilesFile();
    file.apiKeys.push(validated);
    await this.writeProfilesFile(file);

    // Force cache clear to ensure subsequent reads get fresh data
    this.jsonStore.clearCache();

    return validated;
  }

  /**
   * Update an API key
   */
  async updateApiKey(id: string, data: Partial<ApiKey>): Promise<ApiKey | null> {
    const file = await this.readProfilesFile();
    const index = file.apiKeys.findIndex(key => key.id === id);

    if (index === -1) {
      return null;
    }

    const existing = file.apiKeys[index];
    const now = this.getCurrentTimestamp();

    const updated: ApiKey = {
      ...existing,
      ...data,
      id: existing.id, // Preserve ID
      createdAt: existing.createdAt, // Preserve creation timestamp
      updatedAt: now,
    };

    const validated = ApiKeySchema.parse(updated);
    file.apiKeys[index] = validated;
    await this.writeProfilesFile(file);

    // Force cache clear to ensure subsequent reads get fresh data
    this.jsonStore.clearCache();

    return validated;
  }

  /**
   * Delete an API key
   */
  async deleteApiKey(id: string): Promise<boolean> {
    const file = await this.readProfilesFile();
    const initialLength = file.apiKeys.length;

    file.apiKeys = file.apiKeys.filter(key => key.id !== id);

    if (file.apiKeys.length === initialLength) {
      return false; // API key not found
    }

    await this.writeProfilesFile(file);
    
    // Force cache clear to ensure subsequent reads get fresh data
    this.jsonStore.clearCache();
    
    return true;
  }

  /**
   * Update API key last used timestamp
   */
  async recordApiKeyUsage(id: string): Promise<ApiKey | null> {
    return await this.updateApiKey(id, { lastUsed: this.getCurrentTimestamp() });
  }
}
