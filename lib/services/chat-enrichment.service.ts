/**
 * Chat Enrichment Service
 *
 * Consolidates duplicated enrichment functions from:
 * - app/api/chats/route.ts (getCharacterSummary, enrichParticipantSummary)
 * - app/api/chats/[id]/route.ts (getEnrichedCharacter, enrichParticipant)
 *
 * Provides unified enrichment for chat participants with options for different view modes.
 */

import type {
  ChatParticipantBase,
  ChatMetadata,
  Character,
  FileEntry,
  Project,
} from '@/lib/schemas/types'
import type { DocMountFileLinkWithContent } from '@/lib/schemas/mount-index.types'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import { getFilePath } from '@/lib/api/middleware/file-path'
import {
  resolveCharacterAvatar,
  buildMountFileUrl,
  buildLegacyFileUrl,
} from '@/lib/photos/resolve-character-avatar'
import { logger } from '@/lib/logger'

type Repos = RepositoryContainer

/**
 * Pre-loaded data for batched list enrichment. Populated once by
 * `enrichChatsForList` and threaded through the per-chat / per-participant
 * helpers so they skip per-row `findById` calls. Without this, 287 chats ×
 * N participants turned into ~500+ `characters.findById` calls, each of
 * which triggered the 8-query `applyDocumentStoreOverlay` block — a 4000+
 * query stall right after startup.
 */
export interface ChatListPreloaded {
  characters: Map<string, Character>
  files: Map<string, FileEntry>
  /**
   * Vault link ids resolved up front for character avatars and story
   * backgrounds. Post-Phase-3 `defaultImageId` / `storyBackgroundImageId`
   * carry `doc_mount_file_links.id`; we look them up alongside `files`
   * so the per-character enrichment hot path stays one map lookup.
   */
  docMountFileLinks: Map<string, DocMountFileLinkWithContent>
  projects: Map<string, Project>
  /** Memory counts per chatId (zero when absent). */
  memoryCounts: Map<string, number>
  /**
   * Conversation-chunk totals per chatId (absent when no chunks exist).
   * Used together with `chat.renderedMarkdown` to derive `scriptoriumStatus`.
   */
  conversationChunkCounts: Map<string, { total: number; embedded: number }>
}

// ============================================================================
// Types
// ============================================================================

/**
 * Image info for enriched entities
 */
export interface EnrichedImage {
  id: string
  filepath: string
  url: string | null
}

/**
 * Base character info shared between summary and detailed views
 */
export interface EnrichedCharacterBase {
  id: string
  name: string
  title: string | null
  avatarUrl: string | null
  defaultImageId: string | null
  defaultImage: EnrichedImage | null
  talkativeness: number
}

/**
 * Named system prompt summary for detail view
 */
export interface EnrichedCharacterSystemPrompt {
  id: string
  name: string
  isDefault: boolean
}

/**
 * Character info for list/summary view (includes tags)
 */
export interface EnrichedCharacterSummary extends EnrichedCharacterBase {
  tags: string[]
}

/**
 * Character info for detail view (no tags, used with full participant).
 * Includes the character's named system prompts so per-participant overrides
 * can be chosen from the sidebar.
 */
export interface EnrichedCharacterDetail extends EnrichedCharacterBase {
  systemPrompts: EnrichedCharacterSystemPrompt[]
  /** Archive tombstone timestamp — participant chips badge archived seats
   *  (character-archive spec §5.2). Mirrors the enrichment in
   *  `app/api/v1/chats/[id]/helpers.ts`. */
  archivedAt: string | null
}


/**
 * Connection profile info for detailed participant view
 */
export interface EnrichedConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
  /** Whether this profile permits tool use — surfaced so the tool-settings
   *  dialog can warn that per-chat tool toggles are moot when it's false. */
  allowToolUse: boolean
  apiKey: {
    id: string
    provider: string
    label: string
  } | null
}

/**
 * Image profile info for detailed participant view
 */
export interface EnrichedImageProfile {
  id: string
  name: string
  provider: string
  modelName: string
}

/**
 * Participant info for list/summary view (simpler, for chat lists)
 */
export interface EnrichedParticipantSummary {
  id: string
  type: 'CHARACTER'
  displayOrder: number
  isActive: boolean
  status: string
  removedAt?: string | null
  character: EnrichedCharacterSummary | null
}

