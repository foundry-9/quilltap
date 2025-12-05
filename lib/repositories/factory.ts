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
import { getRepositories as getMongoRepos } from '@/lib/mongodb/repositories';

/**
 * Type alias for repository container
 * Uses the JSON container as the canonical interface since it's the original
 */
export type RepositoryContainer = JsonRepositoryContainer;

/**
 * Lazy-loaded repository cache
 */
let cachedRepositories: RepositoryContainer | null = null;
let cachedBackend: 'json' | 'mongodb' | null = null;

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
 *
 * @returns RepositoryContainer for the active backend
 */
export function getRepositories(): RepositoryContainer {
  const backend = getDataBackend();

  logger.debug('Getting repositories for backend', { backend });

  // Return cached repositories if already initialized for the same backend
  if (cachedRepositories && cachedBackend === backend) {
    logger.debug('Returning cached repositories', { backend: cachedBackend });
    return cachedRepositories;
  }

  // Clear cache if backend changed
  if (cachedBackend !== backend) {
    cachedRepositories = null;
    cachedBackend = null;
  }

  if (backend === 'mongodb') {
    logger.info('Initializing MongoDB backend repositories');
    const mongoRepos = getMongoRepos();

    // Cast MongoDB repos to match the JSON interface
    // The interfaces are compatible after our fixes
    cachedRepositories = mongoRepos as unknown as RepositoryContainer;
    cachedBackend = 'mongodb';

    logger.debug('Repositories initialized successfully', { backend: 'mongodb' });
    return cachedRepositories;
  }

  logger.info('Initializing JSON backend repositories');
  cachedRepositories = getJsonRepos();
  cachedBackend = 'json';

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
  cachedBackend = null;
  logger.info('Repository caches cleared');
}
