/**
 * SillyTavern Import Service
 *
 * Handles importing of SillyTavern chat format files.
 * Extracted from app/api/chats/import/route.ts for reusability.
 */

import { importSTChat, type STChat } from '@/lib/sillytavern/chat'
import { logger } from '@/lib/logger'
import { generateContextSummaryAsync } from '@/lib/chat/context-summary'
import { enqueueMemoryExtractionBatch, ensureProcessorRunning } from '@/lib/background-jobs'
import type { ChatParticipantBase, Character } from '@/lib/schemas/types'
import type { SpeakerMapping } from '@/lib/sillytavern/multi-char-parser'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import { enrichWithDefaultImage } from '@/lib/api/middleware/enrichment'

const importLogger = logger.child({ module: 'sillytavern-import' })

// ============================================================================
// Types
// ============================================================================

/**
 * Options for multi-character import
 */
export interface MultiCharacterImportOptions {
  chatData: STChat
  mappings: SpeakerMapping[]
  defaultConnectionProfileId: string
  triggerTitleGeneration?: boolean
  createMemories?: boolean
  title?: string
}

/**
 * Options for legacy single-character import
 */
export interface LegacyImportOptions {
  chatData: STChat
  characterId: string
  connectionProfileId: string
  title?: string
}

/**
 * Result of import operation
 */
export interface ImportResult {
  chat: ChatMetadataWithMessages
  createdEntities?: {
    characters: Character[]
  }
  memoryJobCount?: number
}

/**
 * Chat with messages and enriched data
 */
interface ChatMetadataWithMessages {
  id: string
  userId: string
  title: string
  participants: EnrichedParticipant[]
  tags: TagData[]
  messages: MessageData[]
  sillyTavernMetadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  _count: { messages: number }
}

interface EnrichedParticipant extends ChatParticipantBase {
  character: (Character & { defaultImage: DefaultImageData | null }) | null
}

interface DefaultImageData {
  id: string
  filepath: string
  url: string | null
}

interface TagData {
  chatId: string
  tagId: string
  tag: {
    id: string
    name: string
    nameLower: string
    userId: string
    createdAt: string
    updatedAt: string
  }
}