/**
 * Participant info for detail view (fuller, for single chat view)
 */
export interface EnrichedParticipantDetail {
  id: string
  type: 'CHARACTER'
  controlledBy: 'llm' | 'user'
  displayOrder: number
  isActive: boolean
  status: string
  removedAt?: string | null
  character: EnrichedCharacterDetail | null
  connectionProfile: EnrichedConnectionProfile | null
  imageProfile: EnrichedImageProfile | null
  selectedSystemPromptId: string | null
  /** Per-chat talkativeness override (0.1–1.0). Null/undefined → inherit from character. */
  talkativeness?: number | null
  createdAt: string
  updatedAt: string
}

/**
 * Tag info for enriched chats
 */
export interface EnrichedTag {
  tag: {
    id: string
    name: string
  }
}

/**
 * Project info for enriched chats
 */
export interface EnrichedProject {
  id: string
  name: string
  color: string | null
}

/**
 * Story background info for enriched chats
 */
export interface EnrichedStoryBackground {
  id: string
  filepath: string
}

/**
 * Enriched chat for list view
 */
export interface EnrichedChatSummary {
  id: string
  title: string
  contextSummary: string | null
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
  participants: EnrichedParticipantSummary[]
  tags: EnrichedTag[]
  project: EnrichedProject | null
  storyBackground: EnrichedStoryBackground | null
  isDangerousChat: boolean
  conciergeOverride: 'OFF' | null
  chatType: 'salon' | 'help' | 'autonomous' | 'brahma'
  /** Scriptorium rendering status, derived from renderedMarkdown + chunk embeddings. */
  scriptoriumStatus: 'none' | 'rendered' | 'embedded'
  _count: { messages: number; memories: number }
  _allTagIds: string[] // Internal field for filtering
}

// ============================================================================
// Character Enrichment
// ============================================================================

/**
 * Get enriched character info for list/summary view (includes tags).
 *
 * When `preloaded` is supplied, both the character and its defaultImage are
 * read from the pre-fetched maps instead of hitting the repository — this is
 * the batched list path. Without `preloaded`, falls back to per-row lookups
 * for the single-character callers.
 */
export async function getCharacterSummary(
  characterId: string,
  repos: Repos,
  preloaded?: ChatListPreloaded,
): Promise<EnrichedCharacterSummary | null> {
  const character = preloaded
    ? preloaded.characters.get(characterId) ?? null
    : await repos.characters.findById(characterId)
  if (!character) {
    return null
  }

  let defaultImage: EnrichedImage | null = null
  if (character.defaultImageId) {
    if (preloaded) {
      const link = preloaded.docMountFileLinks.get(character.defaultImageId)
      if (link) {
        defaultImage = {
          id: character.defaultImageId,
          filepath: buildMountFileUrl(link.mountPointId, link.relativePath),
          url: null,
        }
      } else {
        const fileEntry = preloaded.files.get(character.defaultImageId) ?? null
        if (fileEntry) {
          defaultImage = { id: fileEntry.id, filepath: buildLegacyFileUrl(fileEntry.id), url: null }
        }
      }
    } else {
      const resolved = await resolveCharacterAvatar(character.defaultImageId, repos)
      if (resolved) {
        defaultImage = { id: resolved.id, filepath: resolved.url, url: null }
      }
    }
  }

  const avatarUrl: string | null = defaultImage ? defaultImage.filepath : null

  return {
    id: character.id,
    name: character.name,
    title: character.title ?? null,
    avatarUrl,
    defaultImageId: character.defaultImageId ?? null,
    defaultImage,
    talkativeness: character.talkativeness ?? 0.5,
    tags: character.tags || [],
  }
}

/**
 * Get enriched character info for detail view (no tags)
 * @param chatId Optional - if provided, checks avatarOverrides for chat-specific avatar
 */
