/**
 * User-Scoped Repository Wrappers
 *
 * These wrappers automatically scope all repository operations to a specific user,
 * making it impossible to accidentally access another user's data.
 *
 * Usage:
 *   const repos = getUserRepositories(session.user.id);
 *   const characters = await repos.characters.findAll(); // Only returns user's characters
 *   const character = await repos.characters.findById(id); // Returns null if not user's
 */

import { logger } from '@/lib/logger';
import {
  RepositoryContainer,
  CharactersRepository,
  ChatsRepository,
  TagsRepository,
  ConnectionProfilesRepository,
  ImageProfilesRepository,
  EmbeddingProfilesRepository,
  MemoriesRepository,
  FilesRepository,
  ProjectsRepository,
  GroupsRepository,
  GroupCharacterMembersRepository,
  GroupDocMountLinksRepository,
  LLMLogsRepository,
  type CreateOptions,
  type LLMLogTypeStatsRow,
  type LLMLogProfileStatsRow,
  type LLMLogCacheStatsRow,
} from '@/lib/database/repositories';
import { getRepositories, getRepositoriesSafe } from './factory';
import type {
  Character,
  ChatMetadata,
  Tag,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  Memory,
  FileEntry,
  ApiKey,
  ChatEvent,
  Project,
  Group,
  LLMLog,
  LLMLogType,
  ParticipantStatus,
} from '@/lib/schemas/types';

// ============================================================================
// Generic Base Class
// ============================================================================

/**
 * Base class for user-scoped repositories.
 * Provides common CRUD operations with automatic user scoping. Concrete
 * (instantiated directly for Tags, ImageProfiles, EmbeddingProfiles where
 * the user-scoping helpers on top of CRUD aren't actually consumed).
 */
class UserScopedRepository<
  T extends { userId?: string; id: string },
  R extends {
    findById(id: string): Promise<T | null>;
    findByUserId(userId: string): Promise<T[]>;
    create(data: any, options?: CreateOptions): Promise<T>;
    update(id: string, data: any): Promise<T | null>;
    delete(id: string): Promise<boolean>;
  }
> {
  constructor(
    protected readonly userId: string,
    protected readonly baseRepo: R
  ) {}

  async findAll(): Promise<T[]> {
    return this.baseRepo.findByUserId(this.userId);
  }

  async findById(id: string): Promise<T | null> {
    const item = await this.baseRepo.findById(id);
    if (!item || item.userId !== this.userId) return null;
    return item;
  }

  async create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'userId'>, options?: CreateOptions): Promise<T> {
    return this.baseRepo.create({ ...data, userId: this.userId }, options);
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    const item = await this.findById(id);
    if (!item) return null;
    const { userId: _, ...safeData } = data as any;
    return this.baseRepo.update(id, safeData);
  }

  async delete(id: string): Promise<boolean> {
    const item = await this.findById(id);
    if (!item) return false;
    return this.baseRepo.delete(id);
  }

  /**
   * Filter results by user ownership
   */
  protected filterByUser(items: T[]): T[] {
    return items.filter(item => item.userId === this.userId);
  }
}

/**
 * Base class for repositories with tag support
 */
abstract class UserScopedTaggableRepository<
  T extends { userId?: string; id: string; tags?: string[] },
  R extends {
    findById(id: string): Promise<T | null>;
    findByUserId(userId: string): Promise<T[]>;
    findByTag(tagId: string): Promise<T[]>;
    create(data: any, options?: CreateOptions): Promise<T>;
    update(id: string, data: any): Promise<T | null>;
    delete(id: string): Promise<boolean>;
    addTag(id: string, tagId: string): Promise<T | null>;
    removeTag(id: string, tagId: string): Promise<T | null>;
  }
> extends UserScopedRepository<T, R> {
  async findByTag(tagId: string): Promise<T[]> {
    const items = await this.baseRepo.findByTag(tagId);
    return this.filterByUser(items);
  }

  async addTag(entityId: string, tagId: string): Promise<T | null> {
    const item = await this.findById(entityId);
    if (!item) return null;
    return this.baseRepo.addTag(entityId, tagId);
  }

  async removeTag(entityId: string, tagId: string): Promise<T | null> {
    const item = await this.findById(entityId);
    if (!item) return null;
    return this.baseRepo.removeTag(entityId, tagId);
  }
}

