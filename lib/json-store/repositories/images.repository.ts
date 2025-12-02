/**
 * Images Repository (DEPRECATED)
 *
 * @deprecated This repository is deprecated as of the dual-system migration.
 * All image/file operations should now use the file-manager system instead.
 * See: lib/file-manager/index.ts
 *
 * This repository is kept for:
 * 1. Running the consolidate-images migration script
 * 2. Reference during the transition period
 * 3. Backward compatibility with any legacy code still being updated
 *
 * DO NOT USE THIS REPOSITORY FOR NEW CODE.
 * Use the file-manager functions instead:
 * - findFileById() instead of findById()
 * - findFilesByCategory('IMAGE') instead of findByType('image')
 * - addFileTag() instead of addTag()
 * - etc.
 *
 * Old structure (legacy):
 * - data/binaries/index.jsonl (BinaryIndexEntry format)
 *
 * New structure (use this):
 * - public/data/files/files.jsonl (FileEntry format)
 * - public/data/files/storage/{id}.{ext}
 */

import { JsonStore } from '../core/json-store';
import { BaseRepository } from './base.repository';
import { BinaryIndexEntry, BinaryIndexEntrySchema } from '../schemas/types';

export class ImagesRepository extends BaseRepository<BinaryIndexEntry> {
  constructor(jsonStore: JsonStore) {
    super(jsonStore, BinaryIndexEntrySchema);
  }

  /**
   * Get the binaries index file path
   */
  private getIndexPath(): string {
    return 'binaries/index.jsonl';
  }

  /**
   * Read all binary entries from JSONL index
   */
  private async readAllEntries(): Promise<BinaryIndexEntry[]> {
    try {
      const entries = await this.jsonStore.readJsonl<BinaryIndexEntry>(this.getIndexPath());
      return entries.map(entry => this.validate(entry));
    } catch (error) {
      return [];
    }
  }

  /**
   * Find a binary entry by ID
   */
  async findById(id: string): Promise<BinaryIndexEntry | null> {
    const entries = await this.readAllEntries();
    return entries.find(entry => entry.id === id) || null;
  }

  /**
   * Find all binary entries
   */
  async findAll(): Promise<BinaryIndexEntry[]> {
    return await this.readAllEntries();
  }

  /**
   * Find entries by user ID
   */
  async findByUserId(userId: string): Promise<BinaryIndexEntry[]> {
    const entries = await this.readAllEntries();
    return entries.filter(entry => entry.userId === userId);
  }

  /**
   * Find entries by type
   */
  async findByType(type: 'image' | 'chat_file' | 'avatar'): Promise<BinaryIndexEntry[]> {
    const entries = await this.readAllEntries();
    return entries.filter(entry => entry.type === type);
  }

  /**
   * Find entries by chat ID
   */
  async findByChatId(chatId: string): Promise<BinaryIndexEntry[]> {
    const entries = await this.readAllEntries();
    return entries.filter(entry => entry.chatId === chatId);
  }

  /**
   * Find entries by message ID
   */
  async findByMessageId(messageId: string): Promise<BinaryIndexEntry[]> {
    const entries = await this.readAllEntries();
    return entries.filter(entry => entry.messageId === messageId);
  }

  /**
   * Find entries with a specific tag
   */
  async findByTag(tagId: string): Promise<BinaryIndexEntry[]> {
    const entries = await this.readAllEntries();
    return entries.filter(entry => entry.tags.includes(tagId));
  }

  /**
   * Find entries by SHA256 hash
   */
  async findBySha256(sha256: string): Promise<BinaryIndexEntry | null> {
    const entries = await this.readAllEntries();
    return entries.find(entry => entry.sha256 === sha256) || null;
  }

  /**
   * Create a new binary entry
   */
  async create(
    data: Omit<BinaryIndexEntry, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<BinaryIndexEntry> {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    const entry: BinaryIndexEntry = {
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
   * Update a binary entry (requires reading and rewriting the entire file)
   */
  async update(id: string, data: Partial<BinaryIndexEntry>): Promise<BinaryIndexEntry | null> {
    const entries = await this.readAllEntries();
    const index = entries.findIndex(entry => entry.id === id);

    if (index === -1) {
      return null;
    }

    const existing = entries[index];
    const now = this.getCurrentTimestamp();

    const updated: BinaryIndexEntry = {
      ...existing,
      ...data,
      id: existing.id, // Preserve ID
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
   * Delete a binary entry (by ID)
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
   * Delete a binary entry by SHA256 hash
   */
  async deleteBySha256(sha256: string): Promise<boolean> {
    const entries = await this.readAllEntries();
    const initialLength = entries.length;

    const filtered = entries.filter(entry => entry.sha256 !== sha256);

    if (filtered.length === initialLength) {
      return false; // Hash not found
    }

    // Rewrite entire file as JSONL
    await this.jsonStore.writeJsonl(this.getIndexPath(), filtered);

    return true;
  }

  /**
   * Add a tag to a binary entry
   */
  async addTag(entryId: string, tagId: string): Promise<BinaryIndexEntry | null> {
    const entry = await this.findById(entryId);
    if (!entry) {
      return null;
    }

    if (!entry.tags.includes(tagId)) {
      entry.tags.push(tagId);
      return await this.update(entryId, { tags: entry.tags });
    }

    return entry;
  }

  /**
   * Remove a tag from a binary entry
   */
  async removeTag(entryId: string, tagId: string): Promise<BinaryIndexEntry | null> {
    const entry = await this.findById(entryId);
    if (!entry) {
      return null;
    }

    entry.tags = entry.tags.filter(id => id !== tagId);
    return await this.update(entryId, { tags: entry.tags });
  }
}
