/**
 * Repository Factory
 *
 * Provides access to MongoDB data repositories.
 *
 * Note: JSON file storage has been deprecated. For migration from JSON to MongoDB,
 * use the qtap-plugin-upgrade migration plugin which has its own copy of the
 * JSON-store code for reading legacy data.
 */

import { logger } from '@/lib/logger';
import {
  getRepositories as getMongoRepos,
  RepositoryContainer as MongoRepositoryContainer,
} from '@/lib/mongodb/repositories';

/**
 * Type alias for repository container
 * Uses the MongoDB container as the canonical interface
 */
export type RepositoryContainer = MongoRepositoryContainer;

/**
 * Lazy-loaded repository cache
 */
let cachedRepositories: RepositoryContainer | null = null;

/**
 * Get the configured data backend
 * @returns Always returns 'mongodb' - JSON backend is deprecated
 * @deprecated This function always returns 'mongodb'. Use getRepositories() directly.
 */
export function getDataBackend(): 'mongodb' {
  logger.debug('Retrieved data backend configuration', { backend: 'mongodb' });
  return 'mongodb';
}

/**
 * Check if MongoDB is the active backend
 * @returns Always returns true - MongoDB is the only supported backend
 * @deprecated This function always returns true. MongoDB is now required.
 */
export function isMongoDBEnabled(): boolean {
  logger.debug('Checked MongoDB enabled status', { enabled: true, backend: 'mongodb' });
  return true;
}

/**
 * Get the repository container (MongoDB)
 *
 * @returns RepositoryContainer for MongoDB backend
 */
export function getRepositories(): RepositoryContainer {
  logger.debug('Getting MongoDB repositories');

  // Return cached repositories if already initialized
  if (cachedRepositories) {
    logger.debug('Returning cached repositories');
    return cachedRepositories;
  }

  logger.info('Initializing MongoDB backend repositories');
  cachedRepositories = getMongoRepos();

  logger.debug('Repositories initialized successfully', { backend: 'mongodb' });
  return cachedRepositories;
}

/**
 * Reset repository caches
 * Useful for testing or resetting state
 */
export function resetRepositories(): void {
  logger.debug('Resetting repository caches');
  cachedRepositories = null;
  logger.info('Repository caches cleared');
}
