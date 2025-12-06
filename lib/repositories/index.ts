/**
 * Repositories Module
 *
 * Central export point for all repository functionality.
 * Provides factory functions for accessing MongoDB repositories.
 *
 * Note: JSON file storage has been deprecated. For migration from JSON to MongoDB,
 * use the qtap-plugin-upgrade migration plugin.
 */

export {
  getDataBackend,
  isMongoDBEnabled,
  getRepositories,
  resetRepositories,
  type RepositoryContainer,
} from './factory';
