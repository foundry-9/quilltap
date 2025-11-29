/**
 * Personas Repository
 *
 * Handles CRUD operations for Persona entities.
 * Each persona is stored in a separate file: data/personas/{personaId}.json
 */

import { JsonStore } from '../core/json-store';
import { BaseRepository } from './base.repository';
import { Persona, PersonaSchema, PhysicalDescription } from '../schemas/types';

export class PersonasRepository extends BaseRepository<Persona> {
  constructor(jsonStore: JsonStore) {
    super(jsonStore, PersonaSchema);
  }

  /**
   * Find a persona by ID
   */
  async findById(id: string): Promise<Persona | null> {
    try {
      const filePath = `personas/${id}.json`;
      const data = await this.jsonStore.readJson<Persona>(filePath);
      return this.validate(data);
    } catch (error) {
      return null;
    }
  }

  /**
   * Find all personas (requires scanning directory)
   */
  async findAll(): Promise<Persona[]> {
    const personas: Persona[] = [];
    try {
      const files = await this.jsonStore.listDir('personas');
      for (const file of files) {
        if (file.endsWith('.json')) {
          const id = file.replace('.json', '');
          const persona = await this.findById(id);
          if (persona) {
            personas.push(persona);
          }
        }
      }
    } catch (error) {
      console.error('Error listing personas:', error);
    }
    return personas;
  }

  /**
   * Find personas by user ID
   */
  async findByUserId(userId: string): Promise<Persona[]> {
    const personas = await this.findAll();
    return personas.filter(p => p.userId === userId);
  }

  /**
   * Find personas with a specific tag
   */
  async findByTag(tagId: string): Promise<Persona[]> {
    const personas = await this.findAll();
    return personas.filter(p => p.tags.includes(tagId));
  }

  /**
   * Create a new persona
   */
  async create(data: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>): Promise<Persona> {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    const persona: Persona = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const validated = this.validate(persona);
    const filePath = `personas/${id}.json`;
    await this.jsonStore.writeJson(filePath, validated);

    return validated;
  }

  /**
   * Update a persona
   */
  async update(id: string, data: Partial<Persona>): Promise<Persona | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const now = this.getCurrentTimestamp();
    const updated: Persona = {
      ...existing,
      ...data,
      id: existing.id, // Preserve ID
      createdAt: existing.createdAt, // Preserve creation timestamp
      updatedAt: now,
    };

    const validated = this.validate(updated);
    const filePath = `personas/${id}.json`;
    await this.jsonStore.writeJson(filePath, validated);

    return validated;
  }

  /**
   * Delete a persona
   */
  async delete(id: string): Promise<boolean> {
    const filePath = `personas/${id}.json`;
    try {
      await this.jsonStore.deleteFile(filePath);
      return true;
    } catch (error) {
      console.error(`Failed to delete persona ${id}:`, error);
      return false;
    }
  }

  /**
   * Add a tag to a persona
   */
  async addTag(personaId: string, tagId: string): Promise<Persona | null> {
    const persona = await this.findById(personaId);
    if (!persona) {
      return null;
    }

    if (!persona.tags.includes(tagId)) {
      persona.tags.push(tagId);
      return await this.update(personaId, { tags: persona.tags });
    }

    return persona;
  }

  /**
   * Remove a tag from a persona
   */
  async removeTag(personaId: string, tagId: string): Promise<Persona | null> {
    const persona = await this.findById(personaId);
    if (!persona) {
      return null;
    }

    persona.tags = persona.tags.filter(id => id !== tagId);
    return await this.update(personaId, { tags: persona.tags });
  }

  /**
   * Add a character link to a persona
   */
  async addCharacterLink(personaId: string, characterId: string): Promise<Persona | null> {
    const persona = await this.findById(personaId);
    if (!persona) {
      return null;
    }

    if (!persona.characterLinks.includes(characterId)) {
      persona.characterLinks.push(characterId);
      return await this.update(personaId, { characterLinks: persona.characterLinks });
    }

    return persona;
  }

  /**
   * Remove a character link from a persona
   */
  async removeCharacterLink(personaId: string, characterId: string): Promise<Persona | null> {
    const persona = await this.findById(personaId);
    if (!persona) {
      return null;
    }

    persona.characterLinks = persona.characterLinks.filter(id => id !== characterId);
    return await this.update(personaId, { characterLinks: persona.characterLinks });
  }

  // ============================================================================
  // PHYSICAL DESCRIPTIONS
  // ============================================================================

  /**
   * Add a physical description to a persona
   */
  async addDescription(
    personaId: string,
    data: Omit<PhysicalDescription, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<PhysicalDescription | null> {
    const persona = await this.findById(personaId);
    if (!persona) {
      return null;
    }

    const now = this.getCurrentTimestamp();
    const description: PhysicalDescription = {
      ...data,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
    };

    persona.physicalDescriptions = persona.physicalDescriptions || [];
    persona.physicalDescriptions.push(description);
    await this.update(personaId, { physicalDescriptions: persona.physicalDescriptions });

    return description;
  }

  /**
   * Update a physical description
   */
  async updateDescription(
    personaId: string,
    descriptionId: string,
    data: Partial<Omit<PhysicalDescription, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<PhysicalDescription | null> {
    const persona = await this.findById(personaId);
    if (!persona) {
      return null;
    }

    const descriptions = persona.physicalDescriptions || [];
    const index = descriptions.findIndex(d => d.id === descriptionId);
    if (index === -1) {
      return null;
    }

    const now = this.getCurrentTimestamp();
    const updated: PhysicalDescription = {
      ...descriptions[index],
      ...data,
      id: descriptions[index].id,
      createdAt: descriptions[index].createdAt,
      updatedAt: now,
    };

    descriptions[index] = updated;
    await this.update(personaId, { physicalDescriptions: descriptions });

    return updated;
  }

  /**
   * Remove a physical description from a persona
   */
  async removeDescription(personaId: string, descriptionId: string): Promise<boolean> {
    const persona = await this.findById(personaId);
    if (!persona) {
      return false;
    }

    const descriptions = persona.physicalDescriptions || [];
    const filtered = descriptions.filter(d => d.id !== descriptionId);

    if (filtered.length === descriptions.length) {
      return false; // Description not found
    }

    await this.update(personaId, { physicalDescriptions: filtered });
    return true;
  }

  /**
   * Get a single physical description by ID
   */
  async getDescription(personaId: string, descriptionId: string): Promise<PhysicalDescription | null> {
    const persona = await this.findById(personaId);
    if (!persona) {
      return null;
    }

    const descriptions = persona.physicalDescriptions || [];
    return descriptions.find(d => d.id === descriptionId) || null;
  }

  /**
   * Get all physical descriptions for a persona
   */
  async getDescriptions(personaId: string): Promise<PhysicalDescription[]> {
    const persona = await this.findById(personaId);
    if (!persona) {
      return [];
    }

    return persona.physicalDescriptions || [];
  }
}
