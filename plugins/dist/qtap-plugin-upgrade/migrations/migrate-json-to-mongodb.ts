/**
 * Migration: Migrate JSON to MongoDB
 *
 * Migrates all structured data from JSON file storage to MongoDB.
 * This is a comprehensive migration that handles:
 * - Tags
 * - Users
 * - Connection profiles
 * - Image profiles
 * - Embedding profiles
 * - Personas
 * - Characters
 * - Memories
 * - Chats (with messages)
 * - Images (metadata from ImagesRepository)
 *
 * Note: Binary file storage and file metadata from the file-manager module
 * are handled separately by the migrate-files-to-s3-v1 migration.
 *
 * The migration runs only when:
 * - DATA_BACKEND environment is set to 'mongodb' or 'dual'
 * - MongoDB is configured and accessible
 * - There is data in JSON store
 * - MongoDB collections are empty or smaller than their JSON counterparts
 */

import { logger } from '@/lib/logger';
import type { Migration, MigrationResult } from '../migration-types';

/**
 * Check if MongoDB backend is enabled
 */
function isMongoDBBackendEnabled(): boolean {
  const backend = process.env.DATA_BACKEND || '';
  return backend === 'mongodb' || backend === 'dual';
}

/**
 * Get JSON repositories
 */
async function getJsonRepos() {
  try {
    // Import JSON repositories
    const { getRepositories: getJsonRepos } = await import('@/lib/json-store/repositories');
    return getJsonRepos();
  } catch (error) {
    logger.error('Failed to import JSON repositories', {
      context: 'migration.migrate-json-to-mongodb',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get MongoDB repositories
 */
async function getMongoRepos() {
  try {
    // Import MongoDB repositories
    const { getRepositories: getMongoRepos } = await import('@/lib/mongodb/repositories');
    return getMongoRepos();
  } catch (error) {
    logger.error('Failed to import MongoDB repositories', {
      context: 'migration.migrate-json-to-mongodb',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Check if MongoDB is accessible
 */
async function isMongoDBAccessible(): Promise<boolean> {
  try {
    const { getMongoDatabase } = await import('@/lib/mongodb/client');
    const db = await getMongoDatabase();
    await db.admin().ping();
    return true;
  } catch (error) {
    logger.warn('MongoDB is not accessible', {
      context: 'migration.migrate-json-to-mongodb',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if there is data to migrate
 */
async function hasDataToMigrate(): Promise<boolean> {
  try {
    const jsonRepos = await getJsonRepos();
    const mongoRepos = await getMongoRepos();

    // Check if any JSON entities exist
    const hasJsonData =
      (await jsonRepos.tags.findAll()).length > 0 ||
      (await jsonRepos.users.findAll()).length > 0 ||
      (await jsonRepos.connections.findAll()).length > 0 ||
      (await jsonRepos.imageProfiles.findAll()).length > 0 ||
      (await jsonRepos.embeddingProfiles.findAll()).length > 0 ||
      (await jsonRepos.personas.findAll()).length > 0 ||
      (await jsonRepos.characters.findAll()).length > 0 ||
      (await jsonRepos.memories.findAll()).length > 0 ||
      (await jsonRepos.chats.findAll()).length > 0;

    if (!hasJsonData) {
      logger.debug('No data found in JSON store to migrate', {
        context: 'migration.migrate-json-to-mongodb',
      });
      return false;
    }

    // Check if MongoDB collections are empty or smaller than JSON
    const mongoTags = (await mongoRepos.tags.findAll()).length;
    const mongoUsers = (await mongoRepos.users.findAll()).length;
    const mongoConnections = (await mongoRepos.connections.findAll()).length;
    const mongoImageProfiles = (await mongoRepos.imageProfiles.findAll()).length;
    const mongoEmbeddingProfiles = (await mongoRepos.embeddingProfiles.findAll()).length;
    const mongoPersonas = (await mongoRepos.personas.findAll()).length;
    const mongoCharacters = (await mongoRepos.characters.findAll()).length;
    const mongoMemories = (await mongoRepos.memories.findAll()).length;
    const mongoChats = (await mongoRepos.chats.findAll()).length;

    const mongoHasData =
      mongoTags > 0 ||
      mongoUsers > 0 ||
      mongoConnections > 0 ||
      mongoImageProfiles > 0 ||
      mongoEmbeddingProfiles > 0 ||
      mongoPersonas > 0 ||
      mongoCharacters > 0 ||
      mongoMemories > 0 ||
      mongoChats > 0;

    if (mongoHasData) {
      logger.warn('MongoDB already contains data, skipping migration', {
        context: 'migration.migrate-json-to-mongodb',
        mongoTags,
        mongoUsers,
        mongoConnections,
        mongoImageProfiles,
        mongoEmbeddingProfiles,
        mongoPersonas,
        mongoCharacters,
        mongoMemories,
        mongoChats,
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error checking for data to migrate', {
      context: 'migration.migrate-json-to-mongodb',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Migrate entities from JSON to MongoDB
 */
async function migrateEntities(
  entityType: string,
  jsonRepo: any,
  mongoRepo: any,
): Promise<{ itemsMigrated: number; errors: Array<{ id: string; error: string }> }> {
  const itemsMigrated: number[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  try {
    const entities = await jsonRepo.findAll();

    logger.debug(`Migrating ${entityType} entities`, {
      context: 'migration.migrate-json-to-mongodb',
      entityType,
      count: entities.length,
    });

    for (const entity of entities) {
      try {
        // Extract the fields needed for creation (exclude id, createdAt, updatedAt for create method)
        const { id, createdAt, updatedAt, ...createData } = entity;

        // Try to create the entity
        try {
          // Add id, createdAt, updatedAt back for upsert-like behavior
          const entityWithMetadata = {
            ...createData,
            id,
            createdAt: createdAt || new Date().toISOString(),
            updatedAt: updatedAt || new Date().toISOString(),
          };

          // Attempt to create - some repos may handle this differently
          if (mongoRepo.create) {
            // For repos with create method
            const created = await mongoRepo.create(createData);
            itemsMigrated.push(1);
          } else if (mongoRepo.upsert) {
            // For repos with upsert method
            await mongoRepo.upsert(entity);
            itemsMigrated.push(1);
          } else if (mongoRepo.update) {
            // For repos with update method, first check if exists
            const existing = await mongoRepo.findById(id);
            if (existing) {
              // Skip if already exists
              logger.debug(`${entityType} entity already exists in MongoDB, skipping`, {
                context: 'migration.migrate-json-to-mongodb',
                entityType,
                entityId: id,
              });
            } else {
              await mongoRepo.update(id, entityWithMetadata);
              itemsMigrated.push(1);
            }
          }
        } catch (createError: any) {
          // Check if error is due to duplicate key
          if (
            createError.code === 11000 ||
            createError.message?.includes('duplicate')
          ) {
            logger.debug(`${entityType} entity already exists in MongoDB, skipping`, {
              context: 'migration.migrate-json-to-mongodb',
              entityType,
              entityId: entity.id,
            });
            itemsMigrated.push(1);
          } else {
            throw createError;
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          id: entity.id,
          error: errorMessage,
        });
        logger.error(`Failed to migrate ${entityType} entity`, {
          context: 'migration.migrate-json-to-mongodb',
          entityType,
          entityId: entity.id,
          error: errorMessage,
        });
      }
    }

    logger.info(`Completed ${entityType} migration`, {
      context: 'migration.migrate-json-to-mongodb',
      entityType,
      itemsMigrated: itemsMigrated.length,
      errors: errors.length,
    });
  } catch (error) {
    logger.error(`Error during ${entityType} migration`, {
      context: 'migration.migrate-json-to-mongodb',
      entityType,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    itemsMigrated: itemsMigrated.length,
    errors,
  };
}

/**
 * Migrate JSON to MongoDB
 */
export const migrateJsonToMongoDBMigration: Migration = {
  id: 'migrate-json-to-mongodb-v1',
  description: 'Migrate all structured data from JSON file storage to MongoDB',
  introducedInVersion: '2.0.0',
  dependsOn: ['validate-mongodb-config-v1'],

  async shouldRun(): Promise<boolean> {
    logger.debug('Checking if JSON to MongoDB migration should run', {
      context: 'migration.migrate-json-to-mongodb',
    });

    // Check if MongoDB backend is enabled
    if (!isMongoDBBackendEnabled()) {
      logger.debug('MongoDB backend not enabled, skipping migration', {
        context: 'migration.migrate-json-to-mongodb',
        dataBackend: process.env.DATA_BACKEND,
      });
      return false;
    }

    // Check if MongoDB is accessible
    const mongoAccessible = await isMongoDBAccessible();
    if (!mongoAccessible) {
      logger.warn('MongoDB is not accessible, deferring migration', {
        context: 'migration.migrate-json-to-mongodb',
      });
      return false;
    }

    // Check if there is data to migrate
    return await hasDataToMigrate();
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let totalItemsMigrated = 0;
    const allErrors: Array<{ entity: string; id: string; error: string }> = [];

    logger.info('Starting JSON to MongoDB migration', {
      context: 'migration.migrate-json-to-mongodb',
    });

    try {
      const jsonRepos = await getJsonRepos();
      const mongoRepos = await getMongoRepos();

      // Migration order as specified
      const entities = [
        { name: 'tags', jsonRepo: jsonRepos.tags, mongoRepo: mongoRepos.tags },
        { name: 'users', jsonRepo: jsonRepos.users, mongoRepo: mongoRepos.users },
        {
          name: 'connections',
          jsonRepo: jsonRepos.connections,
          mongoRepo: mongoRepos.connections,
        },
        {
          name: 'imageProfiles',
          jsonRepo: jsonRepos.imageProfiles,
          mongoRepo: mongoRepos.imageProfiles,
        },
        {
          name: 'embeddingProfiles',
          jsonRepo: jsonRepos.embeddingProfiles,
          mongoRepo: mongoRepos.embeddingProfiles,
        },
        { name: 'personas', jsonRepo: jsonRepos.personas, mongoRepo: mongoRepos.personas },
        {
          name: 'characters',
          jsonRepo: jsonRepos.characters,
          mongoRepo: mongoRepos.characters,
        },
        { name: 'memories', jsonRepo: jsonRepos.memories, mongoRepo: mongoRepos.memories },
        { name: 'chats', jsonRepo: jsonRepos.chats, mongoRepo: mongoRepos.chats },
        // Note: Files/images use the file-manager module, not JSON repositories
        // File metadata migration is handled by the migrate-files-to-s3-v1 migration
        { name: 'images', jsonRepo: jsonRepos.images, mongoRepo: mongoRepos.images },
      ];

      for (const entity of entities) {
        logger.debug(`Starting migration of ${entity.name}`, {
          context: 'migration.migrate-json-to-mongodb',
          entityName: entity.name,
        });

        const result = await migrateEntities(entity.name, entity.jsonRepo, entity.mongoRepo);

        totalItemsMigrated += result.itemsMigrated;
        for (const error of result.errors) {
          allErrors.push({
            entity: entity.name,
            id: error.id,
            error: error.error,
          });
        }

        logger.info(`Completed ${entity.name} migration`, {
          context: 'migration.migrate-json-to-mongodb',
          entityName: entity.name,
          itemsMigrated: result.itemsMigrated,
          errorsCount: result.errors.length,
        });
      }
    } catch (error) {
      logger.error('Fatal error during migration', {
        context: 'migration.migrate-json-to-mongodb',
        error: error instanceof Error ? error.message : String(error),
      });

      const durationMs = Date.now() - startTime;
      return {
        id: 'migrate-json-to-mongodb-v1',
        success: false,
        itemsAffected: totalItemsMigrated,
        message: 'Migration failed with fatal error',
        error: error instanceof Error ? error.message : String(error),
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }

    const durationMs = Date.now() - startTime;
    const success = allErrors.length === 0;

    // Format error summary (first 5 errors)
    const errorSummary =
      allErrors.length > 0
        ? allErrors
            .slice(0, 5)
            .map(
              (e) =>
                `${e.entity}/${e.id}: ${e.error}`,
            )
            .join('; ')
        : undefined;

    logger.info('Completed JSON to MongoDB migration', {
      context: 'migration.migrate-json-to-mongodb',
      success,
      itemsMigrated: totalItemsMigrated,
      errorsCount: allErrors.length,
      durationMs,
    });

    return {
      id: 'migrate-json-to-mongodb-v1',
      success,
      itemsAffected: totalItemsMigrated,
      message: success
        ? `Successfully migrated ${totalItemsMigrated} items from JSON to MongoDB`
        : `Migrated ${totalItemsMigrated} items with ${allErrors.length} errors`,
      error: errorSummary,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
