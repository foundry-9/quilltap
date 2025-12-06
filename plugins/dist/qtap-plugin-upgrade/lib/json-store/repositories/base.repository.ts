/**
 * Base Repository
 *
 * Abstract base class for all JSON-backed repositories.
 * Provides common patterns for CRUD operations on JSON files.
 */

import { JsonStore } from '../core/json-store';
import { z } from 'zod';

/**
 * Base repository with common methods
 */
export abstract class BaseRepository<T> {
  protected jsonStore: JsonStore;
  protected schema: z.ZodSchema;

  constructor(jsonStore: JsonStore, schema: z.ZodSchema) {
    this.jsonStore = jsonStore;
    this.schema = schema;
  }

  /**
   * Validate data against schema
   */
  protected validate(data: unknown): T {
    return this.schema.parse(data) as T;
  }

  /**
   * Safely validate without throwing
   */
  protected validateSafe(data: unknown): { success: boolean; data?: T; error?: string } {
    try {
      const validated = this.validate(data);
      return { success: true, data: validated };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate UUID v4
   */
  protected generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Get current ISO timestamp
   */
  protected getCurrentTimestamp(): string {
    return new Date().toISOString();
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
