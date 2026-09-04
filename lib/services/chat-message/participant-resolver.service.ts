/**
 * Participant Resolver Service
 *
 * Handles resolution of responding participants in chat messages,
 * including character lookup and connection profile resolution.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { resolveConnectionProfile } from '@/lib/chat/connection-resolver'
import {
  findActiveUserParticipant,
  isMultiCharacterChat,
  getActiveCharacterParticipants,
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  isUserDrivenSeat,
  getPresentCharacterSeats,
} from '@/lib/chat/turn-manager'
import type { getRepositories } from '@/lib/repositories/factory'
import type {
  ChatMetadataBase,
  ChatParticipantBase,
  Character,
  ConnectionProfile,
  MessageEvent,
} from '@/lib/schemas/types'
import { isParticipantPresent } from '@/lib/schemas/chat.types'
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository'

const logger = createServiceLogger('ParticipantResolverService')

/**
 * Result of participant resolution
 */
export interface ParticipantResolutionResult {
  /** The character participant who will respond */
  characterParticipant: ChatParticipantBase
  /** The character data */
  character: Character
  /** The connection profile to use */
  connectionProfile: ConnectionProfile
  /** Decrypted API key (or empty string for keyless providers) */
  apiKey: string
  /** Image profile ID if configured */
  imageProfileId: string | null
  /** The user participant (user-controlled character) */
  userParticipant: ChatParticipantBase | null
  /** User participant ID */
  userParticipantId: string | null
  /** Whether this is a multi-character chat */
  isMultiCharacter: boolean
}

/**
 * All participant data for multi-character chats
 */
export interface AllParticipantsData {
  /** Map of character IDs to Character data */
  participantCharacters: Map<string, Character>
}

/**
 * Resolve the responding participant for a chat message
 */
export async function resolveRespondingParticipant(
  repos: ReturnType<typeof getRepositories>,
  chat: ChatMetadataBase,
  userId: string,
  requestedRespondingParticipantId?: string,
  isContinueMode: boolean = false,
  activeUserParticipantId?: string | null
): Promise<ParticipantResolutionResult> {

  // Get user participant (user-controlled character) for turn management.
  // Honor the human's "Speaking As" selection so typed messages are attributed
  // to the chosen character, not merely the first user-controlled participant.
  const userParticipant = findActiveUserParticipant(
    chat.participants,
    activeUserParticipantId,
    chat.impersonatingParticipantIds,
  )
  const userParticipantId = userParticipant?.id ?? null

  // Get character participant - use specified participant for continue mode, otherwise first active character
  const presentSeats = getPresentCharacterSeats(chat.participants)
  let characterParticipant: ChatParticipantBase | undefined

  if (requestedRespondingParticipantId) {
    // Continue mode with specific participant requested - find them
    characterParticipant = presentSeats.find(p => p.id === requestedRespondingParticipantId)
    if (!characterParticipant) {
      if (isContinueMode) {
        // During continue mode (including chained turns), a mismatched participant
        // is worse than an error — it would save content under the wrong character.
        // Throw so the chain loop can handle it gracefully.
        logger.error('Requested responding participant not found or inactive during continue mode', {
          chatId: chat.id,
          requestedParticipantId: requestedRespondingParticipantId,
          activeParticipants: chat.participants
            .filter(p => p.type === 'CHARACTER' && isParticipantPresent(p.status))
            .map(p => ({ id: p.id, characterId: p.characterId })),
        })
        throw new Error(
          `Requested participant ${requestedRespondingParticipantId} not found or inactive in chat ${chat.id}`
        )
      }

      logger.warn('Requested responding participant not found or inactive, falling back', {
        chatId: chat.id,
        requestedParticipantId: requestedRespondingParticipantId,
      })
      // Fall back to first active character (only for non-continue mode)
      characterParticipant = presentSeats[0]
    }
  } else {
    // Normal mode or continue mode without specific participant — pick the
    // next LLM responder by weighted talkativeness. Excludes user-driven seats
    // from the candidate set (those wait for the human to type) — both genuine
    // owner seats and seats the human is impersonating this session (Bug 44:
    // impersonation is an overlay, `controlledBy` stays `'llm'`, so an
    // impersonated seat must be excluded via the overlay, not the column) — and
    // respects the persisted `spokenThisCycleParticipantIds` so the cycle is
    // preserved across turns.
    const llmCandidates = presentSeats.filter(
      p => !isUserDrivenSeat(p, chat.impersonatingParticipantIds)
    )

    if (llmCandidates.length === 0) {
      // No LLM characters present (e.g. solo user-character chat). Fall back
      // to the original first-active-character behaviour so downstream code
      // sees a recognisable error rather than a silent null pick.
      characterParticipant = presentSeats[0]
    } else if (llmCandidates.length === 1) {
      characterParticipant = llmCandidates[0]
    } else {
      // Build characters map (talkativeness lives on the character record).
      const charactersMap = new Map<string, Character>()
      for (const p of llmCandidates) {
        if (!p.characterId) continue
        const char = await repos.characters.findById(p.characterId)
        if (char) charactersMap.set(p.characterId, char)
      }

      const messages = await repos.chats.getMessages(chat.id)
      const messageEvents = messages.filter(
        (m): m is typeof m & { type: 'message' } => m.type === 'message'
      ) as unknown as MessageEvent[]

      const turnState = calculateTurnStateFromHistory({
        messages: messageEvents,
        participants: chat.participants,
        userParticipantId,
        spokenThisCycleParticipantIds: chat.spokenThisCycleParticipantIds,
      })

      const selection = selectNextSpeaker(
        llmCandidates,
        charactersMap,
        turnState,
        userParticipantId,
        chat.impersonatingParticipantIds,
      )

      if (selection.nextSpeakerId) {
        characterParticipant = chat.participants.find(p => p.id === selection.nextSpeakerId)
      }

      // Defensive fallback if selection somehow yielded nothing.
      if (!characterParticipant) {
        characterParticipant = llmCandidates[0]
      }

      logger.info('Picked first responder via weighted selection', {
        chatId: chat.id,
        participantId: characterParticipant.id,
        reason: selection.reason,
        cycleComplete: selection.cycleComplete,
      })
    }
  }

  if (!characterParticipant?.characterId) {
    throw new Error('No active character in chat')
  }

  // Get character
  const character = await repos.characters.findById(characterParticipant.characterId)
  if (!character) {
    throw new Error('Character not found')
  }
  if (character.archivedAt) {
    throw new CharacterArchivedError(character.id)
  }

  logger.info('Selected responding character', {
    chatId: chat.id,
    participantId: characterParticipant.id,
    characterId: characterParticipant.characterId,
    characterName: character.name,
    isContinueMode,
    requestedParticipantId: requestedRespondingParticipantId,
  })

  // Resolve connection profile using fallback chain
  let resolvedConnectionProfileId: string
  try {
    resolvedConnectionProfileId = resolveConnectionProfile(characterParticipant, character)
  } catch {
    logger.error('Failed to resolve connection profile', {
      participantId: characterParticipant.id,
      characterId: character.id,
      characterName: character.name,
    })
    throw new Error('No connection profile configured for character')
  }

  // Get connection profile with API key
  const connectionProfile = await repos.connections.findById(resolvedConnectionProfileId)
  if (!connectionProfile) {
    throw new Error('Connection profile not found')
  }

  // Get API key if needed
  let apiKey = ''
  if (connectionProfile.apiKeyId) {
    const apiKeyData = await repos.connections.findApiKeyById(connectionProfile.apiKeyId)
    if (apiKeyData) {
      apiKey = apiKeyData.key_value
    }
  }

  // Get image profile from the chat level (shared by all participants)
  const imageProfileId = chat.imageProfileId || null

  // Detect if this is a multi-character chat
  const isMultiCharacter = isMultiCharacterChat(chat.participants)

  return {
    characterParticipant,
    character,
    connectionProfile,
    apiKey,
    imageProfileId,
    userParticipant,
    userParticipantId,
    isMultiCharacter,
  }
}

