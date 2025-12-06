/**
 * MongoDB Files Repository
 *
 * Repository for managing file entries in MongoDB.
 * Handles CRUD operations on file metadata including linking, tagging, and S3 references.
 */

import { Collection } from 'mongodb';
import { logger } from '@/lib/logger';
import { MongoBaseRepository } from './base.repository';
import { FileEntry, FileEntrySchema, FileCategory, FileSource } from '@/lib/schemas/types';

/**
 * Files Repository for MongoDB
 * Manages file metadata storage and retrieval
 */
export class FilesRepository extends MongoBaseRepository<FileEntry> {
  constructor() {
    super('files', FileEntrySchema);
    logger.debug('FilesRepository initialized', { collection: this.collectionName });
  }

  /**
   * Find file by ID
   */
  async findById(id: string): Promise<FileEntry | null> {
    try {
      logger.debug('Finding file by ID', { fileId: id });
      const collection = await this.getCollection();
      const file = await collection.findOne({ id });

      if (file) {
        logger.debug('File found', { fileId: id });
        return this.validate(file);
      }

      logger.debug('File not found', { fileId: id });
      return null;
    } catch (error) {
      logger.error('Error finding file by ID', { fileId: id, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find all files
   */
  async findAll(): Promise<FileEntry[]> {
    try {
      logger.debug('Finding all files');
      const collection = await this.getCollection();
      const files = await collection.find({}).toArray();

      logger.debug('Files retrieved', { count: files.length });
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding all files', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find files by SHA256 content hash (for deduplication)
   */
  async findBySha256(sha256: string): Promise<FileEntry[]> {
    try {
      logger.debug('Finding files by SHA256', { sha256 });
      const collection = await this.getCollection();
      const files = await collection.find({ sha256 }).toArray();

      logger.debug('Files found by SHA256', { sha256, count: files.length });
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding files by SHA256', { sha256, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find files by category
   */
  async findByCategory(category: FileCategory): Promise<FileEntry[]> {
    try {
      logger.debug('Finding files by category', { category });
      const collection = await this.getCollection();
      const files = await collection.find({ category }).toArray();

      logger.debug('Files found by category', { category, count: files.length });
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding files by category', { category, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find files by source
   */
  async findBySource(source: FileSource): Promise<FileEntry[]> {
    try {
      logger.debug('Finding files by source', { source });
      const collection = await this.getCollection();
      const files = await collection.find({ source }).toArray();

      logger.debug('Files found by source', { source, count: files.length });
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding files by source', { source, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find files linked to a specific entity
   */
  async findByLinkedTo(entityId: string): Promise<FileEntry[]> {
    try {
      logger.debug('Finding files linked to entity', { entityId });
      const collection = await this.getCollection();
      const files = await collection.find({ linkedTo: entityId }).toArray();

      logger.debug('Files found linked to entity', { entityId, count: files.length });
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding files linked to entity', { entityId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find files with a specific tag
   */
  async findByTag(tagId: string): Promise<FileEntry[]> {
    try {
      logger.debug('Finding files by tag', { tagId });
      const collection = await this.getCollection();
      const files = await collection.find({ tags: tagId }).toArray();

      logger.debug('Files found by tag', { tagId, count: files.length });
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding files by tag', { tagId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find files for a user
   */
  async findByUserId(userId: string): Promise<FileEntry[]> {
    try {
      logger.debug('Finding files by user ID', { userId });
      const collection = await this.getCollection();
      const files = await collection.find({ userId }).toArray();

      logger.debug('Files found for user', { userId, count: files.length });
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding files by user ID', { userId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Create new file entry
   */
  async create(data: Omit<FileEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<FileEntry> {
    try {
      logger.debug('Creating new file', { userId: data.userId, filename: data.originalFilename });

      const id = this.generateId();
      const now = this.getCurrentTimestamp();

      const newFile: FileEntry = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(newFile);
      const collection = await this.getCollection();

      await collection.insertOne(validated as any);

      logger.info('File created', { fileId: id, userId: data.userId, filename: data.originalFilename });
      return validated;
    } catch (error) {
      logger.error('Error creating file', {
        userId: data.userId,
        filename: data.originalFilename,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Update file entry
   */
  async update(id: string, data: Partial<Omit<FileEntry, 'id' | 'createdAt'>>): Promise<FileEntry | null> {
    try {
      logger.debug('Updating file', { fileId: id });

      const now = this.getCurrentTimestamp();
      const updateData = {
        $set: {
          ...data,
          updatedAt: now,
        },
      };

      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { id },
        updateData,
        { returnDocument: 'after' }
      );

      if (result) {
        logger.info('File updated', { fileId: id });
        return this.validate(result);
      }

      logger.warn('File not found for update', { fileId: id });
      return null;
    } catch (error) {
      logger.error('Error updating file', { fileId: id, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Delete file entry
   */
  async delete(id: string): Promise<boolean> {
    try {
      logger.debug('Deleting file', { fileId: id });

      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount > 0) {
        logger.info('File deleted', { fileId: id });
        return true;
      }

      logger.warn('File not found for deletion', { fileId: id });
      return false;
    } catch (error) {
      logger.error('Error deleting file', { fileId: id, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Add entity to linkedTo array
   */
  async addLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    try {
      logger.debug('Adding link to file', { fileId, entityId });

      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { id: fileId },
        {
          $addToSet: { linkedTo: entityId },
          $set: { updatedAt: this.getCurrentTimestamp() },
        },
        { returnDocument: 'after' }
      );

      if (result) {
        logger.info('Link added to file', { fileId, entityId });
        return this.validate(result);
      }

      logger.warn('File not found for adding link', { fileId });
      return null;
    } catch (error) {
      logger.error('Error adding link to file', { fileId, entityId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Remove entity from linkedTo array
   */
  async removeLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    try {
      logger.debug('Removing link from file', { fileId, entityId });

      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { id: fileId },
        {
          $pull: { linkedTo: entityId },
          $set: { updatedAt: this.getCurrentTimestamp() },
        } as any,
        { returnDocument: 'after' }
      );

      if (result) {
        logger.info('Link removed from file', { fileId, entityId });
        return this.validate(result);
      }

      logger.warn('File not found for removing link', { fileId });
      return null;
    } catch (error) {
      logger.error('Error removing link from file', { fileId, entityId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Add tag to file
   */
  async addTag(fileId: string, tagId: string): Promise<FileEntry | null> {
    try {
      logger.debug('Adding tag to file', { fileId, tagId });

      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { id: fileId },
        {
          $addToSet: { tags: tagId },
          $set: { updatedAt: this.getCurrentTimestamp() },
        },
        { returnDocument: 'after' }
      );

      if (result) {
        logger.info('Tag added to file', { fileId, tagId });
        return this.validate(result);
      }

      logger.warn('File not found for adding tag', { fileId });
      return null;
    } catch (error) {
      logger.error('Error adding tag to file', { fileId, tagId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Remove tag from file
   */
  async removeTag(fileId: string, tagId: string): Promise<FileEntry | null> {
    try {
      logger.debug('Removing tag from file', { fileId, tagId });

      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { id: fileId },
        {
          $pull: { tags: tagId },
          $set: { updatedAt: this.getCurrentTimestamp() },
        } as any,
        { returnDocument: 'after' }
      );

      if (result) {
        logger.info('Tag removed from file', { fileId, tagId });
        return this.validate(result);
      }

      logger.warn('File not found for removing tag', { fileId });
      return null;
    } catch (error) {
      logger.error('Error removing tag from file', { fileId, tagId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Update S3 storage reference
   */
  async updateS3Reference(fileId: string, s3Key: string, s3Bucket: string): Promise<FileEntry | null> {
    try {
      logger.debug('Updating S3 reference for file', { fileId, s3Key, s3Bucket });

      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { id: fileId },
        {
          $set: {
            s3Key,
            s3Bucket,
            updatedAt: this.getCurrentTimestamp(),
          },
        },
        { returnDocument: 'after' }
      );

      if (result) {
        logger.info('S3 reference updated for file', { fileId, s3Key, s3Bucket });
        return this.validate(result);
      }

      logger.warn('File not found for updating S3 reference', { fileId });
      return null;
    } catch (error) {
      logger.error('Error updating S3 reference for file', { fileId, s3Key, s3Bucket, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

// Export singleton instance
export const filesRepository = new FilesRepository();
