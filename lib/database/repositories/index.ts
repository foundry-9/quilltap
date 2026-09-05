/**
 * Database Repositories Index
 *
 * Central export point for all backend-agnostic repository classes.
 * These repositories work with SQLite through the
 * database abstraction layer.
 */

import { logger } from '@/lib/logger';

// Export base repository and types
export { AbstractBaseRepository, UserOwnedBaseRepository, TaggableBaseRepository } from './base.repository';
export type { CreateOptions, ValidationResult } from './base.repository';

// Export all repository classes
export { BackgroundJobsRepository, type QueueStats } from './background-jobs.repository';
export { CharactersRepository } from './characters.repository';
export { ChatsRepository } from './chats.repository';
export { ChatSettingsRepository } from './chat-settings.repository';
export { ConnectionProfilesRepository } from './connection-profiles.repository';
export { EmbeddingProfilesRepository } from './embedding-profiles.repository';
export { FilesRepository } from './files.repository';
export { FoldersRepository } from './folders.repository';
export { ImageProfilesRepository } from './image-profiles.repository';
export { LLMLogsRepository } from './llm-logs.repository';
export type {
  LLMLogTypeStatsRow,
  LLMLogProfileStatsRow,
  LLMLogCacheStatsRow,
} from './llm-logs.repository';
export { MemoriesRepository } from './memories.repository';
export { PluginConfigRepository } from './plugin-config.repository';
export { ProjectsRepository } from './projects.repository';
export { GroupsRepository } from './groups.repository';
export { PromptTemplatesRepository } from './prompt-templates.repository';
export { ProviderModelsRepository } from './provider-models.repository';
export { RoleplayTemplatesRepository } from './roleplay-templates.repository';
export { TagsRepository } from './tags.repository';
export { UsersRepository } from './users.repository';
export { VectorIndicesRepository } from './vector-indices.repository';
export { TfidfVocabularyRepository } from './tfidf-vocabulary.repository';
export { EmbeddingStatusRepository } from './embedding-status.repository';
export { WardrobeRepository } from './wardrobe.repository';
export { CharacterPluginDataRepository } from './character-plugin-data.repository';
export { ConversationAnnotationsRepository } from './conversation-annotations.repository';
export { ConversationChunksRepository } from './conversation-chunks.repository';
export { HelpDocsRepository } from './help-docs.repository';
export { HelpDocChunksRepository } from './help-doc-chunks.repository';
export { DocMountPointsRepository } from './doc-mount-points.repository';
export { DocMountFilesRepository } from './doc-mount-files.repository';
export { DocMountFileLinksRepository } from './doc-mount-file-links.repository';
export { DocMountFoldersRepository } from './doc-mount-folders.repository';
export { DocMountChunksRepository } from './doc-mount-chunks.repository';
export { DocMountDocumentsRepository } from './doc-mount-documents.repository';
export { DocMountBlobsRepository } from './doc-mount-blobs.repository';
export { ProjectDocMountLinksRepository } from './project-doc-mount-links.repository';
export { GroupDocMountLinksRepository } from './group-doc-mount-links.repository';
export { GroupCharacterMembersRepository } from './group-character-members.repository';
export { ChatDocumentsRepository } from './chat-documents.repository';
export { TerminalSessionsRepository } from './terminal-sessions.repository';
export { TextReplacementRulesRepository, TextReplacementRuleConflictError } from './text-replacement-rules.repository';

// Import all repository classes for container
import { BackgroundJobsRepository } from './background-jobs.repository';
import { CharactersRepository } from './characters.repository';
import { ChatsRepository } from './chats.repository';
import { ChatSettingsRepository } from './chat-settings.repository';
import { ConnectionProfilesRepository } from './connection-profiles.repository';
import { EmbeddingProfilesRepository } from './embedding-profiles.repository';
import { FilesRepository } from './files.repository';
import { FoldersRepository } from './folders.repository';
import { ImageProfilesRepository } from './image-profiles.repository';
import { LLMLogsRepository } from './llm-logs.repository';
import { MemoriesRepository } from './memories.repository';
import { PluginConfigRepository } from './plugin-config.repository';
import { ProjectsRepository } from './projects.repository';
import { GroupsRepository } from './groups.repository';
import { PromptTemplatesRepository } from './prompt-templates.repository';
import { ProviderModelsRepository } from './provider-models.repository';
import { RoleplayTemplatesRepository } from './roleplay-templates.repository';
import { TagsRepository } from './tags.repository';
import { UsersRepository } from './users.repository';
import { VectorIndicesRepository } from './vector-indices.repository';
import { TfidfVocabularyRepository } from './tfidf-vocabulary.repository';
import { EmbeddingStatusRepository } from './embedding-status.repository';
import { WardrobeRepository } from './wardrobe.repository';
import { CharacterPluginDataRepository } from './character-plugin-data.repository';
import { ConversationAnnotationsRepository } from './conversation-annotations.repository';
import { ConversationChunksRepository } from './conversation-chunks.repository';
import { HelpDocsRepository } from './help-docs.repository';
import { HelpDocChunksRepository } from './help-doc-chunks.repository';
import { DocMountPointsRepository } from './doc-mount-points.repository';
import { DocMountFilesRepository } from './doc-mount-files.repository';
import { DocMountFileLinksRepository } from './doc-mount-file-links.repository';
import { DocMountFoldersRepository } from './doc-mount-folders.repository';
import { DocMountChunksRepository } from './doc-mount-chunks.repository';
import { DocMountDocumentsRepository } from './doc-mount-documents.repository';
import { DocMountBlobsRepository } from './doc-mount-blobs.repository';
import { ProjectDocMountLinksRepository } from './project-doc-mount-links.repository';
import { GroupDocMountLinksRepository } from './group-doc-mount-links.repository';
import { GroupCharacterMembersRepository } from './group-character-members.repository';
import { ChatDocumentsRepository } from './chat-documents.repository';
import { TerminalSessionsRepository } from './terminal-sessions.repository';
import { TextReplacementRulesRepository } from './text-replacement-rules.repository';