// ============================================================================
// Entity-Specific Repositories
// ============================================================================

/**
 * User-scoped Characters Repository
 */
class UserScopedCharactersRepository extends UserScopedTaggableRepository<Character, CharactersRepository> {
  async setFavorite(characterId: string, isFavorite: boolean): Promise<Character | null> {
    const character = await this.findById(characterId);
    if (!character) return null;
    return this.baseRepo.setFavorite(characterId, isFavorite);
  }

  async addPartnerLink(characterId: string, partnerId: string, isDefault?: boolean): Promise<Character | null> {
    const character = await this.findById(characterId);
    if (!character) return null;
    return this.baseRepo.addPartnerLink(characterId, partnerId, isDefault);
  }

  async removePartnerLink(characterId: string, partnerId: string): Promise<Character | null> {
    const character = await this.findById(characterId);
    if (!character) return null;
    return this.baseRepo.removePartnerLink(characterId, partnerId);
  }
}

/**
 * User-scoped Chats Repository
 */
class UserScopedChatsRepository extends UserScopedTaggableRepository<ChatMetadata, ChatsRepository> {
  async findByCharacterId(characterId: string): Promise<ChatMetadata[]> {
    const chats = await this.baseRepo.findByCharacterId(characterId);
    return this.filterByUser(chats);
  }

  async delete(id: string, options?: { syncVaults?: boolean }): Promise<boolean> {
    const chat = await this.findById(id);
    if (!chat) return false;
    return this.baseRepo.delete(id, options);
  }

  async getMessages(chatId: string): Promise<ChatEvent[]> {
    const chat = await this.findById(chatId);
    if (!chat) return [];
    return this.baseRepo.getMessages(chatId);
  }

  async getLastPlayedMessageAt(chatId: string): Promise<string | null> {
    return this.baseRepo.getLastPlayedMessageAt(chatId);
  }

  async addMessage(chatId: string, message: ChatEvent): Promise<ChatEvent> {
    const chat = await this.findById(chatId);
    if (!chat) throw new Error('Chat not found or access denied');
    return this.baseRepo.addMessage(chatId, message);
  }

  async setParticipantStatus(
    chatId: string,
    participantId: string,
    newStatus: ParticipantStatus
  ): Promise<{ chat: ChatMetadata | null; oldStatus: ParticipantStatus }> {
    const chat = await this.findById(chatId);
    if (!chat) throw new Error('Chat not found or access denied');
    return this.baseRepo.setParticipantStatus(chatId, participantId, newStatus);
  }

  async clearMessages(chatId: string): Promise<boolean> {
    const chat = await this.findById(chatId);
    if (!chat) throw new Error('Chat not found or access denied');
    return this.baseRepo.clearMessages(chatId);
  }

  async deleteMessagesByIds(chatId: string, messageIds: string[]): Promise<number> {
    const chat = await this.findById(chatId);
    if (!chat) throw new Error('Chat not found or access denied');
    return this.baseRepo.deleteMessagesByIds(chatId, messageIds);
  }

  async searchMessagesGlobal(
    searchText: string,
    limit?: number
  ): Promise<Array<{ messageId: string; content: string; chatId: string; role: string; createdAt: string }>> {
    const chats = await this.findAll();
    const chatIds = chats.map(c => c.id);
    return this.baseRepo.searchMessagesGlobal(chatIds, searchText, limit);
  }
}

/**
 * User-scoped Connection Profiles Repository (includes API keys)
 */
class UserScopedConnectionsRepository extends UserScopedTaggableRepository<ConnectionProfile, ConnectionProfilesRepository> {
  async findDefault(): Promise<ConnectionProfile | null> {
    return this.baseRepo.findDefault(this.userId);
  }

  // API Keys - all scoped to user
  async getAllApiKeys(): Promise<ApiKey[]> {
    return this.baseRepo.getApiKeysByUserId(this.userId);
  }