/**
 * Load all participant data for multi-character chats
 */
export async function loadAllParticipantData(
  repos: ReturnType<typeof getRepositories>,
  chat: ChatMetadataBase,
  primaryCharacter: Character
): Promise<AllParticipantsData> {

  const participantCharacters = new Map<string, Character>()

  // Load all characters
  for (const p of chat.participants) {
    if (p.type === 'CHARACTER' && p.characterId && isParticipantPresent(p.status)) {
      if (p.characterId === primaryCharacter.id) {
        // Reuse already-loaded character
        participantCharacters.set(p.characterId, primaryCharacter)
      } else {
        const char = await repos.characters.findById(p.characterId)
        if (char) {
          participantCharacters.set(p.characterId, char)
        }
      }
    }
  }

  return { participantCharacters }
}


/**
 * Get roleplay template for a chat, with fallback to user default
 */
export async function getRoleplayTemplate(
  repos: ReturnType<typeof getRepositories>,
  chat: ChatMetadataBase,
  chatSettings: { defaultRoleplayTemplateId?: string } | null
): Promise<{ systemPrompt: string } | null> {
  let roleplayTemplateId = chat.roleplayTemplateId

  // If chat doesn't have a template set (older or imported chat), inherit the
  // first available default: project default (for project chats) > user/global default.
  if (roleplayTemplateId === undefined || roleplayTemplateId === null) {
    let inheritedTemplateId: string | null | undefined
    let inheritedSource: 'project' | 'user' = 'user'

    if (chat.projectId) {
      const project = await repos.projects.findById(chat.projectId)
      if (project?.defaultRoleplayTemplateId) {
        inheritedTemplateId = project.defaultRoleplayTemplateId
        inheritedSource = 'project'
      }
    }
    if (!inheritedTemplateId) {
      inheritedTemplateId = chatSettings?.defaultRoleplayTemplateId
      inheritedSource = 'user'
    }

    if (inheritedTemplateId) {
      // Persist the inherited default onto the chat so it sticks for future runs.
      await repos.chats.update(chat.id, { roleplayTemplateId: inheritedTemplateId })
      roleplayTemplateId = inheritedTemplateId
    }
  }

  if (!roleplayTemplateId) {
    return null
  }

  const roleplayTemplate = await repos.roleplayTemplates.findById(roleplayTemplateId)
  if (!roleplayTemplate) {
    return null
  }

  return { systemPrompt: roleplayTemplate.systemPrompt }
}

export { getActiveCharacterParticipants }
