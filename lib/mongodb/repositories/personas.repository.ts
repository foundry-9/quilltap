/**
 * MongoDB Personas Repository
 *
 * Handles CRUD operations for Persona entities in MongoDB.
 * Provides methods for managing personas, tags, character links, and physical descriptions.
 */

import { Collection, ObjectId } from 'mongodb';
import { Persona, PersonaSchema, PhysicalDescription } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { MongoBaseRepository } from './base.repository';

export class PersonasRepository extends MongoBaseRepository<Persona> {
  constructor() {
    super('personas', PersonaSchema);
  }

  /**
   * Find a persona by ID
   */
  async findById(id: string): Promise<Persona | null> {
    try {
      logger.debug('Finding persona by ID', { personaId: id, collection: this.collectionName });
      
      const collection = await this.getCollection();
      const doc = await collection.findOne({ id });

      if (!doc) {
        logger.debug('Persona not found', { personaId: id });
        return null;
      }

      const validated = this.validate(doc);
      logger.debug('Persona found and validated', { personaId: id });
      return validated;
    } catch (error) {
      logger.error('Error finding persona by ID', {
        personaId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all personas
   */
  async findAll(): Promise<Persona[]> {
    try {
      logger.debug('Finding all personas', { collection: this.collectionName });
      
      const collection = await this.getCollection();
      const docs = await collection.find({}).toArray();

      logger.debug('Retrieved personas from database', { count: docs.length });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('All personas validated', { total: docs.length, validated: validated.length });
      return validated;
    } catch (error) {
      logger.error('Error finding all personas', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find personas by user ID
   */
  async findByUserId(userId: string): Promise<Persona[]> {
    try {
      logger.debug('Finding personas by user ID', { userId, collection: this.collectionName });
      
      const collection = await this.getCollection();
      const docs = await collection.find({ userId }).toArray();

      logger.debug('Retrieved personas for user', { userId, count: docs.length });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('User personas validated', { userId, total: docs.length, validated: validated.length });
      return validated;
    } catch (error) {
      logger.error('Error finding personas by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find personas with a specific tag
   */
  async findByTag(tagId: string): Promise<Persona[]> {
    try {
      logger.debug('Finding personas by tag', { tagId, collection: this.collectionName });
      
      const collection = await this.getCollection();
      const docs = await collection.find({ tags: tagId }).toArray();

      logger.debug('Retrieved personas with tag', { tagId, count: docs.length });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('Tag personas validated', { tagId, total: docs.length, validated: validated.length });
      return validated;
    } catch (error) {
      logger.error('Error finding personas by tag', {
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Create a new persona
   */
  async create(data: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>): Promise<Persona> {
    try {
      logger.debug('Creating new persona', {
        userId: data.userId,
        name: data.name,
        collection: this.collectionName,
      });

      const id = this.generateId();
      const now = this.getCurrentTimestamp();

      const persona: Persona = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(persona);

      const collection = await this.getCollection();
      const result = await collection.insertOne(validated as any);

      logger.info('Persona created successfully', {
        personaId: id,
        userId: data.userId,
        insertedId: result.insertedId.toString(),
      });

      return validated;
    } catch (error) {
      logger.error('Error creating persona', {
        userId: data.userId,
        name: data.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a persona
   */
  async update(id: string, data: Partial<Persona>): Promise<Persona | null> {
    try {
      logger.debug('Updating persona', { personaId: id, collection: this.collectionName });

      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Persona not found for update', { personaId: id });
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

      const collection = await this.getCollection();
      const result = await collection.updateOne(
        { id },
        { $set: validated as any }
      );

      logger.info('Persona updated successfully', {
        personaId: id,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });

      return validated;
    } catch (error) {
      logger.error('Error updating persona', {
        personaId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a persona
   */
  async delete(id: string): Promise<boolean> {
    try {
      logger.debug('Deleting persona', { personaId: id, collection: this.collectionName });

      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Persona not found for deletion', { personaId: id });
        return false;
      }

      logger.info('Persona deleted successfully', {
        personaId: id,
        deletedCount: result.deletedCount,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting persona', {
        personaId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add a tag to a persona
   */
  async addTag(personaId: string, tagId: string): Promise<Persona | null> {
    try {
      logger.debug('Adding tag to persona', { personaId, tagId, collection: this.collectionName });

      const persona = await this.findById(personaId);
      if (!persona) {
        logger.warn('Persona not found for tag addition', { personaId });
        return null;
      }

      if (!persona.tags.includes(tagId)) {
        persona.tags.push(tagId);
        logger.debug('Tag added to persona tags array', { personaId, tagId, totalTags: persona.tags.length });
        return await this.update(personaId, { tags: persona.tags });
      }

      logger.debug('Tag already exists for persona', { personaId, tagId });
      return persona;
    } catch (error) {
      logger.error('Error adding tag to persona', {
        personaId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a tag from a persona
   */
  async removeTag(personaId: string, tagId: string): Promise<Persona | null> {
    try {
      logger.debug('Removing tag from persona', { personaId, tagId, collection: this.collectionName });

      const persona = await this.findById(personaId);
      if (!persona) {
        logger.warn('Persona not found for tag removal', { personaId });
        return null;
      }

      const initialLength = persona.tags.length;
      persona.tags = persona.tags.filter((id) => id !== tagId);

      if (persona.tags.length < initialLength) {
        logger.debug('Tag removed from persona tags array', {
          personaId,
          tagId,
          totalTags: persona.tags.length,
        });
        return await this.update(personaId, { tags: persona.tags });
      }

      logger.debug('Tag not found in persona tags', { personaId, tagId });
      return persona;
    } catch (error) {
      logger.error('Error removing tag from persona', {
        personaId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add a character link to a persona
   */
  async addCharacterLink(personaId: string, characterId: string): Promise<Persona | null> {
    try {
      logger.debug('Adding character link to persona', {
        personaId,
        characterId,
        collection: this.collectionName,
      });

      const persona = await this.findById(personaId);
      if (!persona) {
        logger.warn('Persona not found for character link addition', { personaId });
        return null;
      }

      if (!persona.characterLinks.includes(characterId)) {
        persona.characterLinks.push(characterId);
        logger.debug('Character link added to persona', {
          personaId,
          characterId,
          totalLinks: persona.characterLinks.length,
        });
        return await this.update(personaId, { characterLinks: persona.characterLinks });
      }

      logger.debug('Character link already exists for persona', { personaId, characterId });
      return persona;
    } catch (error) {
      logger.error('Error adding character link to persona', {
        personaId,
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a character link from a persona
   */
  async removeCharacterLink(personaId: string, characterId: string): Promise<Persona | null> {
    try {
      logger.debug('Removing character link from persona', {
        personaId,
        characterId,
        collection: this.collectionName,
      });

      const persona = await this.findById(personaId);
      if (!persona) {
        logger.warn('Persona not found for character link removal', { personaId });
        return null;
      }

      const initialLength = persona.characterLinks.length;
      persona.characterLinks = persona.characterLinks.filter((id) => id !== characterId);

      if (persona.characterLinks.length < initialLength) {
        logger.debug('Character link removed from persona', {
          personaId,
          characterId,
          totalLinks: persona.characterLinks.length,
        });
        return await this.update(personaId, { characterLinks: persona.characterLinks });
      }

      logger.debug('Character link not found in persona', { personaId, characterId });
      return persona;
    } catch (error) {
      logger.error('Error removing character link from persona', {
        personaId,
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    try {
      logger.debug('Adding physical description to persona', {
        personaId,
        descriptionName: data.name,
        collection: this.collectionName,
      });

      const persona = await this.findById(personaId);
      if (!persona) {
        logger.warn('Persona not found for description addition', { personaId });
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

      logger.debug('Physical description added to persona', {
        personaId,
        descriptionId: description.id,
        totalDescriptions: persona.physicalDescriptions.length,
      });

      await this.update(personaId, { physicalDescriptions: persona.physicalDescriptions });

      return description;
    } catch (error) {
      logger.error('Error adding physical description to persona', {
        personaId,
        descriptionName: data.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a physical description
   */
  async updateDescription(
    personaId: string,
    descriptionId: string,
    data: Partial<Omit<PhysicalDescription, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<PhysicalDescription | null> {
    try {
      logger.debug('Updating physical description', {
        personaId,
        descriptionId,
        collection: this.collectionName,
      });

      const persona = await this.findById(personaId);
      if (!persona) {
        logger.warn('Persona not found for description update', { personaId });
        return null;
      }

      const descriptions = persona.physicalDescriptions || [];
      const index = descriptions.findIndex((d) => d.id === descriptionId);

      if (index === -1) {
        logger.warn('Physical description not found for update', {
          personaId,
          descriptionId,
        });
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

      logger.debug('Physical description updated', {
        personaId,
        descriptionId,
        totalDescriptions: descriptions.length,
      });

      await this.update(personaId, { physicalDescriptions: descriptions });

      return updated;
    } catch (error) {
      logger.error('Error updating physical description', {
        personaId,
        descriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a physical description from a persona
   */
  async removeDescription(personaId: string, descriptionId: string): Promise<boolean> {
    try {
      logger.debug('Removing physical description from persona', {
        personaId,
        descriptionId,
        collection: this.collectionName,
      });

      const persona = await this.findById(personaId);
      if (!persona) {
        logger.warn('Persona not found for description removal', { personaId });
        return false;
      }

      const descriptions = persona.physicalDescriptions || [];
      const filtered = descriptions.filter((d) => d.id !== descriptionId);

      if (filtered.length === descriptions.length) {
        logger.warn('Physical description not found for removal', {
          personaId,
          descriptionId,
        });
        return false;
      }

      logger.debug('Physical description removed from persona', {
        personaId,
        descriptionId,
        totalDescriptions: filtered.length,
      });

      await this.update(personaId, { physicalDescriptions: filtered });

      return true;
    } catch (error) {
      logger.error('Error removing physical description from persona', {
        personaId,
        descriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a single physical description by ID
   */
  async getDescription(personaId: string, descriptionId: string): Promise<PhysicalDescription | null> {
    try {
      logger.debug('Getting physical description', {
        personaId,
        descriptionId,
        collection: this.collectionName,
      });

      const persona = await this.findById(personaId);
      if (!persona) {
        logger.warn('Persona not found for description retrieval', { personaId });
        return null;
      }

      const descriptions = persona.physicalDescriptions || [];
      const description = descriptions.find((d) => d.id === descriptionId) || null;

      if (description) {
        logger.debug('Physical description retrieved', { personaId, descriptionId });
      } else {
        logger.debug('Physical description not found', { personaId, descriptionId });
      }

      return description;
    } catch (error) {
      logger.error('Error getting physical description', {
        personaId,
        descriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all physical descriptions for a persona
   */
  async getDescriptions(personaId: string): Promise<PhysicalDescription[]> {
    try {
      logger.debug('Getting all physical descriptions for persona', {
        personaId,
        collection: this.collectionName,
      });

      const persona = await this.findById(personaId);
      if (!persona) {
        logger.warn('Persona not found for descriptions retrieval', { personaId });
        return [];
      }

      const descriptions = persona.physicalDescriptions || [];
      logger.debug('Physical descriptions retrieved', {
        personaId,
        count: descriptions.length,
      });

      return descriptions;
    } catch (error) {
      logger.error('Error getting physical descriptions', {
        personaId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