  async findApiKeyById(id: string): Promise<ApiKey | null> {
    return this.baseRepo.findApiKeyByIdAndUserId(id, this.userId);
  }

  async createApiKey(data: Omit<ApiKey, 'id' | 'createdAt' | 'updatedAt' | 'userId'>): Promise<ApiKey> {
    return this.baseRepo.createApiKey({ ...data, userId: this.userId });
  }

  async updateApiKey(id: string, data: Partial<ApiKey>): Promise<ApiKey | null> {
    const apiKey = await this.findApiKeyById(id);
    if (!apiKey) return null;
    const { userId: _, ...safeData } = data;
    return this.baseRepo.updateApiKey(id, safeData);
  }

  async deleteApiKey(id: string): Promise<boolean> {
    const apiKey = await this.findApiKeyById(id);
    if (!apiKey) return false;
    return this.baseRepo.deleteApiKey(id);
  }

  async recordApiKeyUsage(id: string): Promise<ApiKey | null> {
    const apiKey = await this.findApiKeyById(id);
    if (!apiKey) return null;
    return this.baseRepo.recordApiKeyUsage(id);
  }
}

/**
 * User-scoped Memories Repository
 * Note: Uses charactersRepo for access control since memories belong to characters
 */
class UserScopedMemoriesRepository {
  constructor(
    private readonly userId: string,
    private readonly baseRepo: MemoriesRepository,
    private readonly charactersRepo: UserScopedCharactersRepository
  ) {}

  async findByCharacterId(characterId: string): Promise<Memory[]> {
    const character = await this.charactersRepo.findById(characterId);
    if (!character) return [];
    return this.baseRepo.findByCharacterId(characterId);
  }

  async findById(id: string): Promise<Memory | null> {
    const memory = await this.baseRepo.findById(id);
    if (!memory) return null;
    const character = await this.charactersRepo.findById(memory.characterId);
    if (!character) return null;
    return memory;
  }

  /**
   * `options` is forwarded so callers can pin an explicit id — restore relies on
   * it to re-insert memories under their backed-up ids, which is what keeps
   * `relatedMemoryIds` edges resolving. This class scopes by character rather
   * than userId, so it doesn't inherit the generic wrapper's pass-through.
   */
  async create(data: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>, options?: CreateOptions): Promise<Memory> {
    const character = await this.charactersRepo.findById(data.characterId);
    if (!character) throw new Error('Character not found or access denied');
    return this.baseRepo.create(data, options);
  }

  async update(id: string, data: Partial<Memory>): Promise<Memory | null> {
    const memory = await this.findById(id);
    if (!memory) return null;
    return this.baseRepo.update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    const memory = await this.findById(id);
    if (!memory) return false;
    return this.baseRepo.delete(id);
  }

  async searchByContent(characterId: string, query: string): Promise<Memory[]> {
    const character = await this.charactersRepo.findById(characterId);
    if (!character) return [];
    return this.baseRepo.searchByContent(characterId, query);
  }

  async findByImportance(characterId: string, minImportance: number): Promise<Memory[]> {
    const character = await this.charactersRepo.findById(characterId);
    if (!character) return [];
    return this.baseRepo.findByImportance(characterId, minImportance);
  }

  async findBySource(characterId: string, source: 'AUTO' | 'MANUAL'): Promise<Memory[]> {
    const character = await this.charactersRepo.findById(characterId);
    if (!character) return [];
    return this.baseRepo.findBySource(characterId, source);
  }
}

/**
 * Projects Repository (global).
 *
 * Projects are no longer user-scoped — they belong to the instance, not a user
 * (the project-store cutover dropped `userId`). This wrapper is therefore a
 * thin pass-through to the base repository with no user filtering. It keeps the
 * `(userId, baseRepo)` constructor only so the container assembly stays
 * uniform; the userId is intentionally ignored.
 */
class UserScopedProjectsRepository {
  constructor(_userId: string, private readonly baseRepo: ProjectsRepository) {}

  findAll(): Promise<Project[]> {
    return this.baseRepo.findAll();
  }

  findById(id: string): Promise<Project | null> {
    return this.baseRepo.findById(id);
  }

