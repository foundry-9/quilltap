/**
 * UUID Remapper Utility
 *
 * Used during restore operations when importing data to a different account (new-account mode).
 * Generates new UUIDs for all entities while maintaining a consistent mapping and updates
 * all foreign key references across entities.
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';

/**
 * UuidRemapper class for managing UUID transformations during backup restore operations
 */
export class UuidRemapper {
  /**
   * Internal mapping store for old UUID -> new UUID
   */
  private mapping: Map<string, string> = new Map();

  /**
   * Module-specific logger instance
   */
  private moduleLogger = logger.child({ module: 'backup:uuid-remapper' });

  /**
   * Get or create a new UUID for an old one.
   * If the oldUuid has been seen before, return the same new UUID.
   * This ensures consistent mapping throughout the restore operation.
   *
   * @param oldUuid The original UUID from the backup
   * @returns A new UUID (consistent for the same input)
   */
  remap(oldUuid: string): string {
    // Check if we already have a mapping for this UUID
    if (this.mapping.has(oldUuid)) {
      return this.mapping.get(oldUuid)!;
    }

    // Generate a new UUID for this old UUID
    const newUuid = randomUUID();
    this.mapping.set(oldUuid, newUuid);

    return newUuid;
  }

  /**
   * Remap an array of UUIDs.
   * Maps each UUID in the array using the remap() method.
   *
   * @param uuids Array of UUIDs to remap
   * @returns Array of remapped UUIDs in the same order
   */
  remapArray(uuids: string[]): string[] {
    if (!Array.isArray(uuids)) {
      this.moduleLogger.warn('Attempted to remap non-array value as array', {
        type: typeof uuids,
        value: uuids,
      });
      return [];
    }

    return uuids.map((uuid) => this.remap(uuid));
  }

  /**
   * Remap specific fields in an object that contain UUIDs.
   * Creates a shallow copy of the object with specified UUID fields remapped.
   *
   * @param obj The object to process
   * @param fields Array of field names that contain UUIDs
   * @returns A new object with remapped UUIDs (shallow copy)
   */
  remapFields<T extends Record<string, any>>(obj: T, fields: string[]): T {
    if (!obj || typeof obj !== 'object') {
      this.moduleLogger.warn('Attempted to remap non-object value', {
        type: typeof obj,
        value: obj,
      });
      return obj;
    }

    if (!Array.isArray(fields)) {
      this.moduleLogger.warn('Fields parameter is not an array', {
        type: typeof fields,
        value: fields,
      });
      return obj;
    }

    const remappedObject: Record<string, any> = { ...obj };

    for (const field of fields) {
      if (field in remappedObject && typeof remappedObject[field] === 'string') {
        remappedObject[field] = this.remap(remappedObject[field]);
      }
    }

    return remappedObject as T;
  }

  /**
   * Remap array fields in an object (fields that contain arrays of UUIDs).
   * Creates a shallow copy of the object with specified UUID array fields remapped.
   *
   * @param obj The object to process
   * @param fields Array of field names that contain UUID arrays
   * @returns A new object with remapped UUID arrays (shallow copy)
   */
  remapArrayFields<T extends Record<string, any>>(obj: T, fields: string[]): T {
    if (!obj || typeof obj !== 'object') {
      this.moduleLogger.warn('Attempted to remap non-object value', {
        type: typeof obj,
        value: obj,
      });
      return obj;
    }

    if (!Array.isArray(fields)) {
      this.moduleLogger.warn('Fields parameter is not an array', {
        type: typeof fields,
        value: fields,
      });
      return obj;
    }

    const remappedObject: Record<string, any> = { ...obj };

    for (const field of fields) {
      if (field in remappedObject && Array.isArray(remappedObject[field])) {
        remappedObject[field] = this.remapArray(remappedObject[field]);
      }
    }

    return remappedObject as T;
  }

  /**
   * Get the full UUID mapping for debugging and inspection.
   * Returns a plain object representation of the internal mapping.
   *
   * @returns Record of old UUID -> new UUID
   */
  getMapping(): Record<string, string> {
    const mappingObject: Record<string, string> = {};

    for (const [oldUuid, newUuid] of this.mapping.entries()) {
      mappingObject[oldUuid] = newUuid;
    }

    return mappingObject;
  }

  /**
   * Clear the mapping to reset for a new operation.
   * This should be called before starting a new restore operation if the same instance is reused.
   */
  clear(): void {
    this.moduleLogger.info('Clearing UUID mapping', {
      size: this.mapping.size,
    });
    this.mapping.clear();
  }

  /**
   * Get the current size of the mapping (number of remapped UUIDs).
   * Useful for monitoring and debugging.
   *
   * @returns Number of UUIDs currently in the mapping
   */
  getSize(): number {
    return this.mapping.size;
  }
}
