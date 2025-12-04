import { Db } from 'mongodb';
import { logger } from '@/lib/logger';

/**
 * Index definition interface for MongoDB indexes
 */
export interface IndexDefinition {
  key: Record<string, 1 | -1 | 'text'>;
  options?: {
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number;
    name?: string;
  };
}

/**
 * MongoDB index definitions for all collections
 * Based on the migration plan for v2.0
 */
export const INDEX_DEFINITIONS: Record<string, IndexDefinition[]> = {
  // Users collection indexes
  users: [
    {
      key: { email: 1 },
      options: { unique: true },
    },
    {
      key: { createdAt: 1 },
    },
  ],

  // NextAuth accounts collection indexes
  accounts: [
    {
      key: { provider: 1, providerAccountId: 1 },
      options: { unique: true },
    },
    {
      key: { userId: 1 },
    },
  ],

  // NextAuth sessions collection indexes
  sessions: [
    {
      key: { sessionToken: 1 },
      options: { unique: true },
    },
    {
      key: { userId: 1 },
    },
    {
      key: { expires: 1 },
      options: { expireAfterSeconds: 0 },
    },
  ],

  // NextAuth verification tokens collection indexes
  verification_tokens: [
    {
      key: { identifier: 1, token: 1 },
      options: { unique: true },
    },
    {
      key: { expires: 1 },
      options: { expireAfterSeconds: 0 },
    },
  ],

  // Characters collection indexes
  characters: [
    {
      key: { userId: 1 },
    },
    {
      key: { createdAt: 1 },
    },
    {
      key: { name: 'text' },
    },
  ],

  // Personas collection indexes
  personas: [
    {
      key: { userId: 1 },
    },
    {
      key: { createdAt: 1 },
    },
  ],

  // Chats collection indexes
  chats: [
    {
      key: { userId: 1 },
    },
    {
      key: { characterId: 1 },
    },
    {
      key: { updatedAt: 1 },
    },
  ],

  // Memories collection indexes
  memories: [
    {
      key: { characterId: 1 },
    },
    {
      key: { userId: 1 },
    },
  ],

  // Tags collection indexes
  tags: [
    {
      key: { userId: 1 },
    },
    {
      key: { userId: 1, name: 1 },
      options: { unique: true },
    },
  ],

  // Connection profiles collection indexes
  connection_profiles: [
    {
      key: { userId: 1 },
    },
  ],

  // Files collection indexes
  files: [
    {
      key: { userId: 1 },
    },
    {
      key: { s3Key: 1 },
    },
    {
      key: { sha256: 1 },
    },
  ],
};

/**
 * Creates indexes for a single collection
 * @internal
 */
async function createCollectionIndexes(
  collectionName: string,
  db: Db
): Promise<{ indexCount: number; errors: string[] }> {
  const indexes = INDEX_DEFINITIONS[collectionName];
  const collection = db.collection(collectionName);
  const errors: string[] = [];
  let indexCount = 0;

  logger.debug(`[MongoDB] Creating indexes for collection: ${collectionName}`);

  for (const indexDef of indexes) {
    try {
      const indexName = await collection.createIndex(indexDef.key, indexDef.options);
      logger.debug(
        `[MongoDB] Index created for ${collectionName}: ${indexName}`,
        { key: indexDef.key, options: indexDef.options }
      );
      indexCount++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        `[MongoDB] Failed to create index for ${collectionName}`,
        { key: indexDef.key, error: errorMessage }
      );
      errors.push(errorMessage);
    }
  }

  return { indexCount, errors };
}

/**
 * Creates all MongoDB indexes defined in INDEX_DEFINITIONS
 *
 * @param db MongoDB database instance
 * @throws Logs errors but continues with other indexes
 */
export async function ensureIndexes(db: Db): Promise<void> {
  logger.debug('[MongoDB] Starting index creation');

  const collections = Object.keys(INDEX_DEFINITIONS);
  const results: { collection: string; indexCount: number; errors: string[] }[] = [];

  for (const collectionName of collections) {
    const { indexCount, errors } = await createCollectionIndexes(collectionName, db);
    results.push({
      collection: collectionName,
      indexCount,
      errors,
    });
  }

  // Log summary
  const totalIndexes = results.reduce((sum, r) => sum + r.indexCount, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  logger.info(`[MongoDB] Index creation completed`, {
    totalCollections: collections.length,
    totalIndexes,
    totalErrors,
  });

  if (totalErrors > 0) {
    logger.warn(`[MongoDB] Index creation completed with ${totalErrors} error(s)`, {
      results: results.filter((r) => r.errors.length > 0),
    });
  }
}

/**
 * Drops indexes for a single collection (excluding _id index)
 * @internal
 */
async function dropCollectionIndexes(
  collectionName: string,
  db: Db
): Promise<{ indexCount: number; errors: string[] }> {
  const collection = db.collection(collectionName);
  const errors: string[] = [];
  let indexCount = 0;

  logger.debug(`[MongoDB] Dropping indexes for collection: ${collectionName}`);

  try {
    // Get existing indexes
    const indexes = await collection.indexes();

    // Drop all indexes except the default _id index
    for (const index of indexes) {
      if (index.name && index.name !== '_id_') {
        try {
          await collection.dropIndex(index.name);
          logger.debug(
            `[MongoDB] Index dropped for ${collectionName}: ${index.name}`,
            { indexSpec: index.key }
          );
          indexCount++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(
            `[MongoDB] Failed to drop index for ${collectionName}`,
            { indexName: index.name, error: errorMessage }
          );
          errors.push(errorMessage);
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(
      `[MongoDB] Failed to get indexes for ${collectionName}`,
      { error: errorMessage }
    );
    errors.push(errorMessage);
  }

  return { indexCount, errors };
}

/**
 * Drops all MongoDB indexes defined in INDEX_DEFINITIONS
 * Useful for testing and resetting the database state
 *
 * @param db MongoDB database instance
 * @throws Logs errors but continues with other indexes
 */
export async function dropIndexes(db: Db): Promise<void> {
  logger.debug('[MongoDB] Starting index deletion');

  const collections = Object.keys(INDEX_DEFINITIONS);
  const results: { collection: string; indexCount: number; errors: string[] }[] = [];

  for (const collectionName of collections) {
    const { indexCount, errors } = await dropCollectionIndexes(collectionName, db);
    results.push({
      collection: collectionName,
      indexCount,
      errors,
    });
  }

  // Log summary
  const totalIndexes = results.reduce((sum, r) => sum + r.indexCount, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  logger.info(`[MongoDB] Index deletion completed`, {
    totalCollections: collections.length,
    totalIndexesDropped: totalIndexes,
    totalErrors,
  });

  if (totalErrors > 0) {
    logger.warn(`[MongoDB] Index deletion completed with ${totalErrors} error(s)`, {
      results: results.filter((r) => r.errors.length > 0),
    });
  }
}