  findByIds(ids: string[]): Promise<Project[]> {
    return this.baseRepo.findByIds(ids);
  }

  create(
    data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions,
  ): Promise<Project> {
    return this.baseRepo.create(data, options);
  }

  update(id: string, data: Partial<Project>): Promise<Project | null> {
    return this.baseRepo.update(id, data);
  }

  delete(id: string): Promise<boolean> {
    return this.baseRepo.delete(id);
  }

  findByCharacterId(characterId: string): Promise<Project[]> {
    return this.baseRepo.findByCharacterId(characterId);
  }

  addToRoster(projectId: string, characterId: string): Promise<Project | null> {
    return this.baseRepo.addToRoster(projectId, characterId);
  }

  addManyToRoster(projectId: string, characterIds: string[]): Promise<Project | null> {
    return this.baseRepo.addManyToRoster(projectId, characterIds);
  }

  removeFromRoster(projectId: string, characterId: string): Promise<Project | null> {
    return this.baseRepo.removeFromRoster(projectId, characterId);
  }

  canCharacterParticipate(projectId: string, characterId: string): Promise<boolean> {
    return this.baseRepo.canCharacterParticipate(projectId, characterId);
  }

  setAllowAnyCharacter(projectId: string, allowAnyCharacter: boolean): Promise<Project | null> {
    return this.baseRepo.setAllowAnyCharacter(projectId, allowAnyCharacter);
  }
}

/**
 * User-scoped Groups Repository
 */
class UserScopedGroupsRepository {
  constructor(_userId: string, private readonly baseRepo: GroupsRepository) {}

  findAll(): Promise<Group[]> {
    return this.baseRepo.findAll();
  }

  findById(id: string): Promise<Group | null> {
    return this.baseRepo.findById(id);
  }

  findByIds(ids: string[]): Promise<Group[]> {
    return this.baseRepo.findByIds(ids);
  }

  create(
    data: Omit<Group, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions,
  ): Promise<Group> {
    return this.baseRepo.create(data, options);
  }

  update(id: string, data: Partial<Group>): Promise<Group | null> {
    return this.baseRepo.update(id, data);
  }

  delete(id: string): Promise<boolean> {
    return this.baseRepo.delete(id);
  }
}

/**
 * User-scoped Files Repository
 */
class UserScopedFilesRepository extends UserScopedTaggableRepository<FileEntry, FilesRepository> {
  async findBySha256(sha256: string): Promise<FileEntry[]> {
    const files = await this.baseRepo.findBySha256(sha256);
    return this.filterByUser(files);
  }

  async findByCategory(category: string): Promise<FileEntry[]> {
    const files = await this.baseRepo.findByCategory(category as any);
    return this.filterByUser(files);
  }

  async findByLinkedTo(entityId: string): Promise<FileEntry[]> {
    const files = await this.baseRepo.findByLinkedTo(entityId);
    return this.filterByUser(files);
  }

  async addLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    const file = await this.findById(fileId);
    if (!file) return null;
    return this.baseRepo.addLink(fileId, entityId);
  }

  async removeLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    const file = await this.findById(fileId);
    if (!file) return null;
    return this.baseRepo.removeLink(fileId, entityId);
  }
}

/**
 * User-scoped LLM Logs Repository
 * Note: LLM logs are user-scoped only (no tagging or special features)
 */
class UserScopedLLMLogsRepository extends UserScopedRepository<LLMLog, LLMLogsRepository> {
  async findAll(limit?: number, offset?: number): Promise<LLMLog[]> {
    return this.baseRepo.findByUserId(this.userId, limit ?? 50, offset ?? 0);
  }

  async findByMessageId(messageId: string): Promise<LLMLog[]> {
    const logs = await this.baseRepo.findByMessageId(messageId);
    return this.filterByUser(logs);
  }

  async findByChatId(chatId: string): Promise<LLMLog[]> {
    const logs = await this.baseRepo.findByChatId(chatId);
    return this.filterByUser(logs);
  }