export async function getCharacterDetail(
  characterId: string,
  repos: Repos,
  chatId?: string,
): Promise<EnrichedCharacterDetail | null> {
  const character = await repos.characters.findById(characterId)
  if (!character) {

    return null
  }

  const systemPrompts: EnrichedCharacterSystemPrompt[] = (character.systemPrompts || []).map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault ?? false,
  }))

  // Check for chat-specific avatar override (from wardrobe avatar generation)
  if (chatId && character.avatarOverrides?.length) {
    const override = character.avatarOverrides.find(o => o.chatId === chatId)
    if (override) {
      const resolved = await resolveCharacterAvatar(override.imageId, repos)
      if (resolved) {
        const overrideImage: EnrichedImage = { id: resolved.id, filepath: resolved.url, url: null }
        return {
          id: character.id,
          name: character.name,
          title: character.title ?? null,
          avatarUrl: resolved.url,
          defaultImageId: override.imageId,
          defaultImage: overrideImage,
          talkativeness: character.talkativeness ?? 0.5,
          systemPrompts,
          archivedAt: character.archivedAt ?? null,
        }
      }
    }
  }

  let defaultImage: EnrichedImage | null = null
  if (character.defaultImageId) {
    const resolved = await resolveCharacterAvatar(character.defaultImageId, repos)
    if (resolved) {
      defaultImage = { id: resolved.id, filepath: resolved.url, url: null }
    }
  }

  // Build avatar URL from defaultImage; the avatarUrl column has been retired.
  const avatarUrl: string | null = defaultImage ? defaultImage.filepath : null

  return {
    id: character.id,
    name: character.name,
    title: character.title ?? null,
    avatarUrl,
    defaultImageId: character.defaultImageId ?? null,
    defaultImage,
    talkativeness: character.talkativeness ?? 0.5,
    systemPrompts,
    // Bug 66: the chat GET renders the sidebar, so the archive badge needs
    // this projection here too — not only in the participants/PUT enrichment.
    archivedAt: character.archivedAt ?? null,
  }
}


// ============================================================================
// Profile Enrichment (for detail view)
// ============================================================================

/**
 * Get enriched connection profile info
 */
export async function getConnectionProfile(
  profileId: string,
  repos: Repos
): Promise<EnrichedConnectionProfile | null> {
  const profile = await repos.connections.findById(profileId)
  if (!profile) {

    return null
  }

  let apiKeyInfo: EnrichedConnectionProfile['apiKey'] = null
  if (profile.apiKeyId) {
    const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId)
    if (apiKey) {
      apiKeyInfo = { id: apiKey.id, provider: apiKey.provider, label: apiKey.label }
    }
  }

  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    allowToolUse: profile.allowToolUse ?? true,
    apiKey: apiKeyInfo,
  }
}

/**
 * Get enriched image profile info
 */
export async function getImageProfile(
  profileId: string,
  repos: Repos
): Promise<EnrichedImageProfile | null> {
  const imgProfile = await repos.imageProfiles.findById(profileId)
  if (!imgProfile) {

    return null
  }

  return {
    id: imgProfile.id,
    name: imgProfile.name,
    provider: imgProfile.provider,
    modelName: imgProfile.modelName,
  }
}

// ============================================================================
// Participant Enrichment
// ============================================================================

/**
 * Enrich participant for list/summary view (simpler output)
 */
export async function enrichParticipantSummary(
  participant: ChatParticipantBase,
  repos: Repos,
  preloaded?: ChatListPreloaded,
): Promise<EnrichedParticipantSummary> {
  const character = participant.type === 'CHARACTER' && participant.characterId
    ? await getCharacterSummary(participant.characterId, repos, preloaded)
    : null

  return {
    id: participant.id,
    type: participant.type,
    displayOrder: participant.displayOrder,
    isActive: participant.isActive,
    status: participant.status || 'active',
    removedAt: participant.removedAt ?? null,
    character,
  }
}

/**
 * Enrich participant for detail view (fuller output with profiles)
 */
export async function enrichParticipantDetail(
  participant: ChatParticipantBase,
  repos: Repos,
  chatId?: string,
): Promise<EnrichedParticipantDetail> {
  const character = participant.type === 'CHARACTER' && participant.characterId
    ? await getCharacterDetail(participant.characterId, repos, chatId)
    : null

  const connectionProfile = participant.connectionProfileId
    ? await getConnectionProfile(participant.connectionProfileId, repos)
    : null

  const imageProfile = participant.imageProfileId
    ? await getImageProfile(participant.imageProfileId, repos)
    : null

  return {
    id: participant.id,
    type: participant.type,
    controlledBy: participant.controlledBy || 'llm',
    displayOrder: participant.displayOrder,
    isActive: participant.isActive,
    status: participant.status || 'active',
    removedAt: participant.removedAt ?? null,
    character,
    connectionProfile,
    imageProfile,
    selectedSystemPromptId: participant.selectedSystemPromptId ?? null,
    talkativeness: participant.talkativeness ?? null,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
  }
}

