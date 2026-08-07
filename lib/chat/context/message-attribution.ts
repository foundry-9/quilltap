/**
 * Message Attribution
 *
 * Handles multi-character message attribution and history access filtering.
 * Converts messages to the responding character's perspective for context building.
 */

import type { Character, ChatParticipantBase, ParticipantStatus } from '@/lib/schemas/types'
import type { MultiCharacterMessage } from '@/lib/llm/message-formatter'
import { logger } from '@/lib/logger'
import { isParticipantPresent } from '@/lib/schemas/chat.types'
import { isUserDrivenSeat } from '@/lib/chat/turn-manager/utils'

/**
 * Extended message format for multi-character context building
 * Includes participantId for attribution
 */
export interface MessageWithParticipant {
  role: string
  content: string
  id?: string
  thoughtSignature?: string | null
  /** Which participant sent this message (for multi-character attribution) */
  participantId?: string | null
  /** When the message was created (for history access filtering) */
  createdAt?: string
  /** Target participant IDs for whisper messages */
  targetParticipantIds?: string[] | null
  /**
   * Structured payload on Host announcements. For presence transitions both
   * `participantId` and `toStatus` are set; for off-scene-character
   * introductions only `introducedCharacterIds` is set. Presence tracking
   * filters on the first shape and ignores the second.
   */
  hostEvent?: {
    participantId?: string
    toStatus?: ParticipantStatus
    introducedCharacterIds?: string[]
  } | null
}

/**
 * A presence window for a participant: an interval [from, to) during which the
 * participant was 'active' or 'silent' in the chat. `to` is null on the
 * trailing open window (still present right now). Times are ISO strings; lex
 * order matches chronological order so plain string compares work.
 */
export interface PresenceWindow {
  from: string
  to: string | null
}

/**
 * Filter messages based on participant's history access
 * If hasHistoryAccess is false, only include messages after the participant joined
 */
export function filterMessagesByHistoryAccess(
  messages: MessageWithParticipant[],
  participant: ChatParticipantBase
): MessageWithParticipant[] {
  // If participant has full history access, return all messages
  if (participant.hasHistoryAccess) {

    return messages
  }

  // Otherwise, filter to only messages after the participant joined
  const participantJoinTime = new Date(participant.createdAt).getTime()

  const filteredMessages = messages.filter(msg => {
    if (!msg.createdAt) {
      // If no createdAt, include the message (shouldn't happen)
      return true
    }
    const msgTime = new Date(msg.createdAt).getTime()
    return msgTime >= participantJoinTime
  })

  return filteredMessages
}

/**
 * Compute the presence windows for a participant by walking Host status
 * announcements (`hostEvent.participantId === participant.id`) in
 * chronological order.
 *
 * Each Host status event marks a transition; an interval is "open" while the
 * participant is `active` or `silent`, and closed by a transition to `absent`
 * or `removed`. The trailing open window — still present right now — has
 * `to: null`.
 *
 * If no Host events exist for the participant (legacy data, or freshly added
 * with nothing else having happened), the participant is assumed to be
 * present from `participant.createdAt` onward (one open window).
 *
 * Callers with `participant.hasHistoryAccess === true` should skip this
 * filter entirely — they see the whole transcript regardless of presence.
 */