/**
 * Container interface for all repository instances.
 * Provides type-safe access to repositories throughout the application.
 */
export interface RepositoryContainer {
  backgroundJobs: BackgroundJobsRepository;
  characters: CharactersRepository;
  chats: ChatsRepository;
  chatSettings: ChatSettingsRepository;
  connections: ConnectionProfilesRepository;
  embeddingProfiles: EmbeddingProfilesRepository;
  files: FilesRepository;
  folders: FoldersRepository;
  imageProfiles: ImageProfilesRepository;
  images: FilesRepository; // Alias for backwards compatibility
  llmLogs: LLMLogsRepository;
  memories: MemoriesRepository;
  pluginConfigs: PluginConfigRepository;
  projects: ProjectsRepository;
  groups: GroupsRepository;
  promptTemplates: PromptTemplatesRepository;
  providerModels: ProviderModelsRepository;
  roleplayTemplates: RoleplayTemplatesRepository;
  tags: TagsRepository;
  users: UsersRepository;
  vectorIndices: VectorIndicesRepository;
  tfidfVocabularies: TfidfVocabularyRepository;
  embeddingStatus: EmbeddingStatusRepository;
  wardrobe: WardrobeRepository;
  characterPluginData: CharacterPluginDataRepository;
  conversationAnnotations: ConversationAnnotationsRepository;
  conversationChunks: ConversationChunksRepository;
  helpDocs: HelpDocsRepository;
  helpDocChunks: HelpDocChunksRepository;
  docMountPoints: DocMountPointsRepository;
  docMountFiles: DocMountFilesRepository;
  docMountFileLinks: DocMountFileLinksRepository;
  docMountFolders: DocMountFoldersRepository;
  docMountChunks: DocMountChunksRepository;
  docMountDocuments: DocMountDocumentsRepository;
  docMountBlobs: DocMountBlobsRepository;
  projectDocMountLinks: ProjectDocMountLinksRepository;
  groupDocMountLinks: GroupDocMountLinksRepository;
  groupCharacterMembers: GroupCharacterMembersRepository;
  chatDocuments: ChatDocumentsRepository;
  terminalSessions: TerminalSessionsRepository;
  textReplacementRules: TextReplacementRulesRepository;
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
  try {
    const filesRepo = new FilesRepository();

    const repositories: RepositoryContainer = {
      backgroundJobs: new BackgroundJobsRepository(),
      characters: new CharactersRepository(),
      chats: new ChatsRepository(),
      chatSettings: new ChatSettingsRepository(),
      connections: new ConnectionProfilesRepository(),
      embeddingProfiles: new EmbeddingProfilesRepository(),
      files: filesRepo,
      folders: new FoldersRepository(),
      imageProfiles: new ImageProfilesRepository(),
      images: filesRepo, // Alias for backwards compatibility
      llmLogs: new LLMLogsRepository(),
      memories: new MemoriesRepository(),
      pluginConfigs: new PluginConfigRepository(),
      projects: new ProjectsRepository(),
      groups: new GroupsRepository(),
      promptTemplates: new PromptTemplatesRepository(),
      providerModels: new ProviderModelsRepository(),
      roleplayTemplates: new RoleplayTemplatesRepository(),
      tags: new TagsRepository(),
      users: new UsersRepository(),
      vectorIndices: new VectorIndicesRepository(),
      tfidfVocabularies: new TfidfVocabularyRepository(),
      embeddingStatus: new EmbeddingStatusRepository(),
      wardrobe: new WardrobeRepository(),
      characterPluginData: new CharacterPluginDataRepository(),
      conversationAnnotations: new ConversationAnnotationsRepository(),
      conversationChunks: new ConversationChunksRepository(),
      helpDocs: new HelpDocsRepository(),
      helpDocChunks: new HelpDocChunksRepository(),
      docMountPoints: new DocMountPointsRepository(),
      docMountFiles: new DocMountFilesRepository(),
      docMountFileLinks: new DocMountFileLinksRepository(),
      docMountFolders: new DocMountFoldersRepository(),
      docMountChunks: new DocMountChunksRepository(),
      docMountDocuments: new DocMountDocumentsRepository(),
      docMountBlobs: new DocMountBlobsRepository(),
      projectDocMountLinks: new ProjectDocMountLinksRepository(),
      groupDocMountLinks: new GroupDocMountLinksRepository(),
      groupCharacterMembers: new GroupCharacterMembersRepository(),
      chatDocuments: new ChatDocumentsRepository(),
      terminalSessions: new TerminalSessionsRepository(),
      textReplacementRules: new TextReplacementRulesRepository(),
    };
    return repositories;
  } catch (error) {
    logger.error('Failed to create database repository container', {
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
    repositoryInstance = createRepositories();
  }

  return repositoryInstance;
}

/**
 * Reset the singleton repository instance.
 * Useful for testing to ensure a clean state between tests.
 *
 * @returns {void}
 */
export function resetRepositories(): void {
  repositoryInstance = null;
}
