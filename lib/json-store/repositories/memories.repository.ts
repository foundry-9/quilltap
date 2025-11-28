/**
 * Memories Repository
 *
 * Handles CRUD operations for Memory entities.
 * Memories are stored per-character: data/memories/by-character/{characterId}.json
 */

import { JsonStore } from '../core/json-store';
import { BaseRepository } from './base.repository';
import { Memory, MemorySchema, MemoriesFile, MemoriesFileSchema } from '../schemas/types';

export class MemoriesRepository extends BaseRepository<Memory> {
  constructor(jsonStore: JsonStore) {
    super(jsonStore, MemorySchema);
  }

  /**
   * Get the memories file path for a character
   */
  private getFilePath(characterId: string): string {
    return `memories/by-character/${characterId}.json`;
  }

  /**
   * Read memories file for a character with default structure
   */
  private async readMemoriesFile(characterId: string): Promise<MemoriesFile> {
    try {
      const filePath = this.getFilePath(characterId);
      const data = await this.jsonStore.readJson<MemoriesFile>(filePath);
      return MemoriesFileSchema.parse(data);
    } catch (error) {
      // Return default structure if file doesn't exist
      return {
        version: 1,
        memories: [],
        createdAt: this.getCurrentTimestamp(),
        updatedAt: this.getCurrentTimestamp(),
      };
    }
  }

  /**
   * Write memories file with validation
   */
  private async writeMemoriesFile(characterId: string, data: MemoriesFile): Promise<void> {
    const validated = MemoriesFileSchema.parse({
      ...data,
      updatedAt: this.getCurrentTimestamp(),
    });
    await this.jsonStore.writeJson(this.getFilePath(characterId), validated);
  }

  /**
   * Find a memory by ID
   * Note: This requires scanning all character memory files since we don't have a global index
   */
  async findById(id: string): Promise<Memory | null> {
    // Try to find in all character memory files
    const characterDirs = await this.listCharacterIds();

    for (const characterId of characterDirs) {
      const memoriesFile = await this.readMemoriesFile(characterId);
      const memory = memoriesFile.memories.find(m => m.id === id);
      if (memory) {
        return memory;
      }
    }

    return null;
  }

  /**
   * Find a memory by ID within a specific character's memories
   */
  async findByIdForCharacter(characterId: string, memoryId: string): Promise<Memory | null> {
    const memoriesFile = await this.readMemoriesFile(characterId);
    return memoriesFile.memories.find(m => m.id === memoryId) || null;
  }

  /**
   * Find all memories across all characters
   */
  async findAll(): Promise<Memory[]> {
    const characterDirs = await this.listCharacterIds();
    const allMemories: Memory[] = [];

    for (const characterId of characterDirs) {
      const memoriesFile = await this.readMemoriesFile(characterId);
      allMemories.push(...memoriesFile.memories);
    }

    return allMemories;
  }

  /**
   * Find all memories for a specific character
   */
  async findByCharacterId(characterId: string): Promise<Memory[]> {
    const memoriesFile = await this.readMemoriesFile(characterId);
    return memoriesFile.memories;
  }

  /**
   * Find memories by keywords (text-based search)
   */
  async findByKeywords(characterId: string, keywords: string[]): Promise<Memory[]> {
    const memoriesFile = await this.readMemoriesFile(characterId);
    const keywordsLower = keywords.map(k => k.toLowerCase());

    return memoriesFile.memories.filter(memory => {
      const memoryKeywordsLower = memory.keywords.map(k => k.toLowerCase());
      return keywordsLower.some(keyword =>
        memoryKeywordsLower.some(mk => mk.includes(keyword))
      );
    });
  }

  /**
   * Search memories by content (simple text search)
   */
  async searchByContent(characterId: string, query: string): Promise<Memory[]> {
    const memoriesFile = await this.readMemoriesFile(characterId);
    const queryLower = query.toLowerCase();

    return memoriesFile.memories.filter(memory =>
      memory.content.toLowerCase().includes(queryLower) ||
      memory.summary.toLowerCase().includes(queryLower) ||
      memory.keywords.some(k => k.toLowerCase().includes(queryLower))
    );
  }

  /**
   * Create a new memory
   */
  async create(data: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    const memory: Memory = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const validated = this.validate(memory);
    const memoriesFile = await this.readMemoriesFile(data.characterId);
    memoriesFile.memories.push(validated);
    await this.writeMemoriesFile(data.characterId, memoriesFile);

    return validated;
  }

