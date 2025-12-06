/**
 * Embedding Profiles Repository
 *
 * Handles CRUD operations for EmbeddingProfile entities.
 * Data is stored in: data/settings/embedding-profiles.json
 *
 * Embedding profiles are used for text embedding connections,
 * supporting providers: OpenAI and Ollama
 */

import { JsonStore } from '../core/json-store';
import { BaseRepository } from './base.repository';
import {
  EmbeddingProfile,
  EmbeddingProfileSchema,
  EmbeddingProfilesFile,
  EmbeddingProfilesFileSchema,
} from '../schemas/types';

export class EmbeddingProfilesRepository extends BaseRepository<EmbeddingProfile> {
  constructor(jsonStore: JsonStore) {
    super(jsonStore, EmbeddingProfileSchema);
  }

  /**
   * Get the embedding profiles file path
   */
  private getFilePath(): string {
    return 'settings/embedding-profiles.json';
  }

  /**
   * Read embedding profiles file with default structure
   */
  private async readProfilesFile(): Promise<EmbeddingProfilesFile> {
    try {
      const filePath = this.getFilePath();
      const data = await this.jsonStore.readJson<EmbeddingProfilesFile>(filePath);
      return EmbeddingProfilesFileSchema.parse(data);
    } catch (error) {
      // Return default structure if file doesn't exist
      return {
        version: 1,
        profiles: [],
        createdAt: this.getCurrentTimestamp(),
        updatedAt: this.getCurrentTimestamp(),
      };
    }
  }

  /**
   * Write embedding profiles file with validation
   */
  private async writeProfilesFile(data: EmbeddingProfilesFile): Promise<void> {
    const validated = EmbeddingProfilesFileSchema.parse({
      ...data,
      updatedAt: this.getCurrentTimestamp(),
    });
    await this.jsonStore.writeJson(this.getFilePath(), validated);
  }

  /**
   * Find an embedding profile by ID
   */
  async findById(id: string): Promise<EmbeddingProfile | null> {
    const file = await this.readProfilesFile();
    return file.profiles.find(profile => profile.id === id) || null;
  }

  /**
   * Find all embedding profiles
   */
  async findAll(): Promise<EmbeddingProfile[]> {
    const file = await this.readProfilesFile();
    return file.profiles;
  }

  /**
   * Find embedding profiles by user ID
   */
  async findByUserId(userId: string): Promise<EmbeddingProfile[]> {
    const file = await this.readProfilesFile();
    return file.profiles.filter(profile => profile.userId === userId);
  }

  /**
   * Find embedding profiles with a specific tag
   */
  async findByTag(tagId: string): Promise<EmbeddingProfile[]> {
    const file = await this.readProfilesFile();
    return file.profiles.filter(profile => profile.tags.includes(tagId));
  }

  /**
   * Find default embedding profile for user
   */
  async findDefault(userId: string): Promise<EmbeddingProfile | null> {
    const file = await this.readProfilesFile();
    return (
      file.profiles.find(
        profile => profile.userId === userId && profile.isDefault
      ) || null
    );
  }

  /**
   * Find embedding profile by name for user
   */
  async findByName(userId: string, name: string): Promise<EmbeddingProfile | null> {
    const file = await this.readProfilesFile();
    return file.profiles.find(
      profile => profile.userId === userId && profile.name === name
    ) || null;
  }

  /**
   * Create a new embedding profile
   */
  async create(
    data: Omit<EmbeddingProfile, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<EmbeddingProfile> {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    const profile: EmbeddingProfile = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const validated = this.validate(profile);
    const file = await this.readProfilesFile();
    file.profiles.push(validated);
    await this.writeProfilesFile(file);

    return validated;
  }

  /**
   * Update an embedding profile
   */
  async update(id: string, data: Partial<EmbeddingProfile>): Promise<EmbeddingProfile | null> {
    const file = await this.readProfilesFile();
    const index = file.profiles.findIndex(profile => profile.id === id);

    if (index === -1) {
      return null;
    }

    const existing = file.profiles[index];
    const now = this.getCurrentTimestamp();

    const updated: EmbeddingProfile = {
      ...existing,
      ...data,
      id: existing.id, // Preserve ID
      createdAt: existing.createdAt, // Preserve creation timestamp
      updatedAt: now,
    };

    const validated = this.validate(updated);
    file.profiles[index] = validated;
    await this.writeProfilesFile(file);

    return validated;
  }

  /**
   * Delete an embedding profile
   */
  async delete(id: string): Promise<boolean> {
    const file = await this.readProfilesFile();
    const initialLength = file.profiles.length;

    file.profiles = file.profiles.filter(profile => profile.id !== id);

    if (file.profiles.length === initialLength) {
      return false; // Profile not found
    }

    await this.writeProfilesFile(file);
    return true;
  }

  /**
   * Add a tag to an embedding profile
   */
  async addTag(profileId: string, tagId: string): Promise<EmbeddingProfile | null> {
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
   * Remove a tag from an embedding profile
   */
  async removeTag(profileId: string, tagId: string): Promise<EmbeddingProfile | null> {
    const profile = await this.findById(profileId);
    if (!profile) {
      return null;
    }

    profile.tags = profile.tags.filter(id => id !== tagId);
    return await this.update(profileId, { tags: profile.tags });
  }

  /**
   * Unset default flag on all profiles for a user
   */
  async unsetAllDefaults(userId: string): Promise<void> {
    const file = await this.readProfilesFile();
    let changed = false;

    for (let i = 0; i < file.profiles.length; i++) {
      if (file.profiles[i].userId === userId && file.profiles[i].isDefault) {
        file.profiles[i] = {
          ...file.profiles[i],
          isDefault: false,
          updatedAt: this.getCurrentTimestamp(),
        };
        changed = true;
      }
    }

    if (changed) {
      await this.writeProfilesFile(file);
    }
  }
}
