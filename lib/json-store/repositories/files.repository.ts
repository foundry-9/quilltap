/**
 * Files Repository
 *
 * Handles CRUD operations for FileEntry (centralized file management).
 * File metadata is stored in: data/files/files.jsonl
 * Binary payloads are stored in: data/files/storage/{id}.{ext}
 */

import { JsonStore } from '../core/json-store';
import { BaseRepository } from './base.repository';
import { FileEntry, FileEntrySchema, FileSource, FileCategory } from '../schemas/types';

export class FilesRepository extends BaseRepository<FileEntry> {
  constructor(jsonStore: JsonStore) {
    super(jsonStore, FileEntrySchema);
  }

  /**
   * Get the files index file path
   */
  private getIndexPath(): string {
    return 'files/files.jsonl';
  }

  /**
   * Read all file entries from JSONL index
   */
  private async readAllEntries(): Promise<FileEntry[]> {
    try {
      const entries = await this.jsonStore.readJsonl<FileEntry>(this.getIndexPath());
      return entries.map(entry => this.validate(entry));
    } catch (error) {
      return [];
    }
  }

  /**
   * Find a file entry by ID
   */
  async findById(id: string): Promise<FileEntry | null> {
    const entries = await this.readAllEntries();
    return entries.find(entry => entry.id === id) || null;
  }

  /**
   * Find all file entries
   */
  async findAll(): Promise<FileEntry[]> {
    return await this.readAllEntries();
  }

  /**
   * Find entries by SHA256 hash
   * Returns array for consistency with MongoDB (allows handling of hash collisions)
   */
  async findBySha256(sha256: string): Promise<FileEntry[]> {
    const entries = await this.readAllEntries();
    return entries.filter(entry => entry.sha256 === sha256);
  }

  /**
   * Find entries by category
   */
  async findByCategory(category: FileCategory): Promise<FileEntry[]> {
    const entries = await this.readAllEntries();
    return entries.filter(entry => entry.category === category);
  }

  /**
   * Find entries by source
   */
  async findBySource(source: FileSource): Promise<FileEntry[]> {
    const entries = await this.readAllEntries();
    return entries.filter(entry => entry.source === source);
  }

  /**
   * Find entries linked to a specific entity
   */
  async findByLinkedTo(entityId: string): Promise<FileEntry[]> {
    const entries = await this.readAllEntries();
    return entries.filter(entry => entry.linkedTo.includes(entityId));
  }

  /**
   * Find entries with a specific tag
   */
  async findByTag(tagId: string): Promise<FileEntry[]> {
    const entries = await this.readAllEntries();
    return entries.filter(entry => entry.tags.includes(tagId));
  }

  /**
   * Create a new file entry
   */
  async create(
    data: Omit<FileEntry, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<FileEntry> {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    const entry: FileEntry = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const validated = this.validate(entry);
    await this.jsonStore.appendJsonl(this.getIndexPath(), [validated]);

    return validated;
  }

  /**
   * Update a file entry (requires reading and rewriting the entire file)
   */
  async update(id: string, data: Partial<FileEntry>): Promise<FileEntry | null> {
    const entries = await this.readAllEntries();
    const index = entries.findIndex(entry => entry.id === id);

    if (index === -1) {
      return null;
    }

    const existing = entries[index];
    const now = this.getCurrentTimestamp();

    const updated: FileEntry = {
      ...existing,
      ...data,
      id: existing.id, // Preserve ID
      sha256: existing.sha256, // Preserve hash
      createdAt: existing.createdAt, // Preserve creation timestamp
      updatedAt: now,
    };

    const validated = this.validate(updated);
    entries[index] = validated;

    // Rewrite entire file as JSONL
    await this.jsonStore.writeJsonl(this.getIndexPath(), entries);

    return validated;
  }

  /**
   * Delete a file entry (by ID)
   */
  async delete(id: string): Promise<boolean> {
    const entries = await this.readAllEntries();
    const initialLength = entries.length;

    const filtered = entries.filter(entry => entry.id !== id);

    if (filtered.length === initialLength) {
      return false; // Entry not found
    }

    // Rewrite entire file as JSONL
    await this.jsonStore.writeJsonl(this.getIndexPath(), filtered);

    return true;
  }

  /**
   * Add a link to a file entry
   */
  async addLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    const entry = await this.findById(fileId);
    if (!entry) {
      return null;
    }

    if (!entry.linkedTo.includes(entityId)) {
      const updatedLinkedTo = [...entry.linkedTo, entityId];
      return await this.update(fileId, { linkedTo: updatedLinkedTo });
    }

    return entry;
  }

  /**
   * Remove a link from a file entry
   */
  async removeLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    const entry = await this.findById(fileId);
    if (!entry) {
      return null;
    }

    const updatedLinkedTo = entry.linkedTo.filter(id => id !== entityId);
    return await this.update(fileId, { linkedTo: updatedLinkedTo });
  }

  /**
   * Add a tag to a file entry
   */
  async addTag(fileId: string, tagId: string): Promise<FileEntry | null> {
    const entry = await this.findById(fileId);
    if (!entry) {
      return null;
    }

    if (!entry.tags.includes(tagId)) {
      const updatedTags = [...entry.tags, tagId];
      return await this.update(fileId, { tags: updatedTags });
    }

    return entry;
  }

  /**
   * Remove a tag from a file entry
   */
  async removeTag(fileId: string, tagId: string): Promise<FileEntry | null> {
    const entry = await this.findById(fileId);
    if (!entry) {
      return null;
    }

    const updatedTags = entry.tags.filter(id => id !== tagId);
    return await this.update(fileId, { tags: updatedTags });
  }
}