// ============================================================================
// Tag Enrichment
// ============================================================================

/**
 * Enrich tag IDs to full tag objects (batched)
 * Uses a single query to fetch all tags for efficiency.
 */
export async function enrichTags(
  tagIds: string[],
  repos: Repos
): Promise<EnrichedTag[]> {
  if (tagIds.length === 0) {
    return []
  }

  // Use batched query instead of N+1 individual queries
  const tags = await repos.tags.findByIds(tagIds)

  // Map to enriched format, preserving order from input tagIds
  const tagMap = new Map(tags.map(tag => [tag.id, tag]))
  const enriched: EnrichedTag[] = []

  for (const tagId of tagIds) {
    const tag = tagMap.get(tagId)
    if (tag) {
      enriched.push({ tag: { id: tag.id, name: tag.name } })
    }
  }

  return enriched
}

// ============================================================================
// Chat Enrichment
// ============================================================================

/**
 * Enrich a chat with participants for list/summary view
 */
export async function enrichChatForList(
  chat: ChatMetadata,
  repos: Repos,
  preloaded?: ChatListPreloaded,
): Promise<EnrichedChatSummary> {
  const participants = await Promise.all(
    chat.participants.map(p => enrichParticipantSummary(p, repos, preloaded))
  )

  const tags = await enrichTags(chat.tags, repos)

  const messageCount = await repos.chats.getMessageCount(chat.id)

  let project: EnrichedProject | null = null
  if (chat.projectId) {
    const projectData = preloaded
      ? preloaded.projects.get(chat.projectId) ?? null
      : await repos.projects.findById(chat.projectId)
    if (projectData) {
      project = {
        id: projectData.id,
        name: projectData.name,
        color: projectData.color ?? null,
      }
    }
  }

  let storyBackground: EnrichedStoryBackground | null = null
  if (chat.storyBackgroundImageId) {
    const bgFile = preloaded
      ? preloaded.files.get(chat.storyBackgroundImageId) ?? null
      : await repos.files.findById(chat.storyBackgroundImageId)
    if (bgFile) {
      storyBackground = {
        id: bgFile.id,
        filepath: getFilePath(bgFile),
      }
    }
  }

  // Collect all tag IDs from chat and characters for filtering
  const allTagIds: string[] = [...chat.tags]
  for (const participant of participants) {
    if (participant.character?.tags) {
      allTagIds.push(...participant.character.tags)
    }
  }

  // Memory + Scriptorium status. Prefer bulk-preloaded values; fall back to
  // per-chat reads when the single-chat path calls in without preload.
  const memoryCount = preloaded
    ? preloaded.memoryCounts.get(chat.id) ?? 0
    : await repos.memories.countByChatId(chat.id)

  const hasRenderedMarkdown = !!chat.renderedMarkdown
  let chunkStats: { total: number; embedded: number } | undefined
  if (preloaded) {
    chunkStats = preloaded.conversationChunkCounts.get(chat.id)
  } else if (hasRenderedMarkdown) {
    const chunks = await repos.conversationChunks.findByChatId(chat.id)
    chunkStats = {
      total: chunks.length,
      embedded: chunks.filter((c) => c.embedding !== null && c.embedding !== undefined).length,
    }
  }
  const scriptoriumStatus: 'none' | 'rendered' | 'embedded' = hasRenderedMarkdown
    ? chunkStats && chunkStats.total > 0 && chunkStats.embedded >= chunkStats.total
      ? 'embedded'
      : 'rendered'
    : 'none'

  return {
    id: chat.id,
    title: chat.title,
    contextSummary: chat.contextSummary ?? null,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    lastMessageAt: chat.lastMessageAt ?? null,
    participants,
    tags,
    project,
    storyBackground,
    isDangerousChat: chat.isDangerousChat === true,
    conciergeOverride: chat.conciergeOverride ?? null,
    chatType: (chat.chatType ?? 'salon') as 'salon' | 'help' | 'autonomous' | 'brahma',
    scriptoriumStatus,
    _count: { messages: messageCount, memories: memoryCount },
    _allTagIds: allTagIds,
  }
}