  async findByCharacterId(characterId: string): Promise<LLMLog[]> {
    const logs = await this.baseRepo.findByCharacterId(characterId);
    return this.filterByUser(logs);
  }

  async findStandalone(limit?: number): Promise<LLMLog[]> {
    const logs = await this.baseRepo.findStandalone(this.userId, limit);
    return logs;
  }

  async findByType(type: any, limit?: number): Promise<LLMLog[]> {
    const logs = await this.baseRepo.findByType(this.userId, type, limit);
    return logs;
  }

  async findRecent(limit?: number): Promise<LLMLog[]> {
    const logs = await this.baseRepo.findRecent(this.userId, limit);
    return logs;
  }

  async countByUserId(): Promise<number> {
    return this.baseRepo.countByUserId(this.userId);
  }

  async countByType(type: any): Promise<number> {
    return this.baseRepo.countByType(this.userId, type);
  }

  async getTotalTokenUsage(): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
    return this.baseRepo.getTotalTokenUsage(this.userId);
  }

  async deleteByMessageId(messageId: string): Promise<number> {
    return this.baseRepo.deleteByMessageId(messageId);
  }

  async deleteByChatId(chatId: string): Promise<number> {
    return this.baseRepo.deleteByChatId(chatId);
  }

  async deleteByCharacterId(characterId: string): Promise<number> {
    return this.baseRepo.deleteByCharacterId(characterId);
  }

  // --- Aggregates (The Almanack) -------------------------------------------

  /** Does the logs table carry the 4.9 profile-attribution columns yet? */
  hasProfileAttributionColumns(): boolean {
    return this.baseRepo.hasProfileAttributionColumns();
  }

  async getStatsByType(): Promise<LLMLogTypeStatsRow[]> {
    return this.baseRepo.getStatsByType(this.userId);
  }

  async getStatsByProfile(
    groupBy: 'connectionProfileId' | 'imageProfileId' | 'providerModel',
    options?: { type?: LLMLogType },
  ): Promise<LLMLogProfileStatsRow[]> {
    return this.baseRepo.getStatsByProfile(this.userId, groupBy, options ?? {});
  }

  async getMedianDurationByProfile(
    groupBy: 'connectionProfileId' | 'imageProfileId' | 'providerModel',
  ): Promise<Array<{ key: string; medianDurationMs: number }>> {
    return this.baseRepo.getMedianDurationByProfile(this.userId, groupBy);
  }

  async getCacheStats(
    groupBy: 'provider' | 'connectionProfileId',
  ): Promise<LLMLogCacheStatsRow[]> {
    return this.baseRepo.getCacheStats(this.userId, groupBy);
  }
}

// ============================================================================
// Container and Factory
// ============================================================================

/**
 * Container interface for user-scoped repositories
 */
export interface UserScopedRepositoryContainer {
  /** The user ID this container is scoped to */
  readonly userId: string;
  /** Characters repository - only returns user's characters */
  characters: UserScopedCharactersRepository;
  /** Chats repository - only returns user's chats */
  chats: UserScopedChatsRepository;
  /** Tags repository - only returns user's tags */
  tags: UserScopedRepository<Tag, TagsRepository>;
  /** Connection profiles & API keys repository - only returns user's profiles/keys */
  connections: UserScopedConnectionsRepository;
  /** Image profiles repository - only returns user's image profiles */
  imageProfiles: UserScopedRepository<ImageProfile, ImageProfilesRepository>;
  /** Embedding profiles repository - only returns user's embedding profiles */
  embeddingProfiles: UserScopedRepository<EmbeddingProfile, EmbeddingProfilesRepository>;
  /** Memories repository - only returns memories for user's characters */
  memories: UserScopedMemoriesRepository;
  /** Files repository - only returns user's files */
  files: UserScopedFilesRepository;
  /** Images repository (alias for files) - only returns user's images */
  images: UserScopedFilesRepository;
  /** Projects repository - only returns user's projects */
  projects: UserScopedProjectsRepository;
  /** Groups repository - only returns user's groups */
  groups: UserScopedGroupsRepository;
  /** Group character members repository (mount index) */
  groupCharacterMembers: GroupCharacterMembersRepository;
  /** Group document mount links repository (mount index) */
  groupDocMountLinks: GroupDocMountLinksRepository;
  /** LLM logs repository - only returns user's LLM logs */
  llmLogs: UserScopedLLMLogsRepository;
}

