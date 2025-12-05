/**
 * Migration: Migrate JSON to MongoDB
 *
 * Migrates all structured data from JSON file storage to MongoDB.
 * This is a comprehensive migration that handles:
 * - Tags
 * - Users (with NextAuth ID mapping)
 * - Chat settings
 * - API keys (with userId added)
 * - Connection profiles
 * - Image profiles
 * - Embedding profiles
 * - Personas
 * - Characters (with all embedded data preserved)
 * - Memories
 * - Chats (with messages and participants)
 * - Files/Images
 * - Vector Indices (embedding cache for semantic search)
 *
 * IMPORTANT: This migration uses direct MongoDB inserts to preserve original IDs
 * and maintain all relationships between entities.
 *
 * It also maps the JSON userId to the NextAuth userId from accounts.json to
 * ensure data is accessible after OAuth login.
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
 * Get MongoDB database instance for direct inserts
 */
async function getMongoDatabase() {
  const { getMongoDatabase: getDb } = await import('@/lib/mongodb/client');
  return getDb();
}

/**
 * Check if MongoDB is accessible
 */
async function isMongoDBAccessible(): Promise<boolean> {
  try {
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
 * Get the NextAuth userId from the accounts.json file
 */
async function getNextAuthUserId(): Promise<string | null> {
  try {
    const { getJsonStore } = await import('@/lib/json-store/core/json-store');
    const jsonStore = getJsonStore();
    const accounts = await jsonStore.readJson<any[]>('auth/accounts.json');

    if (accounts && accounts.length > 0) {
      // Return the userId from the first account (typically the primary OAuth account)
      return accounts[0].userId || null;
    }
    return null;
  } catch (error) {
    logger.warn('Could not read NextAuth accounts', {
      context: 'migration.migrate-json-to-mongodb',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Check if there is data to migrate
 */
async function hasDataToMigrate(): Promise<boolean> {
  try {
    const jsonRepos = await getJsonRepos();
    const db = await getMongoDatabase();

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

    // Check if MongoDB collections are empty
    const mongoTags = await db.collection('tags').countDocuments();
    const mongoUsers = await db.collection('users').countDocuments();
    const mongoConnections = await db.collection('connection_profiles').countDocuments();
    const mongoChats = await db.collection('chats').countDocuments();

    const mongoHasData = mongoTags > 0 || mongoUsers > 0 || mongoConnections > 0 || mongoChats > 0;

    if (mongoHasData) {
      logger.warn('MongoDB already contains data, skipping migration', {
        context: 'migration.migrate-json-to-mongodb',
        mongoTags,
        mongoUsers,
        mongoConnections,
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
 * Map userId from JSON to NextAuth userId in an entity
 */
function mapUserId(entity: any, jsonUserId: string, nextAuthUserId: string): any {
  if (!entity || !jsonUserId || !nextAuthUserId) return entity;

  const mapped = { ...entity };

  if (mapped.userId === jsonUserId) {
    mapped.userId = nextAuthUserId;
  }

  return mapped;
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

    if (!isMongoDBBackendEnabled()) {
      logger.debug('MongoDB backend not enabled, skipping migration', {
        context: 'migration.migrate-json-to-mongodb',
        dataBackend: process.env.DATA_BACKEND,
      });
      return false;
    }

    const mongoAccessible = await isMongoDBAccessible();
    if (!mongoAccessible) {
      logger.warn('MongoDB is not accessible, deferring migration', {
        context: 'migration.migrate-json-to-mongodb',
      });
      return false;
    }

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
      const db = await getMongoDatabase();

      // Get the NextAuth userId for mapping
      const nextAuthUserId = await getNextAuthUserId();

      // Get the JSON userId from the first user
      const jsonUsers = await jsonRepos.users.findAll();
      const jsonUserId = jsonUsers.length > 0 ? jsonUsers[0].id : null;

      logger.info('User ID mapping', {
        context: 'migration.migrate-json-to-mongodb',
        jsonUserId,
        nextAuthUserId,
        willMap: !!(jsonUserId && nextAuthUserId && jsonUserId !== nextAuthUserId),
      });

      const shouldMapUserId = jsonUserId && nextAuthUserId && jsonUserId !== nextAuthUserId;

      // ========================================================================
      // 1. Migrate Tags (preserve IDs, map userId)
      // ========================================================================
      logger.info('Migrating tags...', { context: 'migration.migrate-json-to-mongodb' });
      const tags = await jsonRepos.tags.findAll();
      if (tags.length > 0) {
        const tagsToInsert = tags.map(tag => {
          const mapped = shouldMapUserId ? mapUserId(tag, jsonUserId!, nextAuthUserId!) : tag;
          return { ...mapped };
        });
        await db.collection('tags').insertMany(tagsToInsert);
        totalItemsMigrated += tags.length;
        logger.info(`Migrated ${tags.length} tags`, { context: 'migration.migrate-json-to-mongodb' });
      }

      // ========================================================================
      // 2. Migrate User (map ID to NextAuth ID)
      // ========================================================================
      logger.info('Migrating users...', { context: 'migration.migrate-json-to-mongodb' });
      if (jsonUsers.length > 0) {
        for (const user of jsonUsers) {
          const mappedUser = {
            ...user,
            // Map the user ID to match NextAuth
            id: shouldMapUserId ? nextAuthUserId : user.id,
          };
          await db.collection('users').insertOne(mappedUser);
          totalItemsMigrated++;
        }
        logger.info(`Migrated ${jsonUsers.length} users`, { context: 'migration.migrate-json-to-mongodb' });
      }

      // ========================================================================
      // 3. Migrate Chat Settings
      // ========================================================================
      logger.info('Migrating chat settings...', { context: 'migration.migrate-json-to-mongodb' });
      try {
        if (jsonUsers.length > 0) {
          const chatSettings = await jsonRepos.users.getChatSettings(jsonUsers[0].id);
          if (chatSettings) {
            const mappedSettings = shouldMapUserId
              ? mapUserId(chatSettings, jsonUserId!, nextAuthUserId!)
              : chatSettings;
            await db.collection('chat_settings').insertOne(mappedSettings);
            totalItemsMigrated++;
            logger.info('Migrated chat settings', { context: 'migration.migrate-json-to-mongodb' });
          }
        }
      } catch (error) {
        logger.warn('Could not migrate chat settings', {
          context: 'migration.migrate-json-to-mongodb',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // ========================================================================
      // 4. Migrate API Keys (preserve IDs, add userId)
      // ========================================================================
      logger.info('Migrating API keys...', { context: 'migration.migrate-json-to-mongodb' });
      const apiKeys = await jsonRepos.connections.getAllApiKeys();
      if (apiKeys.length > 0) {
        const apiKeysToInsert = apiKeys.map(apiKey => ({
          ...apiKey,
          // API keys in JSON don't have userId, add it
          userId: shouldMapUserId ? nextAuthUserId : jsonUserId,
        }));
        await db.collection('api_keys').insertMany(apiKeysToInsert);
        totalItemsMigrated += apiKeys.length;
        logger.info(`Migrated ${apiKeys.length} API keys`, { context: 'migration.migrate-json-to-mongodb' });
      }

      // ========================================================================
      // 5. Migrate Connection Profiles (preserve IDs)
      // ========================================================================
      logger.info('Migrating connection profiles...', { context: 'migration.migrate-json-to-mongodb' });
      const connections = await jsonRepos.connections.findAll();
      if (connections.length > 0) {
        const connectionsToInsert = connections.map(conn => {
          const mapped = shouldMapUserId ? mapUserId(conn, jsonUserId!, nextAuthUserId!) : conn;
          return { ...mapped };
        });
        await db.collection('connection_profiles').insertMany(connectionsToInsert);
        totalItemsMigrated += connections.length;
        logger.info(`Migrated ${connections.length} connection profiles`, { context: 'migration.migrate-json-to-mongodb' });
      }

      // ========================================================================
      // 6. Migrate Image Profiles (preserve IDs)
      // ========================================================================
      logger.info('Migrating image profiles...', { context: 'migration.migrate-json-to-mongodb' });
      const imageProfiles = await jsonRepos.imageProfiles.findAll();
      if (imageProfiles.length > 0) {
        const imageProfilesToInsert = imageProfiles.map(profile => {
          const mapped = shouldMapUserId ? mapUserId(profile, jsonUserId!, nextAuthUserId!) : profile;
          return { ...mapped };
        });
        await db.collection('image_profiles').insertMany(imageProfilesToInsert);
        totalItemsMigrated += imageProfiles.length;
        logger.info(`Migrated ${imageProfiles.length} image profiles`, { context: 'migration.migrate-json-to-mongodb' });
      }

      // ========================================================================
      // 7. Migrate Embedding Profiles (preserve IDs)
      // ========================================================================
      logger.info('Migrating embedding profiles...', { context: 'migration.migrate-json-to-mongodb' });
      const embeddingProfiles = await jsonRepos.embeddingProfiles.findAll();
      if (embeddingProfiles.length > 0) {
        const embeddingProfilesToInsert = embeddingProfiles.map(profile => {
          const mapped = shouldMapUserId ? mapUserId(profile, jsonUserId!, nextAuthUserId!) : profile;
          return { ...mapped };
        });
        await db.collection('embedding_profiles').insertMany(embeddingProfilesToInsert);
        totalItemsMigrated += embeddingProfiles.length;
        logger.info(`Migrated ${embeddingProfiles.length} embedding profiles`, { context: 'migration.migrate-json-to-mongodb' });
      }

      // ========================================================================
      // 8. Migrate Personas (preserve IDs)
      // ========================================================================
      logger.info('Migrating personas...', { context: 'migration.migrate-json-to-mongodb' });
      const personas = await jsonRepos.personas.findAll();
      if (personas.length > 0) {
        const personasToInsert = personas.map(persona => {
          const mapped = shouldMapUserId ? mapUserId(persona, jsonUserId!, nextAuthUserId!) : persona;
          return { ...mapped };
        });
        await db.collection('personas').insertMany(personasToInsert);
        totalItemsMigrated += personas.length;
        logger.info(`Migrated ${personas.length} personas`, { context: 'migration.migrate-json-to-mongodb' });
      }

      // ========================================================================
      // 9. Migrate Characters (preserve IDs and all embedded data)
      // ========================================================================
      logger.info('Migrating characters...', { context: 'migration.migrate-json-to-mongodb' });
      const characters = await jsonRepos.characters.findAll();
      if (characters.length > 0) {
        const charactersToInsert = characters.map(character => {
          const mapped = shouldMapUserId ? mapUserId(character, jsonUserId!, nextAuthUserId!) : character;
          // All embedded data is preserved: physicalDescriptions, personaLinks, tags,
          // defaultImageId, defaultConnectionProfileId, avatarOverrides, etc.
          return { ...mapped };
        });
        await db.collection('characters').insertMany(charactersToInsert);
        totalItemsMigrated += characters.length;
        logger.info(`Migrated ${characters.length} characters`, { context: 'migration.migrate-json-to-mongodb' });
      }

      // ========================================================================
      // 10. Migrate Memories (preserve IDs - linked via characterId)
      // ========================================================================
      logger.info('Migrating memories...', { context: 'migration.migrate-json-to-mongodb' });
      const memories = await jsonRepos.memories.findAll();
      if (memories.length > 0) {
        // Memories don't have userId directly, they're linked via characterId
        await db.collection('memories').insertMany(memories);
        totalItemsMigrated += memories.length;
        logger.info(`Migrated ${memories.length} memories`, { context: 'migration.migrate-json-to-mongodb' });
      }

      // ========================================================================
      // 11. Migrate Chats (preserve IDs, participants, and messages)
      // ========================================================================
      logger.info('Migrating chats...', { context: 'migration.migrate-json-to-mongodb' });
      const chats = await jsonRepos.chats.findAll();
      if (chats.length > 0) {
        // Migrate chat metadata (preserve participants with their characterId/personaId refs)
        const chatsToInsert = chats.map(chat => {
          const mapped = shouldMapUserId ? mapUserId(chat, jsonUserId!, nextAuthUserId!) : chat;
          return { ...mapped };
        });
        await db.collection('chats').insertMany(chatsToInsert);
        totalItemsMigrated += chats.length;

        // Migrate chat messages
        let messagesMigrated = 0;
        for (const chat of chats) {
          try {
            const messages = await jsonRepos.chats.getMessages(chat.id);
            if (messages.length > 0) {
              // Store messages in chat_messages collection (same format as MongoDB repo expects)
              await db.collection('chat_messages').insertOne({
                chatId: chat.id,
                messages: messages,
              });
              messagesMigrated += messages.length;
            }
          } catch (error) {
            logger.warn(`Could not migrate messages for chat ${chat.id}`, {
              context: 'migration.migrate-json-to-mongodb',
              error: error instanceof Error ? error.message : String(error),
            });
            allErrors.push({
              entity: 'chat_messages',
              id: chat.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        logger.info(`Migrated ${chats.length} chats with ${messagesMigrated} messages`, {
          context: 'migration.migrate-json-to-mongodb'
        });
      }

      // ========================================================================
      // 12. Migrate Files/Images (preserve IDs)
      // ========================================================================
      logger.info('Migrating files/images...', { context: 'migration.migrate-json-to-mongodb' });
      try {
        const files = await jsonRepos.files.findAll();
        if (files.length > 0) {
          const filesToInsert = files.map(file => {
            const mapped = shouldMapUserId ? mapUserId(file, jsonUserId!, nextAuthUserId!) : file;
            return { ...mapped };
          });
          await db.collection('files').insertMany(filesToInsert);
          totalItemsMigrated += files.length;
          logger.info(`Migrated ${files.length} files`, { context: 'migration.migrate-json-to-mongodb' });
        }
      } catch (error) {
        logger.warn('Could not migrate files', {
          context: 'migration.migrate-json-to-mongodb',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // ========================================================================
      // 13. Migrate Vector Indices (embedding cache for semantic search)
      // ========================================================================
      logger.info('Migrating vector indices...', { context: 'migration.migrate-json-to-mongodb' });
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const vectorIndicesPath = path.join(process.cwd(), 'data', 'vector-indices');

        try {
          const files = await fs.readdir(vectorIndicesPath);
          const jsonFiles = files.filter(f => f.endsWith('.json'));

          if (jsonFiles.length > 0) {
            for (const file of jsonFiles) {
              try {
                const content = await fs.readFile(path.join(vectorIndicesPath, file), 'utf-8');
                const vectorIndex = JSON.parse(content);

                // Add the id field if not present (characterId is the id)
                if (!vectorIndex.id) {
                  vectorIndex.id = vectorIndex.characterId;
                }

                await db.collection('vector_indices').updateOne(
                  { characterId: vectorIndex.characterId },
                  { $set: vectorIndex },
                  { upsert: true }
                );
                totalItemsMigrated += 1;
              } catch (fileError) {
                logger.warn(`Could not migrate vector index ${file}`, {
                  context: 'migration.migrate-json-to-mongodb',
                  error: fileError instanceof Error ? fileError.message : String(fileError),
                });
              }
            }
            logger.info(`Migrated ${jsonFiles.length} vector indices`, { context: 'migration.migrate-json-to-mongodb' });
          }
        } catch (dirError) {
          // Directory doesn't exist - that's fine, no vector indices to migrate
          if ((dirError as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw dirError;
          }
          logger.debug('No vector-indices directory found, skipping', { context: 'migration.migrate-json-to-mongodb' });
        }
      } catch (error) {
        logger.warn('Could not migrate vector indices', {
          context: 'migration.migrate-json-to-mongodb',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // ========================================================================
      // 14. Migrate Migration State (so future migrations use MongoDB)
      // ========================================================================
      logger.info('Migrating migration state...', { context: 'migration.migrate-json-to-mongodb' });
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const migrationsFilePath = path.join(process.cwd(), 'data', 'settings', 'migrations.json');

        try {
          const content = await fs.readFile(migrationsFilePath, 'utf-8');
          const migrationState = JSON.parse(content);

          // Save to MongoDB migrations_state collection
          // Use type assertion for string _id (singleton document pattern)
          await db.collection<{ _id: string }>('migrations_state').updateOne(
            { _id: 'migration_state' },
            {
              $set: {
                completedMigrations: migrationState.completedMigrations || [],
                lastChecked: migrationState.lastChecked || new Date().toISOString(),
                quilltapVersion: migrationState.quilltapVersion || '1.0.0',
              },
            },
            { upsert: true }
          );
          totalItemsMigrated += 1;
          logger.info('Migrated migration state to MongoDB', { context: 'migration.migrate-json-to-mongodb' });
        } catch (fileError) {
          // File doesn't exist - that's fine, no state to migrate
          if ((fileError as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw fileError;
          }
          logger.debug('No migrations.json file found, skipping', { context: 'migration.migrate-json-to-mongodb' });
        }
      } catch (error) {
        logger.warn('Could not migrate migration state', {
          context: 'migration.migrate-json-to-mongodb',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const durationMs = Date.now() - startTime;
      const success = allErrors.length === 0;

      logger.info('Completed JSON to MongoDB migration', {
        context: 'migration.migrate-json-to-mongodb',
        success,
        itemsMigrated: totalItemsMigrated,
        errorsCount: allErrors.length,
        durationMs,
      });

      const errorSummary =
        allErrors.length > 0
          ? allErrors
              .slice(0, 5)
              .map(e => `${e.entity}/${e.id}: ${e.error}`)
              .join('; ')
          : undefined;

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
  },
};