  /**
   * Update a memory
   */
  async update(id: string, data: Partial<Memory>): Promise<Memory | null> {
    // We need to find which character this memory belongs to
    const characterId = data.characterId;

    if (!characterId) {
      // If characterId not provided in update, we need to find it
      const existingMemory = await this.findById(id);
      if (!existingMemory) {
        return null;
      }
      return this.updateForCharacter(existingMemory.characterId, id, data);
    }

    return this.updateForCharacter(characterId, id, data);
  }

  /**
   * Update a memory within a specific character's memories
   */
  async updateForCharacter(characterId: string, memoryId: string, data: Partial<Memory>): Promise<Memory | null> {
    const memoriesFile = await this.readMemoriesFile(characterId);
    const index = memoriesFile.memories.findIndex(m => m.id === memoryId);

    if (index === -1) {
      return null;
    }

    const existing = memoriesFile.memories[index];
    const now = this.getCurrentTimestamp();

    const updated: Memory = {
      ...existing,
      ...data,
      id: existing.id, // Preserve ID
      characterId: existing.characterId, // Preserve characterId
      createdAt: existing.createdAt, // Preserve creation timestamp
      updatedAt: now,
    };

    const validated = this.validate(updated);
    memoriesFile.memories[index] = validated;
    await this.writeMemoriesFile(characterId, memoriesFile);

    return validated;
  }

  /**
   * Delete a memory
   */
  async delete(id: string): Promise<boolean> {
    // Find which character this memory belongs to
    const memory = await this.findById(id);
    if (!memory) {
      return false;
    }

    return this.deleteForCharacter(memory.characterId, id);
  }

  /**
   * Delete a memory from a specific character
   */
  async deleteForCharacter(characterId: string, memoryId: string): Promise<boolean> {
    const memoriesFile = await this.readMemoriesFile(characterId);
    const initialLength = memoriesFile.memories.length;

    memoriesFile.memories = memoriesFile.memories.filter(m => m.id !== memoryId);

    if (memoriesFile.memories.length === initialLength) {
      return false; // Memory not found
    }

    await this.writeMemoriesFile(characterId, memoriesFile);
    return true;
  }

  /**
   * Bulk delete memories
   */
  async bulkDelete(characterId: string, memoryIds: string[]): Promise<number> {
    const memoriesFile = await this.readMemoriesFile(characterId);
    const initialLength = memoriesFile.memories.length;

    memoriesFile.memories = memoriesFile.memories.filter(m => !memoryIds.includes(m.id));

    const deletedCount = initialLength - memoriesFile.memories.length;

    if (deletedCount > 0) {
      await this.writeMemoriesFile(characterId, memoriesFile);
    }

    return deletedCount;
  }

  /**
   * Update last accessed time for a memory
   */
  async updateAccessTime(characterId: string, memoryId: string): Promise<boolean> {
    const result = await this.updateForCharacter(characterId, memoryId, {
      lastAccessedAt: this.getCurrentTimestamp(),
    });
    return result !== null;
  }

  /**
   * Get memory count for a character
   */
  async countByCharacterId(characterId: string): Promise<number> {
    const memoriesFile = await this.readMemoriesFile(characterId);
    return memoriesFile.memories.length;
  }

  /**
   * List all character IDs that have memories
   */
  private async listCharacterIds(): Promise<string[]> {
    try {
      const files = await this.jsonStore.listDir('memories/by-character');
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch (error) {
      // Directory doesn't exist yet
      return [];
    }
  }

  /**
   * Find memories by importance threshold
   */
  async findByImportance(characterId: string, minImportance: number): Promise<Memory[]> {
    const memoriesFile = await this.readMemoriesFile(characterId);
    return memoriesFile.memories.filter(m => m.importance >= minImportance);
  }

  /**
   * Find memories by source type
   */
  async findBySource(characterId: string, source: 'AUTO' | 'MANUAL'): Promise<Memory[]> {
    const memoriesFile = await this.readMemoriesFile(characterId);
    return memoriesFile.memories.filter(m => m.source === source);
  }

  /**
   * Get most recent memories for a character
   */
  async findRecent(characterId: string, limit: number = 10): Promise<Memory[]> {
    const memoriesFile = await this.readMemoriesFile(characterId);
    return memoriesFile.memories
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  /**
   * Get most important memories for a character
   */
  async findMostImportant(characterId: string, limit: number = 10): Promise<Memory[]> {
    const memoriesFile = await this.readMemoriesFile(characterId);
    return memoriesFile.memories
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
  }
}
