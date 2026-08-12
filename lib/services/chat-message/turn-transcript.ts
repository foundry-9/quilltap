/**
 * Turn Transcript Builder
 *
 * Per-turn memory extraction: instead of running extraction once per
 * assistant message (with each pass seeing only its own slice), we wait
 * until the turn closes and run extraction once against a joined transcript
 * of the whole turn — the user message that opened it plus every character
 * response that followed, keyed by character.
 *
 * "Turn opener" is the most recent non-system USER message. The turn closes
 * when control returns to the user (turnInfo.isUsersTurn === true on the
 * last finalizer of the turn).
 */

import type { Character, ChatParticipantBase, MessageEvent } from '@/lib/schemas/types'
import type { Pronouns } from '@/lib/schemas/character.types'

export interface TurnCharacterSlice {
  characterId: string
  characterName: string
  characterPronouns?: Pronouns | null
  /** Joined text from every assistant message this character contributed during the turn, in chronological order. */
  text: string
  /** Every assistant message ID that contributed to this slice. */
  contributingMessageIds: string[]
  /**
   * `createdAt` of the slice's most recent contributing message — the
   * wall-clock anchor used to stamp `occurredAt` on memories derived from
   * this slice (episodic spine). Null when the source event carried no
   * timestamp.
   */
  lastMessageCreatedAt?: string | null
  /**
   * True when this slice's text was authored by the human driving a
   * user-controlled character (role: 'USER'), not by an LLM. Such a slice is
   * built from the turn opener so the user-controlled character forms its own
   * SELF and OTHER memories from the turns the human plays it.
   */
  isUserControlled?: boolean
}

export interface TurnTranscript {
  /** ID of the USER message that opened the turn, or null for greeting/continue turns with no fresh user input. */
  turnOpenerMessageId: string | null
  /** Verbatim user-message text, or null when the turn has no user opener. */
  userMessage: string | null
  /** Resolved user-controlled character (if any). */
  userCharacterId?: string
  userCharacterName?: string
  userCharacterPronouns?: Pronouns | null
  /** ASSISTANT participants that spoke during the turn, ordered by first contribution. */
  characterSlices: TurnCharacterSlice[]
  /** The most recent ASSISTANT message ID in the turn — used as sourceMessageId on derived memories. */
  latestAssistantMessageId: string | null
  /**
   * Wall-clock anchor for the whole turn: `createdAt` of the most recent
   * message collected (opener or assistant). Feeds the extraction CLOCK and
   * the fallback `occurredAt` stamp. Null when nothing carried a timestamp.
   */
  turnTimestamp: string | null
}

/**
 * Find the most recent non-system USER message in chat history.
 * Returns null if no qualifying user message exists (fresh chat, greeting-only).
 */
export function findTurnOpenerMessageId(messages: MessageEvent[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.type !== 'message') continue
    if (m.role !== 'USER') continue
    if (m.systemSender) continue
    return m.id
  }
  return null
}

/**
 * Resolve the user-controlled character (if any) from a chat's participants,
 * hydrated from a map of the chat's `Character` records.
 *
 * Quilltap is single-user per instance: at most one CHARACTER participant is
 * marked as the user persona. When none exists — or its Character record is
 * missing from the map — the caller simply omits the user from its subject set.
 *
 * Lives here because every caller is feeding {@link buildTurnTranscript}'s
 * `userCharacter*` options, which is exactly what this returns.
 */
export function resolveUserCharacterParticipant(
  participants: ChatParticipantBase[],
  participantCharacters: Map<string, Character>,
): { id: string; name: string; pronouns: Character['pronouns'] | null } | undefined {
  const userCharParticipant = participants.find(
    p => p.type === 'CHARACTER' && p.controlledBy === 'user' && p.characterId,
  )
  if (!userCharParticipant || userCharParticipant.type !== 'CHARACTER' || !userCharParticipant.characterId) {
    return undefined
  }
  const character = participantCharacters.get(userCharParticipant.characterId)
  if (!character) return undefined
  return { id: character.id, name: character.name, pronouns: character.pronouns ?? null }
}

interface BuildTurnTranscriptOptions {
  /** The USER message that opened the turn. Pass null for greeting-only turns. */
  turnOpenerMessageId: string | null
  /**
   * Optional terminal ASSISTANT message ID. When set, the forward walk
   * stops after collecting the message whose id matches — used by
   * autonomous chats so each speaker's turn becomes its own transcript
   * rather than re-extracting the whole tail every time.
   */
  extractionAnchorMessageId?: string | null
  userCharacterId?: string
  userCharacterName?: string
  userCharacterPronouns?: Pronouns | null
}

