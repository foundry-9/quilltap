/**
 * Characters Repository
 *
 * Handles CRUD operations for Character entities.
 * Each character is stored in a separate file: data/characters/{characterId}.json
 */

import { JsonStore } from '../core/json-store';
import { BaseRepository } from './base.repository';
import { Character, CharacterSchema } from '../schemas/types';

export class CharactersRepository extends BaseRepository<Character> {
  constructor(jsonStore: JsonStore) {
    super(jsonStore, CharacterSchema);
  }

  /**
   * Find a character by ID
   */
  async findById(id: string): Promise<Character | null> {
    try {
      const filePath = `characters/${id}.json`;
      const data = await this.jsonStore.readJson<Character>(filePath);
      return this.validate(data);
    } catch (error) {
      return null;
    }
  }

  /**
   * Find all characters (requires scanning directory)
   */
  async findAll(): Promise<Character[]> {
    const characters: Character[] = [];
    try {
      const files = await this.jsonStore.listDir('characters');
      for (const file of files) {
        if (file.endsWith('.json')) {
          const id = file.replace('.json', '');
          const character = await this.findById(id);
          if (character) {
            characters.push(character);
          }
        }
      }
    } catch (error) {
      console.error('Error listing characters:', error);
    }
    return characters;
  }

  /**
   * Find characters by user ID
   */
  async findByUserId(userId: string): Promise<Character[]> {
    const characters = await this.findAll();
    return characters.filter(c => c.userId === userId);
  }

  /**
   * Find characters with a specific tag
   */
  async findByTag(tagId: string): Promise<Character[]> {
    const characters = await this.findAll();
    return characters.filter(c => c.tags.includes(tagId));
  }

  /**
   * Create a new character
   */
  async create(data: Omit<Character, 'id' | 'createdAt' | 'updatedAt'>): Promise<Character> {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    const character: Character = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const validated = this.validate(character);
    const filePath = `characters/${id}.json`;
    await this.jsonStore.writeJson(filePath, validated);

    return validated;
  }

  /**
   * Update a character
   */
  async update(id: string, data: Partial<Character>): Promise<Character | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const now = this.getCurrentTimestamp();
    const updated: Character = {
      ...existing,
      ...data,
      id: existing.id, // Preserve ID
      createdAt: existing.createdAt, // Preserve creation timestamp
      updatedAt: now,
    };

    const validated = this.validate(updated);
    const filePath = `characters/${id}.json`;
    await this.jsonStore.writeJson(filePath, validated);

    return validated;
  }

  /**
   * Delete a character
   */
  async delete(id: string): Promise<boolean> {
    const filePath = `characters/${id}.json`;
    try {
      await this.jsonStore.deleteFile(filePath);
      return true;
    } catch (error) {
      console.error(`Failed to delete character ${id}:`, error);
      return false;
    }
  }

  /**
   * Add a tag to a character
   */
  async addTag(characterId: string, tagId: string): Promise<Character | null> {
    const character = await this.findById(characterId);
    if (!character) {
      return null;
    }

    if (!character.tags.includes(tagId)) {
      character.tags.push(tagId);
      return await this.update(characterId, { tags: character.tags });
    }

    return character;
  }

  /**
   * Remove a tag from a character
   */
  async removeTag(characterId: string, tagId: string): Promise<Character | null> {
    const character = await this.findById(characterId);
    if (!character) {
      return null;
    }

    character.tags = character.tags.filter(id => id !== tagId);
    return await this.update(characterId, { tags: character.tags });
  }

  /**
   * Add a persona link to a character
   */
  async addPersona(characterId: string, personaId: string, isDefault = false): Promise<Character | null> {
    const character = await this.findById(characterId);
    if (!character) {
      return null;
    }

    const existing = character.personaLinks.find(link => link.personaId === personaId);
    if (!existing) {
      character.personaLinks.push({ personaId, isDefault });
      return await this.update(characterId, { personaLinks: character.personaLinks });
    }

    return character;
  }

  /**
   * Remove a persona link from a character
   */
  async removePersona(characterId: string, personaId: string): Promise<Character | null> {
    const character = await this.findById(characterId);
    if (!character) {
      return null;
    }

    character.personaLinks = character.personaLinks.filter(link => link.personaId !== personaId);
    return await this.update(characterId, { personaLinks: character.personaLinks });
  }

  /**
   * Set favorite status
   */
  async setFavorite(characterId: string, isFavorite: boolean): Promise<Character | null> {
    return await this.update(characterId, { isFavorite });
  }
}
