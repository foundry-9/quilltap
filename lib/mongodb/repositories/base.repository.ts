/**
 * MongoDB Base Repository
 *
 * Abstract base class for all MongoDB-backed repositories.
 * Provides common patterns for CRUD operations on MongoDB collections.
 */

import { Collection } from 'mongodb';
import { z } from 'zod';
import { getMongoDatabase } from '../client';
import { logger } from '@/lib/logger';

/**
 * Base repository with common methods for MongoDB
 */
export abstract class MongoBaseRepository<T> {
  protected collectionName: string;
  protected schema: z.ZodSchema;

  constructor(collectionName: string, schema: z.ZodSchema) {
    this.collectionName = collectionName;
    this.schema = schema;
  }

  /**
   * Get MongoDB collection instance
   */
  protected async getCollection(): Promise<Collection> {
    try {
      const db = await getMongoDatabase();
      logger.debug('Retrieved MongoDB collection', { collection: this.collectionName });
      return db.collection(this.collectionName);
    } catch (error) {
      logger.error('Failed to get MongoDB collection', {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Validate data against schema
   */
  protected validate(data: unknown): T {
    try {
      const validated = this.schema.parse(data) as T;
      logger.debug('Data validation successful', { collection: this.collectionName });
      return validated;
    } catch (error) {
      logger.error('Data validation failed', {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Safely validate without throwing
   */
  protected validateSafe(data: unknown): { success: boolean; data?: T; error?: string } {
    try {
      const validated = this.validate(data);
      return { success: true, data: validated };
    } catch (error: any) {
      logger.warn('Safe validation failed', {
        collection: this.collectionName,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate UUID v4
   */
  protected generateId(): string {
    logger.debug('Generating UUID v4', { collection: this.collectionName });
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Get current ISO-8601 timestamp
   */
  protected getCurrentTimestamp(): string {
    const timestamp = new Date().toISOString();
    logger.debug('Generated timestamp', { collection: this.collectionName, timestamp });
    return timestamp;
  }

  /**
   * Abstract methods that subclasses must implement
   */
  abstract findById(id: string): Promise<T | null>;
  abstract findAll(): Promise<T[]>;
  abstract create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T>;
  abstract update(id: string, data: Partial<T>): Promise<T | null>;
  abstract delete(id: string): Promise<boolean>;
}