/**
 * Build a per-turn transcript from chat history.
 *
 * Walks forward from the turn opener (exclusive) to the end of the message list,
 * grouping ASSISTANT messages by participantId. Skips system whispers (Host,
 * Librarian, Concierge, etc.), tool messages, and silent-mode messages — none
 * of those represent participant speech.
 *
 * If `turnOpenerMessageId` is null we treat every assistant message in the
 * history as belonging to "the current turn"; the user-message side of the
 * transcript is null and the user-pass extraction skips itself. When
 * `extractionAnchorMessageId` is set, the walk stops after collecting the
 * anchor — autonomous chats use this to bound each character's slice.
 */
export function buildTurnTranscript(
  messages: MessageEvent[],
  participants: ChatParticipantBase[],
  participantCharacters: Map<string, Character>,
  options: BuildTurnTranscriptOptions,
): TurnTranscript {
  const slices = new Map<string, TurnCharacterSlice>()
  const sliceOrder: string[] = []
  let userMessage: string | null = null
  let userSlice: TurnCharacterSlice | null = null
  let latestAssistantMessageId: string | null = null
  let turnTimestamp: string | null = null

  let scanning = options.turnOpenerMessageId === null
  for (const m of messages) {
    if (m.type !== 'message') continue

    if (!scanning) {
      if (m.id === options.turnOpenerMessageId && m.role === 'USER') {
        userMessage = m.content
        scanning = true
        turnTimestamp = m.createdAt ?? turnTimestamp
        // Promote a user-controlled opener to a first-class slice so its driver
        // forms memories. The opener's participantId authoritatively identifies
        // which user character spoke this turn (more reliable than the singular
        // userCharacterId option, which is just the first user-controlled
        // participant). Built before the forward walk; prepended below so it
        // reads first chronologically.
        const openerParticipant = participants.find(p => p.id === m.participantId)
        if (
          openerParticipant?.type === 'CHARACTER' &&
          openerParticipant.controlledBy === 'user' &&
          openerParticipant.characterId
        ) {
          const character = participantCharacters.get(openerParticipant.characterId)
          if (character) {
            userSlice = {
              characterId: character.id,
              characterName: character.name,
              characterPronouns: character.pronouns ?? null,
              text: m.content,
              contributingMessageIds: [m.id],
              lastMessageCreatedAt: m.createdAt ?? null,
              isUserControlled: true,
            }
          }
        }
      }
      continue
    }

    if (m.role === 'USER' && !m.systemSender) {
      break
    }

    if (m.systemSender) continue
    if (m.role !== 'ASSISTANT') continue
    if (m.isSilentMessage) continue
    if (!m.participantId) continue

    const participant = participants.find(p => p.id === m.participantId)
    if (!participant || participant.type !== 'CHARACTER' || !participant.characterId) continue

    const character = participantCharacters.get(participant.characterId)
    if (!character) continue

    const existing = slices.get(participant.characterId)
    if (existing) {
      existing.text = existing.text.length
        ? `${existing.text}\n\n${m.content}`
        : m.content
      existing.contributingMessageIds.push(m.id)
      existing.lastMessageCreatedAt = m.createdAt ?? existing.lastMessageCreatedAt
    } else {
      slices.set(participant.characterId, {
        characterId: character.id,
        characterName: character.name,
        characterPronouns: character.pronouns ?? null,
        text: m.content,
        contributingMessageIds: [m.id],
        lastMessageCreatedAt: m.createdAt ?? null,
      })
      sliceOrder.push(participant.characterId)
    }

    latestAssistantMessageId = m.id
    turnTimestamp = m.createdAt ?? turnTimestamp

    if (options.extractionAnchorMessageId && m.id === options.extractionAnchorMessageId) {
      break
    }
  }

  return {
    turnOpenerMessageId: options.turnOpenerMessageId,
    userMessage,
    userCharacterId: options.userCharacterId,
    userCharacterName: options.userCharacterName,
    userCharacterPronouns: options.userCharacterPronouns,
    characterSlices: userSlice
      ? [userSlice, ...sliceOrder.map(id => slices.get(id)!)]
      : sliceOrder.map(id => slices.get(id)!),
    latestAssistantMessageId,
    turnTimestamp,
  }
}