interface MessageData {
  id: string
  chatId: string
  role: string
  content: string
  createdAt: string
  updatedAt: string
  swipeGroupId: string | null
  swipeIndex: number | null
  tokenCount: number | null
  rawResponse: Record<string, unknown> | null
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper to parse send_date which can be either a timestamp or a string
 */
export function parseSendDate(sendDate: number | string): Date {
  if (typeof sendDate === 'number') {
    return new Date(sendDate)
  }

  let parsed = new Date(sendDate)

  if (Number.isNaN(parsed.getTime())) {
    const normalized = sendDate
      .replace(/(\d+)(?:st|nd|rd|th)/, '$1')
      .replace(/(\d{1,2}):(\d{2})(am|pm)/i, (match, hours, mins, ampm) => {
        let h = Number.parseInt(hours)
        if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12
        if (ampm.toLowerCase() === 'am' && h === 12) h = 0
        return `${h.toString().padStart(2, '0')}:${mins}`
      })

    parsed = new Date(normalized)
  }

  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

// ============================================================================
// Multi-Character Import
// ============================================================================

/**
 * Import a SillyTavern chat with multi-character speaker mappings
 */
export async function importMultiCharacterChat(
  userId: string,
  options: MultiCharacterImportOptions,
  repos: RepositoryContainer
): Promise<ImportResult> {
  const {
    chatData,
    mappings,
    defaultConnectionProfileId,
    triggerTitleGeneration,
    createMemories,
    title,
  } = options

  importLogger.info('Multi-character import starting', {
    userId,
    mappingCount: mappings.length,
    messageCount: chatData.messages.length,
  })

  // Build speaker name -> entity mapping
  const speakerToEntity = new Map<
    string,
    {
      entityId: string
      connectionProfileId?: string
    }
  >()

  const createdEntities: { characters: Character[] } = {
    characters: [],
  }

  const tagIds = new Set<string>()
  const now = new Date().toISOString()
  const participants: ChatParticipantBase[] = []
  let displayOrder = 0

  // Process each mapping
  for (const mapping of mappings) {
    if (mapping.mappingType === 'skip') {

      continue
    }

    let entityId: string
    let connectionProfileId: string | undefined
    const controlledBy = mapping.controlledBy || 'llm'

    if (mapping.mappingType === 'existing_character') {
      const character = await repos.characters.findById(mapping.entityId!)
      if (!character || character.userId !== userId) {
        throw new Error(`Character not found: ${mapping.entityName}`)
      }
      entityId = character.id
      // Only set connection profile for LLM-controlled characters
      if (controlledBy === 'llm') {
        connectionProfileId = mapping.connectionProfileId || defaultConnectionProfileId
      }

      if (character.tags) {
        for (const tagId of character.tags) {
          tagIds.add(tagId)
        }
      }

    } else if (mapping.mappingType === 'create_character') {
      const character = await repos.characters.create({
        userId,
        name: mapping.entityName || mapping.speakerName,
        title: null,
        description: 'Character created during chat import',
        personality: null,
        firstMessage: null,
        exampleDialogues: null,
        defaultConnectionProfileId:
          controlledBy === 'llm' ? (mapping.connectionProfileId || defaultConnectionProfileId) : null,
        isFavorite: false,
        tags: [] as string[],
        partnerLinks: [] as { partnerId: string; isDefault: boolean }[],
        avatarOverrides: [] as { chatId: string; imageId: string }[],
        defaultImageId: null,
        physicalDescription: null,
      })
      entityId = character.id
      if (controlledBy === 'llm') {
        connectionProfileId = mapping.connectionProfileId || defaultConnectionProfileId
      }
      createdEntities.characters.push(character)

      importLogger.info('Created character', {
        characterId: character.id,
        name: character.name,
        controlledBy,
      })
    } else if (mapping.mappingType === 'existing_persona') {
      // Legacy: persona mappings should be treated as user-controlled characters
      const character = await repos.characters.findById(mapping.entityId!)
      if (!character || character.userId !== userId) {
        throw new Error(`Character (from persona import) not found: ${mapping.entityName}`)
      }
      entityId = character.id
      // Personas are always user-controlled, so no connection profile needed

      if (character.tags) {
        for (const tagId of character.tags) {
          tagIds.add(tagId)
        }
      }

    } else if (mapping.mappingType === 'create_persona') {
      // Legacy: create a user-controlled character instead of persona
      const character = await repos.characters.create({
        userId,
        name: mapping.entityName || mapping.speakerName,
        title: null,
        description: 'User character created during chat import',
        personality: null,
        firstMessage: null,
        exampleDialogues: null,
        defaultConnectionProfileId: null, // User-controlled characters don't need a connection profile
        isFavorite: false,
        tags: [] as string[],
        partnerLinks: [] as { partnerId: string; isDefault: boolean }[],
        avatarOverrides: [] as { chatId: string; imageId: string }[],
        defaultImageId: null,
        physicalDescription: null,
      })
      entityId = character.id
      createdEntities.characters.push(character)

      importLogger.info('Created user-controlled character (legacy persona)', {
        characterId: character.id,
        name: character.name,
        controlledBy: 'user',
      })
    } else {
      continue
    }

    speakerToEntity.set(mapping.speakerName, {
      entityId,
      connectionProfileId,
    })

    participants.push({
      id: crypto.randomUUID(),
      type: 'CHARACTER',
      characterId: entityId,
      controlledBy,
      connectionProfileId: controlledBy === 'llm' ? (connectionProfileId || null) : null,
      imageProfileId: null,
      displayOrder: displayOrder++,
      isActive: true,
      status: 'active' as const,
      hasHistoryAccess: false,
      joinScenario: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  // Verify we have at least one LLM-controlled character
  const hasLLMCharacter = participants.some(p => p.type === 'CHARACTER' && p.controlledBy === 'llm')
  if (!hasLLMCharacter) {
    throw new Error('At least one AI-controlled character must be mapped')
  }

  // Verify default connection profile
  const defaultProfile = await repos.connections.findById(defaultConnectionProfileId)
  if (!defaultProfile || defaultProfile.userId !== userId) {
    throw new Error('Default connection profile not found')
  }

  if (defaultProfile.tags) {
    for (const tagId of defaultProfile.tags) {
      tagIds.add(tagId)
    }
  }

  // Get chat metadata
  const chatMetadata = chatData.chat_metadata || {}
  const characterName = chatData.character_name

  const chatTitle =
    title || (characterName ? `Chat with ${characterName}` : null) || 'Imported Chat'

  // Create chat
  const chat = await repos.chats.create({
    userId,
    participants,
    title: chatTitle,
    sillyTavernMetadata: chatMetadata,
    tags: Array.from(tagIds),
    messageCount: 0,
    lastRenameCheckInterchange: 0,
  })

  importLogger.info('Created chat', {
    chatId: chat.id,
    title: chatTitle,
    participantCount: participants.length,
  })

  // Process messages
  const messages = chatData.messages
  let messageCount = 0
  let skippedCount = 0

  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index]
    const speakerName = msg.name

    const entityInfo = speakerToEntity.get(speakerName)
    if (!entityInfo) {
      skippedCount++
      continue
    }

    const role = msg.is_user === true ? 'USER' : 'ASSISTANT'
    const hasSwipes = msg.swipes && msg.swipes.length > 1
    const swipeGroupId = hasSwipes ? `swipe-${index}` : null

    if (hasSwipes) {
      for (let swipeIdx = 0; swipeIdx < msg.swipes!.length; swipeIdx++) {
        const swipeContent = msg.swipes![swipeIdx]
        if (!swipeContent && swipeContent !== '') continue

        await repos.chats.addMessage(chat.id, {
          id: crypto.randomUUID(),
          type: 'message',
          role,
          content: swipeContent,
          swipeGroupId,
          swipeIndex: swipeIdx,
          rawResponse: {
            speakerName,
            ...msg.extra,
            swipe_info: msg.swipe_info?.[swipeIdx],
          },
          attachments: [],
          createdAt: parseSendDate(msg.send_date).toISOString(),
        })
        messageCount++
      }
    } else {
      await repos.chats.addMessage(chat.id, {
        id: crypto.randomUUID(),
        type: 'message',
        role,
        content: msg.mes || '',
        swipeGroupId: null,
        swipeIndex: null,
        rawResponse: {
          speakerName,
          ...msg.extra,
        },
        attachments: [],
        createdAt: parseSendDate(msg.send_date).toISOString(),
      })
      messageCount++
    }
  }

  // Update message count
  await repos.chats.update(chat.id, {
    messageCount,
    updatedAt: now,
  })

  importLogger.info('Imported messages', {
    chatId: chat.id,
    messageCount,
    skippedCount,
  })

  // Trigger title generation if requested
  if (triggerTitleGeneration) {
    await triggerTitleGenerationAsync(userId, chat.id, participants, repos)
  }

  // Queue memory extraction jobs if requested
  let memoryJobCount = 0
  if (createMemories) {
    memoryJobCount = await queueMemoryExtractionJobs(
      userId,
      chat.id,
      participants,
      repos
    )
  }

  // Build response
  const result = await buildImportResponse(
    chat,
    participants,
    repos,
    createdEntities,
    triggerTitleGeneration,
    memoryJobCount
  )

  return result
}

// ============================================================================
// Legacy Single-Character Import
// ============================================================================

/**
 * Import a SillyTavern chat with single character (legacy mode)
 */
export async function importLegacyChat(
  userId: string,
  options: LegacyImportOptions,
  repos: RepositoryContainer
): Promise<ImportResult> {
  const { chatData, characterId, connectionProfileId, title } = options

  importLogger.info('Legacy single-character import starting', {
    userId,
    characterId,
    connectionProfileId,
  })

  // Verify character belongs to user
  const character = await repos.characters.findById(characterId)
  if (!character || character.userId !== userId) {
    throw new Error('Character not found')
  }

  // Verify connection profile belongs to user
  const profile = await repos.connections.findById(connectionProfileId)
  if (!profile || profile.userId !== userId) {
    throw new Error('Connection profile not found')
  }

  // Import chat from SillyTavern format
  const importedData = importSTChat(chatData, characterId, userId)

  // Collect tags
  const tagIds = new Set<string>()
  if (character.tags) {
    for (const tagId of character.tags) {
      tagIds.add(tagId)
    }
  }
  if (profile.tags) {
    for (const tagId of profile.tags) {
      tagIds.add(tagId)
    }
  }

  // Build participants array
  const now = new Date().toISOString()
  const participants: ChatParticipantBase[] = []

  participants.push({
    id: crypto.randomUUID(),
    type: 'CHARACTER',
    characterId,
    controlledBy: 'llm',
    connectionProfileId,
    imageProfileId: null,
    displayOrder: 0,
    isActive: true,
    status: 'active' as const,
    hasHistoryAccess: false,
    joinScenario: null,
    createdAt: now,
    updatedAt: now,
  })

  // Create chat
  const chat = await repos.chats.create({
    userId,
    participants,
    title: title || `Chat with ${character.name}`,
    sillyTavernMetadata: importedData.metadata || null,
    tags: Array.from(tagIds),
    messageCount: importedData.messages.length,
    lastRenameCheckInterchange: 0,
  })

  importLogger.info('Created legacy chat', {
    chatId: chat.id,
    title: chat.title,
    participantCount: participants.length,
  })

  // Add messages
  for (const msg of importedData.messages) {
    await repos.chats.addMessage(chat.id, {
      id: crypto.randomUUID(),
      type: 'message',
      role: msg.role,
      content: msg.content,
      swipeGroupId: msg.swipeGroupId || null,
      swipeIndex: msg.swipeIndex || null,
      rawResponse: msg.rawResponse || null,
      attachments: [],
      createdAt: msg.createdAt.toISOString(),
    })
  }

  importLogger.info('Imported legacy chat messages', {
    chatId: chat.id,
    messageCount: importedData.messages.length,
  })

  // Build response
  const result = await buildLegacyImportResponse(
    chat,
    character,
    profile,
    repos
  )

  return result
}

// ============================================================================
// Helper Functions
// ============================================================================

async function triggerTitleGenerationAsync(
  userId: string,
  chatId: string,
  participants: ChatParticipantBase[],
  repos: RepositoryContainer
): Promise<void> {
  const firstCharacterParticipant = participants.find(
    p => p.type === 'CHARACTER' && p.connectionProfileId
  )
  if (!firstCharacterParticipant?.connectionProfileId) return

  const connectionProfile = await repos.connections.findById(
    firstCharacterParticipant.connectionProfileId
  )
  if (!connectionProfile) return

  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const cheapLLMSettings = chatSettings?.cheapLLMSettings || {
    strategy: 'PROVIDER_CHEAPEST' as const,
    userDefinedProfileId: null,
    defaultCheapProfileId: null,
    fallbackToLocal: true,
    allowCheapFallback: false,
    embeddingProvider: 'SAME_PROVIDER' as const,
  }

  const allProfiles = await repos.connections.findByUserId(userId)

  importLogger.info('Triggering title generation', { chatId })
  generateContextSummaryAsync({
    userId,
    chatId,
    connectionProfile,
    cheapLLMSettings,
    availableProfiles: allProfiles,
    forceRegenerate: true,
  })
}

async function queueMemoryExtractionJobs(
  userId: string,
  chatId: string,
  participants: ChatParticipantBase[],
  repos: RepositoryContainer
): Promise<number> {
  // Pull the connection-profile from any character participant so the
  // per-turn handler has a cheap-LLM target. The first character with a
  // configured profile is fine — every job uses the same profile.
  const profileSource = participants.find(
    p => p.type === 'CHARACTER' && p.characterId && p.connectionProfileId,
  )
  if (!profileSource?.connectionProfileId) {
    return 0
  }

  const allImportedMessages = await repos.chats.getMessages(chatId)
  const turnOpenerIds: string[] = []
  for (const m of allImportedMessages) {
    if (m.type !== 'message') continue
    if (m.role !== 'USER') continue
    if (m.systemSender) continue
    turnOpenerIds.push(m.id)
  }

  if (turnOpenerIds.length === 0) return 0

  importLogger.info('Queueing per-turn memory extraction jobs', {
    chatId,
    turnCount: turnOpenerIds.length,
  })

  const jobIds = await enqueueMemoryExtractionBatch(
    userId,
    chatId,
    profileSource.connectionProfileId,
    turnOpenerIds,
    { priority: 0 },
  )

  ensureProcessorRunning()
  return jobIds.length
}

async function buildImportResponse(
  chat: { id: string; userId: string; title: string; tags: string[]; sillyTavernMetadata?: Record<string, unknown> | null; createdAt: string; updatedAt: string },
  participants: ChatParticipantBase[],
  repos: RepositoryContainer,
  createdEntities: { characters: Character[] },
  triggerTitleGeneration?: boolean,
  memoryJobCount?: number
): Promise<ImportResult> {
  const allMessages = await repos.chats.getMessages(chat.id)
  const messageEvents = allMessages.filter(m => m.type === 'message')

  const allTags = await repos.tags.findAll()
  const chatTagsData = allTags
    .filter(tag => chat.tags.includes(tag.id))
    .map(tag => ({
      chatId: chat.id,
      tagId: tag.id,
      tag: {
        id: tag.id,
        name: tag.name,
        nameLower: tag.nameLower,
        userId: tag.userId,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
      },
    }))

  const enrichedParticipants = await Promise.all(
    participants.map(async p => {
      if (p.type === 'CHARACTER' && p.characterId) {
        const character = await repos.characters.findById(p.characterId)
        const defaultImage = await enrichWithDefaultImage(character?.defaultImageId, repos)
        return {
          ...p,
          character: character ? { ...character, defaultImage } : null,
        }
      }
      return { ...p, character: null }
    })
  )

  const completeChat: ChatMetadataWithMessages = {
    id: chat.id,
    userId: chat.userId,
    title: chat.title,
    participants: enrichedParticipants,
    tags: chatTagsData,
    messages: messageEvents.map(msg => ({
      id: msg.id,
      chatId: chat.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
      updatedAt: msg.createdAt,
      swipeGroupId: msg.swipeGroupId || null,
      swipeIndex: msg.swipeIndex || null,
      tokenCount: msg.tokenCount || null,
      rawResponse: msg.rawResponse || null,
    })),
    sillyTavernMetadata: chat.sillyTavernMetadata || null,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    _count: { messages: messageEvents.length },
  }

  return {
    chat: completeChat,
    createdEntities,
    memoryJobCount: memoryJobCount && memoryJobCount > 0 ? memoryJobCount : undefined,
  }
}

async function buildLegacyImportResponse(
  chat: { id: string; userId: string; title: string; tags: string[]; sillyTavernMetadata?: Record<string, unknown> | null; createdAt: string; updatedAt: string; participants: ChatParticipantBase[] },
  character: Character,
  profile: { id: string; name: string; provider: string; modelName: string },
  repos: RepositoryContainer
): Promise<ImportResult> {
  const messages = await repos.chats.getMessages(chat.id)
  const messageEvents = messages.filter(m => m.type === 'message')

  const defaultImage = await enrichWithDefaultImage(character.defaultImageId, repos)

  const allTags = await repos.tags.findAll()
  const chatTagsData = allTags
    .filter(tag => chat.tags.includes(tag.id))
    .map(tag => ({
      chatId: chat.id,
      tagId: tag.id,
      tag: {
        id: tag.id,
        name: tag.name,
        nameLower: tag.nameLower,
        userId: tag.userId,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
      },
    }))

  const enrichedParticipants: EnrichedParticipant[] = chat.participants.map(p => ({
    ...p,
    character: p.type === 'CHARACTER' ? { ...character, defaultImage } : null,
  }))

  const completeChat: ChatMetadataWithMessages = {
    id: chat.id,
    userId: chat.userId,
    title: chat.title,
    participants: enrichedParticipants,
    tags: chatTagsData,
    messages: messageEvents.map(msg => ({
      id: msg.id,
      chatId: chat.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
      updatedAt: msg.createdAt,
      swipeGroupId: msg.swipeGroupId || null,
      swipeIndex: msg.swipeIndex || null,
      tokenCount: msg.tokenCount || null,
      rawResponse: msg.rawResponse || null,
    })),
    sillyTavernMetadata: chat.sillyTavernMetadata || null,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    _count: { messages: messageEvents.length },
  }

  return { chat: completeChat }
}