export function computePresenceWindowsForParticipant(
  messages: MessageWithParticipant[],
  participant: ChatParticipantBase,
): PresenceWindow[] {
  const events = messages
    .filter(
      m =>
        m.hostEvent &&
        m.hostEvent.participantId === participant.id &&
        m.hostEvent.toStatus !== undefined &&
        m.createdAt,
    )
    .map(m => ({ at: m.createdAt as string, toStatus: m.hostEvent!.toStatus as ParticipantStatus }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

  const windows: PresenceWindow[] = []
  let openFrom: string | null = null

  if (events.length === 0) {
    return [{ from: participant.createdAt, to: null }]
  }

  for (const event of events) {
    const present = event.toStatus === 'active' || event.toStatus === 'silent'
    if (present) {
      if (openFrom === null) {
        openFrom = event.at
      }
    } else {
      if (openFrom !== null) {
        windows.push({ from: openFrom, to: event.at })
        openFrom = null
      }
    }
  }

  if (openFrom !== null) {
    windows.push({ from: openFrom, to: null })
  }

  return windows
}

/**
 * Filter messages to those that fall inside one of the participant's presence
 * windows. Messages without `createdAt` are dropped (we can't place them).
 *
 * `from` is inclusive, `to` is exclusive — so a message at exactly the moment
 * a participant goes 'absent' is not visible to them. A null `to` means the
 * window is still open.
 */
export function filterMessagesByPresenceWindows(
  messages: MessageWithParticipant[],
  windows: PresenceWindow[],
): MessageWithParticipant[] {
  if (windows.length === 0) {
    return []
  }
  return messages.filter(msg => {
    if (!msg.createdAt) return false
    const t = msg.createdAt
    return windows.some(w => t >= w.from && (w.to === null || t < w.to))
  })
}

/**
 * Filter whisper messages from context
 * A whisper is only visible to the sender and the target(s)
 * Public messages (no targetParticipantIds) are always visible
 */
export function filterWhisperMessages(
  messages: MessageWithParticipant[],
  respondingParticipantId: string
): MessageWithParticipant[] {
  return messages.filter(msg => {
    // Public message - always include
    if (!msg.targetParticipantIds || msg.targetParticipantIds.length === 0) {
      return true
    }
    // Sender can see their own whispers
    if (msg.participantId === respondingParticipantId) {
      return true
    }
    // Target can see whispers directed at them
    if (msg.targetParticipantIds.includes(respondingParticipantId)) {
      return true
    }
    // Not involved - exclude
    return false
  })
}

/**
 * Get participant name for message attribution
 * Supports CHARACTER participants (both LLM and user-controlled)
 */
export function getParticipantName(
  participantId: string | null | undefined,
  participantCharacters: Map<string, Character>,
  allParticipants: ChatParticipantBase[]
): string | undefined {
  if (!participantId) {
    return undefined
  }

  // Find the participant
  const participant = allParticipants.find(p => p.id === participantId)
  if (!participant) {
    return undefined
  }

  // CHARACTER participants (both LLM and user-controlled)
  if (participant.type === 'CHARACTER' && participant.characterId) {
    const character = participantCharacters.get(participant.characterId)
    return character?.name
  }

  return undefined
}

/**
 * Attribute messages for multi-character context
 * Converts messages to the responding character's perspective:
 * - Messages from the responding character → role: assistant
 * - Messages from other characters → role: user, with name
 * - Messages from user/character → role: user, with name
 */
export function attributeMessagesForCharacter(
  messages: MessageWithParticipant[],
  respondingParticipantId: string,
  participantCharacters: Map<string, Character>,
  allParticipants: ChatParticipantBase[]
): MultiCharacterMessage[] {

  return messages.map(msg => {
    const participantName = getParticipantName(
      msg.participantId,
      participantCharacters,
      allParticipants
    )

    // Determine role based on who sent the message
    let role: 'user' | 'assistant' = 'user'

    if (msg.participantId === respondingParticipantId) {
      // Message from the responding character → assistant role
      role = 'assistant'
    } else if (msg.role.toUpperCase() === 'ASSISTANT') {
      // Message from another character (was stored as ASSISTANT) → user role
      // The name attribution will distinguish them
      role = 'user'
    } else {
      // USER messages stay as user role
      role = 'user'
    }

    return {
      role,
      content: msg.content,
      id: msg.id,
      name: participantName,
      participantId: msg.participantId || undefined,
      thoughtSignature: msg.thoughtSignature,
    }
  })
}

/**
 * Find the user participant name for message attribution in multi-character mode.
 *
 * Prefers the participant the human is currently "Speaking As"
 * (`activeTypingParticipantId`) so a freshly typed message is labelled with the
 * chosen character's name; falls back to the first active user-controlled
 * CHARACTER participant when no valid selection exists.
 */
export function findUserParticipantName(
  allParticipants: ChatParticipantBase[],
  participantCharacters: Map<string, Character>,
  activeTypingParticipantId?: string | null,
  impersonatingParticipantIds?: readonly string[] | null
): string | undefined {
  // Prefer the actively-selected speaker, then fall back to the first
  // user-controlled CHARACTER participant. The selected speaker may be a seat
  // the human is impersonating (Bug 44 overlay — `controlledBy` still `'llm'`),
  // so honour the overlay rather than the bare column; otherwise a message typed
  // while "speaking as" a character would fall through to the wrong name.
  const selected = activeTypingParticipantId
    ? allParticipants.find(p =>
        p.id === activeTypingParticipantId &&
        p.type === 'CHARACTER' && isUserDrivenSeat(p, impersonatingParticipantIds) &&
        isParticipantPresent(p.status) && p.characterId
      )
    : undefined
  const userCharacterParticipant = selected ?? allParticipants.find(p =>
    p.type === 'CHARACTER' && p.controlledBy === 'user' && isParticipantPresent(p.status) && p.characterId
  )
  if (userCharacterParticipant?.characterId) {
    const character = participantCharacters.get(userCharacterParticipant.characterId)
    if (character?.name) {
      return character.name
    }
  }

  return undefined
}
