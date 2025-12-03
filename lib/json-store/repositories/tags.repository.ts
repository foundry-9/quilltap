/**
 * Tags Repository
 *
 * Handles CRUD operations for Tag entities.
 * All tags are stored in a single file: data/tags/tags.json
 */

import { JsonStore } from '../core/json-store';
import { BaseRepository } from './base.repository';
import { Tag, TagSchema, TagsFile, TagsFileSchema } from '../schemas/types';

export class TagsRepository extends BaseRepository<Tag> {
  constructor(jsonStore: JsonStore) {
    super(jsonStore, TagSchema);
  }

  /**
   * Get the tags file path
   */
  private getFilePath(): string {
    return 'tags/tags.json';
  }

  /**
   * Read tags file with default structure
   */
  private async readTagsFile(): Promise<TagsFile> {
    try {
      const filePath = this.getFilePath();
      const data = await this.jsonStore.readJson<TagsFile>(filePath);
      return TagsFileSchema.parse(data);
    } catch (error) {
      // Return default structure if file doesn't exist
      return {
        version: 1,
        tags: [],
        createdAt: this.getCurrentTimestamp(),
        updatedAt: this.getCurrentTimestamp(),
      };
    }
  }

  /**
   * Write tags file with validation
   */
  private async writeTagsFile(data: TagsFile): Promise<void> {
    const validated = TagsFileSchema.parse({
      ...data,
      updatedAt: this.getCurrentTimestamp(),
    });
    await this.jsonStore.writeJson(this.getFilePath(), validated);
  }

  /**
   * Find a tag by ID
   */
  async findById(id: string): Promise<Tag | null> {
    const tagsFile = await this.readTagsFile();
    return tagsFile.tags.find(tag => tag.id === id) || null;
  }

  /**
   * Find all tags
   */
  async findAll(): Promise<Tag[]> {
    const tagsFile = await this.readTagsFile();
    return tagsFile.tags;
  }

  /**
   * Find tags by user ID
   */
  async findByUserId(userId: string): Promise<Tag[]> {
    const tagsFile = await this.readTagsFile();
    return tagsFile.tags.filter(tag => tag.userId === userId);
  }

  /**
   * Find tag by name (case-insensitive)
   */
  async findByName(userId: string, name: string): Promise<Tag | null> {
    const tagsFile = await this.readTagsFile();
    const nameLower = name.toLowerCase();
    return (
      tagsFile.tags.find(
        tag => tag.userId === userId && tag.nameLower === nameLower
      ) || null
    );
  }

  /**
   * Create a new tag
   */
  async create(data: Omit<Tag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tag> {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    const tag: Tag = {
      ...data,
      quickHide: typeof data.quickHide === 'boolean' ? data.quickHide : false,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const validated = this.validate(tag);
    const tagsFile = await this.readTagsFile();
    tagsFile.tags.push(validated);
    await this.writeTagsFile(tagsFile);
    this.jsonStore.clearCache();

    return validated;
  }

  /**
   * Update a tag
   */
  async update(id: string, data: Partial<Tag>): Promise<Tag | null> {
    const tagsFile = await this.readTagsFile();
    const index = tagsFile.tags.findIndex(tag => tag.id === id);

    if (index === -1) {
      return null;
    }

    const existing = tagsFile.tags[index];
    const now = this.getCurrentTimestamp();

    const updated: Tag = {
      ...existing,
      ...data,
      id: existing.id, // Preserve ID
      createdAt: existing.createdAt, // Preserve creation timestamp
      updatedAt: now,
    };

    const validated = this.validate(updated);
    tagsFile.tags[index] = validated;
    await this.writeTagsFile(tagsFile);
    this.jsonStore.clearCache();

    return validated;
  }

  /**
   * Delete a tag
   */
  async delete(id: string): Promise<boolean> {
    const tagsFile = await this.readTagsFile();
    const initialLength = tagsFile.tags.length;

    tagsFile.tags = tagsFile.tags.filter(tag => tag.id !== id);

    if (tagsFile.tags.length === initialLength) {
      return false; // Tag not found
    }

    await this.writeTagsFile(tagsFile);
    this.jsonStore.clearCache();
    return true;
  }
}