/**
 * Cache for user-scoped repository containers
 */
const userRepoCache = new Map<string, UserScopedRepositoryContainer>();

/**
 * Get a user-scoped repository container.
 * All operations through this container are automatically filtered to the specified user.
 *
 * @param userId The user ID to scope all operations to
 * @returns UserScopedRepositoryContainer with all repositories scoped to the user
 *
 * @example
 * ```typescript
 * const repos = getUserRepositories(session.user.id);
 *
 * // All operations are automatically scoped to the user
 * const characters = await repos.characters.findAll(); // Only user's characters
 * const character = await repos.characters.findById(id); // Returns null if not user's
 * const chat = await repos.chats.findById(chatId); // Returns null if not user's
 * ```
 */
export function getUserRepositories(userId: string): UserScopedRepositoryContainer {
  if (!userId) {
    throw new Error('userId is required for getUserRepositories');
  }

  // Check cache first
  const cached = userRepoCache.get(userId);
  if (cached) {
    return cached;
  }
  // Get the base repositories
  const baseRepos = getRepositories();

  // Create user-scoped wrappers
  const characters = new UserScopedCharactersRepository(userId, baseRepos.characters);
  const chats = new UserScopedChatsRepository(userId, baseRepos.chats);
  const tags = new UserScopedRepository<Tag, TagsRepository>(userId, baseRepos.tags);
  const connections = new UserScopedConnectionsRepository(userId, baseRepos.connections);
  const imageProfiles = new UserScopedRepository<ImageProfile, ImageProfilesRepository>(userId, baseRepos.imageProfiles);
  const embeddingProfiles = new UserScopedRepository<EmbeddingProfile, EmbeddingProfilesRepository>(userId, baseRepos.embeddingProfiles);
  const files = new UserScopedFilesRepository(userId, baseRepos.files);
  const memories = new UserScopedMemoriesRepository(userId, baseRepos.memories, characters);
  const projects = new UserScopedProjectsRepository(userId, baseRepos.projects);
  const groups = new UserScopedGroupsRepository(userId, baseRepos.groups);
  const llmLogs = new UserScopedLLMLogsRepository(userId, baseRepos.llmLogs);

  const container: UserScopedRepositoryContainer = {
    userId,
    characters,
    chats,
    tags,
    connections,
    imageProfiles,
    embeddingProfiles,
    memories,
    files,
    images: files, // Alias for backwards compatibility
    projects,
    groups,
    groupCharacterMembers: baseRepos.groupCharacterMembers,
    groupDocMountLinks: baseRepos.groupDocMountLinks,
    llmLogs,
  };

  // Cache the container
  userRepoCache.set(userId, container);
  return container;
}

/**
 * Clear the user repository cache.
 * Useful for testing or when user data changes significantly.
 */
export function clearUserRepositoryCache(userId?: string): void {
  if (userId) {
    userRepoCache.delete(userId);
  } else {
    userRepoCache.clear();
  }
}

/**
 * Get a user-scoped repository container with migration safety check.
 * All operations through this container are automatically filtered to the specified user.
 * This function ensures migrations have completed before returning repositories.
 *
 * Use this in API routes and request handlers to ensure data integrity.
 *
 * @param userId The user ID to scope all operations to
 * @returns Promise<UserScopedRepositoryContainer> with all repositories scoped to the user
 *
 * @example
 * ```typescript
 * const repos = await getUserRepositoriesSafe(session.user.id);
 *
 * // All operations are automatically scoped to the user
 * const characters = await repos.characters.findAll();
 * ```
 */
export async function getUserRepositoriesSafe(userId: string): Promise<UserScopedRepositoryContainer> {
  if (!userId) {
    throw new Error('userId is required for getUserRepositoriesSafe');
  }

  // Ensure migrations are complete before proceeding
  await getRepositoriesSafe();

  // Now return the regular user repositories
  return getUserRepositories(userId);
}
