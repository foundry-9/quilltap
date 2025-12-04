/**
 * MongoDB Repositories Index
 *
 * Central export point for all MongoDB repository classes and utilities.
 * Provides a RepositoryContainer interface for dependency injection and
 * singleton pattern for managing repository instances.
 */

import { logger } from '@/lib/logger';

// Export base repository
export { MongoBaseRepository } from './base.repository';

// Export all repository classes
export { CharactersRepository } from './characters.repository';
export { PersonasRepository } from './personas.repository';
export { MongoChatsRepository } from './chats.repository';
export { MongoTagsRepository } from './tags.repository';
export { UsersRepository } from './users.repository';
export { ConnectionProfilesRepository } from './connection-profiles.repository';
export { MongoImageProfilesRepository } from './image-profiles.repository';
export { EmbeddingProfilesRepository } from './embedding-profiles.repository';
export { MemoriesRepository } from './memories.repository';
export { FilesRepository } from './files.repository';

// Import all repository classes
import { MongoBaseRepository } from './base.repository';
import { CharactersRepository } from './characters.repository';
import { PersonasRepository } from './personas.repository';
import { MongoChatsRepository } from './chats.repository';
import { MongoTagsRepository } from './tags.repository';
import { UsersRepository } from './users.repository';
import { ConnectionProfilesRepository } from './connection-profiles.repository';
import { MongoImageProfilesRepository } from './image-profiles.repository';
import { EmbeddingProfilesRepository } from './embedding-profiles.repository';
import { MemoriesRepository } from './memories.repository';
import { FilesRepository } from './files.repository';

/**
 * Container interface for all repository instances.
 * Provides type-safe access to repositories throughout the application.
 */
export interface RepositoryContainer {
  characters: CharactersRepository;
  personas: PersonasRepository;
  chats: MongoChatsRepository;
  tags: MongoTagsRepository;
  users: UsersRepository;
  connections: ConnectionProfilesRepository;
  images: FilesRepository; // Files repo handles both metadata + S3 for backwards compatibility
  imageProfiles: MongoImageProfilesRepository;
  embeddingProfiles: EmbeddingProfilesRepository;
  memories: MemoriesRepository;
  files: FilesRepository; // For direct file access
}

/**
 * Singleton instance of the repository container
 */
let repositoryInstance: RepositoryContainer | null = null;

/**
 * Create a new instance of all repositories.
 * This function instantiates all repository classes and returns them in a container.
 *
 * @returns {RepositoryContainer} Container with all repository instances
 */
export function createRepositories(): RepositoryContainer {
  logger.debug('Creating new repository container');

  try {
    const repositories: RepositoryContainer = {
      characters: new CharactersRepository(),
      personas: new PersonasRepository(),
      chats: new MongoChatsRepository(),
      tags: new MongoTagsRepository(),
      users: new UsersRepository(),
      connections: new ConnectionProfilesRepository(),
      images: new FilesRepository(),
      imageProfiles: new MongoImageProfilesRepository(),
      embeddingProfiles: new EmbeddingProfilesRepository(),
      memories: new MemoriesRepository(),
      files: new FilesRepository(),
    };

    logger.debug('Repository container created successfully', {
      repositories: Object.keys(repositories),
    });

    return repositories;
  } catch (error) {
    logger.error('Failed to create repository container', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get the singleton instance of the repository container.
 * Creates the instance on first call, subsequent calls return the cached instance.
 *
 * @returns {RepositoryContainer} Singleton repository container instance
 */
export function getRepositories(): RepositoryContainer {
  if (!repositoryInstance) {
    logger.debug('Initializing singleton repository instance');
    repositoryInstance = createRepositories();
  }

  logger.debug('Returning repository instance');
  return repositoryInstance;
}

/**
 * Reset the singleton repository instance.
 * Useful for testing to ensure a clean state between tests.
 *
 * @returns {void}
 */
export function resetRepositories(): void {
  logger.debug('Resetting repository instance');
  repositoryInstance = null;
}