/**
 * Enrich multiple chats for list view with sorting.
 *
 * Batches the cross-chat lookups (characters, their default images, chat
 * projects, chat story-background images) into three queries — one per
 * repository — before fanning out the per-chat enrichment. On instances with
 * hundreds of chats referencing the same one or two characters, this replaces
 * the old N+1 pattern where every participant triggered its own
 * `characters.findById` → `applyDocumentStoreOverlay` block.
 */
export async function enrichChatsForList(
  chats: ChatMetadata[],
  repos: Repos
): Promise<EnrichedChatSummary[]> {
  const sortedChats = [...chats].sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : new Date(a.updatedAt).getTime()
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : new Date(b.updatedAt).getTime()
    return bTime - aTime
  })

  const characterIds = new Set<string>()
  const projectIds = new Set<string>()
  const fileIds = new Set<string>()
  for (const chat of sortedChats) {
    if (chat.projectId) projectIds.add(chat.projectId)
    if (chat.storyBackgroundImageId) fileIds.add(chat.storyBackgroundImageId)
    for (const p of chat.participants) {
      if (p.type === 'CHARACTER' && p.characterId) characterIds.add(p.characterId)
    }
  }

  const characters = characterIds.size > 0
    ? await repos.characters.findByIds(Array.from(characterIds))
    : []
  const charactersMap = new Map(characters.map(c => [c.id, c]))

  // Story backgrounds still resolve through the legacy files table (they
  // live in the Lantern Backgrounds mount but `chat.storyBackgroundImageId`
  // continues to point at a `files` row by design).
  const characterAvatarIds = new Set<string>()
  for (const character of characters) {
    if (character.defaultImageId) characterAvatarIds.add(character.defaultImageId)
  }

  const chatIds = sortedChats.map((c) => c.id)
  // Restrict the chunk-count query to chats that actually have rendered
  // markdown — every other chat is unambiguously 'none' and querying for it
  // is wasted work. Memory counts run over every chat ID since a chat can
  // accrue memories without ever being rendered.
  const renderedChatIds = sortedChats
    .filter((c) => !!c.renderedMarkdown)
    .map((c) => c.id)

  const [files, links, projects, memoryCounts, conversationChunkCounts] = await Promise.all([
    fileIds.size > 0 ? repos.files.findByIds(Array.from(fileIds)) : Promise.resolve([] as FileEntry[]),
    characterAvatarIds.size > 0
      ? repos.docMountFileLinks.findByIdsWithContent(Array.from(characterAvatarIds))
      : Promise.resolve([] as DocMountFileLinkWithContent[]),
    projectIds.size > 0 ? repos.projects.findByIds(Array.from(projectIds)) : Promise.resolve([] as Project[]),
    chatIds.length > 0
      ? repos.memories.countByChatIds(chatIds)
      : Promise.resolve(new Map<string, number>()),
    renderedChatIds.length > 0
      ? repos.conversationChunks.countByChatIds(renderedChatIds)
      : Promise.resolve(new Map<string, { total: number; embedded: number }>()),
  ])

  const preloaded: ChatListPreloaded = {
    characters: charactersMap,
    files: new Map(files.map(f => [f.id, f])),
    docMountFileLinks: new Map(links.map(l => [l.id, l])),
    projects: new Map(projects.map(p => [p.id, p])),
    memoryCounts,
    conversationChunkCounts,
  }

  return Promise.all(sortedChats.map(chat => enrichChatForList(chat, repos, preloaded)))
}

/**
 * Filter enriched chats by excluded tag IDs
 */
export function filterChatsByExcludedTags(
  chats: EnrichedChatSummary[],
  excludeTagIds: string[]
): EnrichedChatSummary[] {
  if (excludeTagIds.length === 0) {
    return chats
  }

  const excludeSet = new Set(excludeTagIds)
  return chats.filter(chat => {
    const hasExcludedTag = chat._allTagIds.some(tagId => excludeSet.has(tagId))
    return !hasExcludedTag
  })
}

/**
 * Remove internal fields from enriched chats before returning
 */
export function cleanEnrichedChats<T extends EnrichedChatSummary>(
  chats: T[]
): Omit<T, '_allTagIds'>[] {
  return chats.map(({ _allTagIds, ...chat }) => chat)
}
