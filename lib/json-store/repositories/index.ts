/**
 * Repository Factory
 *
 * Creates and provides access to all JSON-backed repositories.
 * This is the main entry point for data access in the JSON store.
 */

import { JsonStore, getJsonStore } from '../core/json-store';
import { CharactersRepository } from './characters.repository';
import { PersonasRepository } from './personas.repository';
import { ChatsRepository } from './chats.repository';
import { TagsRepository } from './tags.repository';
import { UsersRepository } from './users.repository';
import { ConnectionProfilesRepository } from './connection-profiles.repository';
import { ImagesRepository } from './images.repository';
import { ImageProfilesRepository } from './image-profiles.repository';
import { EmbeddingProfilesRepository } from './embedding-profiles.repository';
import { MemoriesRepository } from './memories.repository';

/**
 * All repositories available from JsonStore
 */
export interface RepositoryContainer {
  characters: CharactersRepository;
  personas: PersonasRepository;
  chats: ChatsRepository;
  tags: TagsRepository;
  users: UsersRepository;
  connections: ConnectionProfilesRepository;
  images: ImagesRepository;
  imageProfiles: ImageProfilesRepository;
  embeddingProfiles: EmbeddingProfilesRepository;
  memories: MemoriesRepository;
}

/**
 * Create repository instances
 */
export function createRepositories(jsonStore: JsonStore): RepositoryContainer {
  return {
    characters: new CharactersRepository(jsonStore),
    personas: new PersonasRepository(jsonStore),
    chats: new ChatsRepository(jsonStore),
    tags: new TagsRepository(jsonStore),
    users: new UsersRepository(jsonStore),
    connections: new ConnectionProfilesRepository(jsonStore),
    images: new ImagesRepository(jsonStore),
    imageProfiles: new ImageProfilesRepository(jsonStore),
    embeddingProfiles: new EmbeddingProfilesRepository(jsonStore),
    memories: new MemoriesRepository(jsonStore),
  };
}

/**
 * Singleton repository container
 */
let repositoryContainer: RepositoryContainer | null = null;

/**
 * Get or create repository container
 */
export function getRepositories(config?: any): RepositoryContainer {
  if (!repositoryContainer) {
    const jsonStore = getJsonStore(config);
    repositoryContainer = createRepositories(jsonStore);
  }
  return repositoryContainer;
}

/**
 * Reset repositories (for testing)
 */
export function resetRepositories(): void {
  repositoryContainer = null;
}

/**
 * Export all repository types and classes
 */
export { BaseRepository } from './base.repository';
export { CharactersRepository } from './characters.repository';
export { PersonasRepository } from './personas.repository';
export { ChatsRepository } from './chats.repository';
export { TagsRepository } from './tags.repository';
export { UsersRepository } from './users.repository';
export { ConnectionProfilesRepository } from './connection-profiles.repository';
export { ImagesRepository } from './images.repository';
export { ImageProfilesRepository } from './image-profiles.repository';
export { EmbeddingProfilesRepository } from './embedding-profiles.repository';
export { MemoriesRepository } from './memories.repository';
