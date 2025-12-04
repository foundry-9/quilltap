/**
 * Repositories Module
 *
 * Central export point for all repository functionality.
 * Provides factory functions for accessing repositories with support
 * for multiple data backends (JSON, MongoDB, or dual-write).
 */

export {
  getDataBackend,
  isMongoDBEnabled,
  getRepositories,
  getJsonRepositories,
  resetRepositories,
  type RepositoryContainer,
} from './factory';
