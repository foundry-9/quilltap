/**
 * Image Profiles Repository
 *
 * Handles CRUD operations for ImageProfile entities.
 * Data is stored in: data/settings/image-profiles.json
 */

import { JsonStore } from '../core/json-store';
import { BaseRepository } from './base.repository';
import {
  ImageProfile,
  ImageProfileSchema,
  ImageProfilesFile,
  ImageProfilesFileSchema,
} from '../schemas/types';

export class ImageProfilesRepository extends BaseRepository<ImageProfile> {
  constructor(jsonStore: JsonStore) {
    super(jsonStore, ImageProfileSchema);
  }

  /**
   * Get the image profiles file path
   */
  private getFilePath(): string {
    return 'settings/image-profiles.json';
  }

  /**
   * Read image profiles file with default structure
   */
  private async readProfilesFile(): Promise<ImageProfilesFile> {
    try {
      const filePath = this.getFilePath();
      const data = await this.jsonStore.readJson<ImageProfilesFile>(filePath);
      return ImageProfilesFileSchema.parse(data);
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
   * Write image profiles file with validation
   */
  private async writeProfilesFile(data: ImageProfilesFile): Promise<void> {
    const validated = ImageProfilesFileSchema.parse({
      ...data,
      updatedAt: this.getCurrentTimestamp(),
    });
    await this.jsonStore.writeJson(this.getFilePath(), validated);
  }

  /**
   * Find an image profile by ID
   */
  async findById(id: string): Promise<ImageProfile | null> {
    const file = await this.readProfilesFile();
    return file.profiles.find(profile => profile.id === id) || null;
  }

  /**
   * Find all image profiles
   */
  async findAll(): Promise<ImageProfile[]> {
    const file = await this.readProfilesFile();
    return file.profiles;
  }

  /**
   * Find image profiles by user ID
   */
  async findByUserId(userId: string): Promise<ImageProfile[]> {
    const file = await this.readProfilesFile();
    return file.profiles.filter(profile => profile.userId === userId);
  }

  /**
   * Find image profiles with a specific tag
   */
  async findByTag(tagId: string): Promise<ImageProfile[]> {
    const file = await this.readProfilesFile();
    return file.profiles.filter(profile => profile.tags.includes(tagId));
  }

  /**
   * Find default image profile for user
   */
  async findDefault(userId: string): Promise<ImageProfile | null> {
    const file = await this.readProfilesFile();
    return (
      file.profiles.find(
        profile => profile.userId === userId && profile.isDefault
      ) || null
    );
  }

  /**
   * Find image profile by name for user
   */
  async findByName(userId: string, name: string): Promise<ImageProfile | null> {
    const file = await this.readProfilesFile();
    return file.profiles.find(
      profile => profile.userId === userId && profile.name === name
    ) || null;
  }

  /**
   * Create a new image profile
   */
  async create(
    data: Omit<ImageProfile, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ImageProfile> {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    const profile: ImageProfile = {
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
   * Update an image profile
   */
  async update(id: string, data: Partial<ImageProfile>): Promise<ImageProfile | null> {
    const file = await this.readProfilesFile();
    const index = file.profiles.findIndex(profile => profile.id === id);

    if (index === -1) {
      return null;
    }

    const existing = file.profiles[index];
    const now = this.getCurrentTimestamp();

    const updated: ImageProfile = {
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
   * Delete an image profile
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
   * Add a tag to an image profile
   */
  async addTag(profileId: string, tagId: string): Promise<ImageProfile | null> {
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
   * Remove a tag from an image profile
   */
  async removeTag(profileId: string, tagId: string): Promise<ImageProfile | null> {
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
