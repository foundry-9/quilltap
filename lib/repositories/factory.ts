/**
 * Repository Factory
 *
 * Provides access to data repositories with support for multiple backends:
 * - 'json' (default): Uses JSON file storage
 * - 'mongodb': Uses MongoDB storage
 *
 * The active backend is determined by the DATA_BACKEND environment variable.
 *
 * Note: This is a simple backend switcher. For migration purposes, use the
 * dedicated migration utilities that can access both backends directly.
 */

import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import {
  getRepositories as getJsonRepos,
  RepositoryContainer as JsonRepositoryContainer,
} from '@/lib/json-store/repositories';

/**
 * Type alias for repository container
 * Uses the JSON container as the canonical interface since it's the original
 */
export type RepositoryContainer = JsonRepositoryContainer;

/**
 * Lazy-loaded repository cache
 */
let cachedRepositories: RepositoryContainer | null = null;

/**
 * Get the configured data backend from environment
 * @returns The active backend: 'json' or 'mongodb'
 */
export function getDataBackend(): 'json' | 'mongodb' {
  const backend = env.DATA_BACKEND as 'json' | 'mongodb' | undefined;
  const result = backend === 'mongodb' ? 'mongodb' : 'json';
  logger.debug('Retrieved data backend configuration', { backend: result });
  return result;
}

/**
 * Check if MongoDB is the active backend
 * @returns true if MongoDB is the active backend
 */
export function isMongoDBEnabled(): boolean {
  const backend = getDataBackend();
  const enabled = backend === 'mongodb';
  logger.debug('Checked MongoDB enabled status', { enabled, backend });
  return enabled;
}

/**
 * Get JSON repositories directly
 * Useful for migration or direct access to JSON backend
 * @returns JSON RepositoryContainer
 */
export function getJsonRepositories(): RepositoryContainer {
  logger.debug('Getting JSON repositories directly');
  return getJsonRepos();
}

/**
 * Get the repository container based on configured backend
 * Currently only supports JSON backend. MongoDB backend will be added
 * once the MongoDB repositories implement the same interface.
 *
 * @returns RepositoryContainer for the active backend
 */
export function getRepositories(): RepositoryContainer {
  const backend = getDataBackend();

  logger.debug('Getting repositories for backend', { backend });

  // Return cached repositories if already initialized
  if (cachedRepositories) {
    logger.debug('Returning cached repositories');
    return cachedRepositories;
  }

  // For now, always use JSON repositories
  // MongoDB repositories are available but have a different interface
  // They will be used directly by migration scripts and can be switched
  // once the interface is unified
  if (backend === 'mongodb') {
    logger.warn(
      'MongoDB backend requested but interface not yet unified. ' +
      'Using JSON backend. MongoDB repositories are available at @/lib/mongodb/repositories ' +
      'for direct use in migrations and new code.'
    );
  }

  logger.info('Initializing JSON backend repositories');
  cachedRepositories = getJsonRepos();

  logger.debug('Repositories initialized successfully', { backend: 'json' });
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
