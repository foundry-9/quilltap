/**
 * MongoDB Migrations Repository
 *
 * Stores migration state (completed migrations, timestamps) in MongoDB.
 * This allows migration tracking to work consistently with MongoDB backend.
 */

import { Collection, Document } from 'mongodb';
import { z } from 'zod';
import { getMongoDatabase } from '../client';
import { logger } from '@/lib/logger';

/**
 * Schema for a migration record
 */
const MigrationRecordSchema = z.object({
  id: z.string(),
  completedAt: z.string(),
  quilltapVersion: z.string(),
  itemsAffected: z.number(),
  message: z.string(),
});

/**
 * Schema for migration state document
 */
const MigrationStateSchema = z.object({
  _id: z.literal('migration_state').optional(),
  completedMigrations: z.array(MigrationRecordSchema),
  lastChecked: z.string(),
  quilltapVersion: z.string(),
});

export type MigrationRecord = z.infer<typeof MigrationRecordSchema>;
export type MigrationState = z.infer<typeof MigrationStateSchema>;

/**
 * Document interface for the migration state collection
 * Uses a string _id instead of ObjectId for singleton document pattern
 */
interface MigrationStateDocument extends Document {
  _id: string;
  completedMigrations: MigrationRecord[];
  lastChecked: string;
  quilltapVersion: string;
}

/**
 * MongoDB repository for migration state
 */
export class MongoMigrationsRepository {
  private readonly collectionName = 'migrations_state';
  private readonly documentId = 'migration_state';

  /**
   * Get the MongoDB collection
   */
  private async getCollection(): Promise<Collection<MigrationStateDocument>> {
    const db = await getMongoDatabase();
    logger.debug('Retrieved MongoDB migrations_state collection', {
      context: 'MongoMigrationsRepository',
    });
    return db.collection<MigrationStateDocument>(this.collectionName);
  }

  /**
   * Load the current migration state
   */
  async loadState(): Promise<MigrationState> {
    try {
      logger.debug('Loading migration state from MongoDB', {
        context: 'MongoMigrationsRepository.loadState',
      });

      const collection = await this.getCollection();
      const doc = await collection.findOne({ _id: this.documentId });

      if (!doc) {
        logger.debug('No migration state found in MongoDB, returning empty state', {
          context: 'MongoMigrationsRepository.loadState',
        });
        // Return empty state - will be populated when first migration runs
        const packageJson = await import('@/package.json');
        return {
          completedMigrations: [],
          lastChecked: new Date().toISOString(),
          quilltapVersion: packageJson.version,
        };
      }

      // Validate and return (strip _id for the return value)
      const { _id, ...state } = doc;
      const validated = MigrationStateSchema.omit({ _id: true }).parse(state);

      logger.debug('Migration state loaded from MongoDB', {
        context: 'MongoMigrationsRepository.loadState',
        completedCount: validated.completedMigrations.length,
      });

      return validated;
    } catch (error) {
      logger.error('Error loading migration state from MongoDB', {
        context: 'MongoMigrationsRepository.loadState',
        error: error instanceof Error ? error.message : String(error),
      });
      // Return empty state on error
      const packageJson = await import('@/package.json');
      return {
        completedMigrations: [],
        lastChecked: new Date().toISOString(),
        quilltapVersion: packageJson.version,
      };
    }
  }

  /**
   * Save migration state to MongoDB
   */
  async saveState(state: MigrationState): Promise<void> {
    try {
      logger.debug('Saving migration state to MongoDB', {
        context: 'MongoMigrationsRepository.saveState',
        completedCount: state.completedMigrations.length,
      });

      const collection = await this.getCollection();

      await collection.updateOne(
        { _id: this.documentId },
        {
          $set: {
            completedMigrations: state.completedMigrations,
            lastChecked: state.lastChecked,
            quilltapVersion: state.quilltapVersion,
          },
        },
        { upsert: true }
      );

      logger.debug('Migration state saved to MongoDB', {
        context: 'MongoMigrationsRepository.saveState',
      });
    } catch (error) {
      logger.error('Error saving migration state to MongoDB', {
        context: 'MongoMigrationsRepository.saveState',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if a migration has been completed
   */
  async isMigrationCompleted(migrationId: string): Promise<boolean> {
    const state = await this.loadState();
    return state.completedMigrations.some(m => m.id === migrationId);
  }

  /**
   * Record a completed migration
   */
  async recordCompletedMigration(record: MigrationRecord): Promise<MigrationState> {
    const state = await this.loadState();

    // Don't add duplicate
    if (state.completedMigrations.some(m => m.id === record.id)) {
      logger.warn('Migration already recorded, skipping', {
        context: 'MongoMigrationsRepository.recordCompletedMigration',
        migrationId: record.id,
      });
      return state;
    }

    const packageJson = await import('@/package.json');
    const updatedState: MigrationState = {
      ...state,
      completedMigrations: [...state.completedMigrations, record],
      lastChecked: new Date().toISOString(),
      quilltapVersion: packageJson.version,
    };

    await this.saveState(updatedState);
    return updatedState;
  }

  /**
   * Get list of completed migration IDs
   */
  async getCompletedMigrationIds(): Promise<string[]> {
    const state = await this.loadState();
    return state.completedMigrations.map(m => m.id);
  }
}

// Singleton instance
let instance: MongoMigrationsRepository | null = null;

export function getMongoMigrationsRepository(): MongoMigrationsRepository {
  if (!instance) {
    instance = new MongoMigrationsRepository();
  }
  return instance;
}
