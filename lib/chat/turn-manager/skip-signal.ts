/**
 * "Nothing to add" turn-skipping — shared pure logic.
 *
 * Client-safe: this module imports only type-level schema definitions plus
 * pure string helpers (`normalizeContentBlockFormat`, `stripCharacterNamePrefix`,
 * `findMentionedCharacterIds`). It performs NO repository / filesystem access,
 * so it can run identically on the server (orchestrator, turn action), in the
 * forked background-jobs child, and in the Salon client for the Skip-button
 * guard.
 *
 * A pass is recorded as a Host message (`systemSender: 'host'`,
 * `systemKind: 'turn-pass'`, `hostEvent: { participantId }`) — no new state
 * columns. Every derivation below (last speaker, cycle membership, must-speak
 * guard) recomputes from that history.
 */

import type { ChatEvent, MessageEvent, ChatParticipantBase } from '@/lib/schemas/types'
import type { Character } from '@/lib/schemas/types'
import { isParticipantPresent } from '@/lib/schemas/chat.types'
import { normalizeContentBlockFormat, stripCharacterNamePrefix } from '@/lib/llm/response-normalizer'
import { findMentionedCharacterIds } from '@/lib/chat/context/mentioned-characters'
import { isVisibleConversationalTurn } from '@/lib/chat/context/core-whisper-trigger'

/** The literal sentinel a character emits to pass its turn. */
export const NOTHING_TO_ADD_SENTINEL = '[NOTHING TO ADD]'

/** `systemKind` stamped on the Host message that records a pass. */
export const TURN_PASS_SYSTEM_KIND = 'turn-pass'

/**
 * Type guard: is this event a Host turn-pass record? A turn-pass carries the
 * passing participant's id in `hostEvent.participantId`.
 */
export function isTurnPassMessage(
  m: unknown,
): m is MessageEvent & { hostEvent: { participantId: string } } {
  if (!m || typeof m !== 'object') return false
  const msg = m as {
    type?: unknown
    systemSender?: unknown
    systemKind?: unknown
    hostEvent?: unknown
  }
  if (msg.type !== 'message') return false
  if (msg.systemSender !== 'host') return false
  if (msg.systemKind !== TURN_PASS_SYSTEM_KIND) return false
  const he = msg.hostEvent
  return !!he && typeof he === 'object' && typeof (he as { participantId?: unknown }).participantId === 'string'
}

export type DetectSkipResult = { skip: true } | { skip: false; cleaned?: string }

/**
 * Decide whether a raw model response is a turn-pass.
 *
 * The response is normalized (`normalizeContentBlockFormat`), stripped of any
 * leading own-name prefix (`stripCharacterNamePrefix`), and its FIRST non-empty
 * line is examined. That line — with surrounding markdown/quote wrappers
 * (`* _ ~ " ' \``), optional square brackets, and trailing punctuation shed,
 * case-insensitively — must equal `NOTHING TO ADD`.
 *
 *   - Bare sentinel (nothing but whitespace after it) → `{ skip: true }`.
 *   - Sentinel line followed by real prose → NOT a skip; returns
 *     `{ skip: false, cleaned }` with the sentinel line removed so the caller
 *     can keep the prose.
 *   - Real prose that merely ENDS with a lone sentinel line → NOT a skip;
 *     returns `{ skip: false, cleaned }` with that trailing line removed. Weak
 *     models often narrate, then tack `[NOTHING TO ADD]` on the end; the
 *     narration is a genuine contribution and must be kept, but the dangling
 *     sentinel line should never reach display / persistence / memory.
 *   - No sentinel → `{ skip: false }`.
 */
export function detectSkipSentinel(
  response: string,
  characterName?: string,
  aliases?: string[],
): DetectSkipResult {
  if (!response) return { skip: false }

  // Only strip a name prefix when we actually have a name/aliases to target.
  // With none, stripCharacterNamePrefix falls back to a generic bracketed-name
  // pattern that would eat the sentinel's own `[NOTHING TO ADD]` brackets.
  const normalizedRaw = normalizeContentBlockFormat(response)
  const normalized = (characterName || (aliases && aliases.length > 0))
    ? stripCharacterNamePrefix(normalizedRaw, characterName, aliases)
    : normalizedRaw

  const lines = normalized.split('\n')

  // Locate the first non-empty line.
  let firstIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      firstIdx = i
      break
    }
  }
  if (firstIdx === -1) return { skip: false }

  if (isSentinelLine(lines[firstIdx])) {
    // Sentinel matched on the first line. Is there any non-whitespace after it?
    const trailing = lines.slice(firstIdx + 1).join('\n')
    if (trailing.trim().length === 0) {
      return { skip: true }
    }

    // Sentinel + prose: drop the sentinel line, keep the rest.
    const cleaned = [...lines.slice(0, firstIdx), ...lines.slice(firstIdx + 1)]
      .join('\n')
      .trim()
    return { skip: false, cleaned }
  }

  // The first line is real content, not the sentinel. But weak models often
  // narrate a genuine turn and then dangle a lone `[NOTHING TO ADD]` line at the
  // end. That is NOT a pass — there's real communication above it — but the
  // dangling line must be stripped from what is displayed, saved, and
  // remembered. Locate the LAST non-empty line and, if it is a sentinel line on
  // its own, drop it and keep the prose above.
  let lastIdx = -1
  for (let i = lines.length - 1; i > firstIdx; i--) {
    if (lines[i].trim().length > 0) {
      lastIdx = i
      break
    }
  }
  if (lastIdx !== -1 && isSentinelLine(lines[lastIdx])) {
    const cleaned = [...lines.slice(0, lastIdx), ...lines.slice(lastIdx + 1)]
      .join('\n')
      .trim()
    return { skip: false, cleaned }
  }

  return { skip: false }
}

/**
 * Does a single line, once its wrapping and trailing punctuation are shed,
 * equal the sentinel phrase? Brackets are optional; matching is case-insensitive.
 */
function isSentinelLine(line: string): boolean {
  let s = line.trim()
  // Shed matched wrapping markdown / quote characters, repeatedly.
  // (e.g. **[NOTHING TO ADD]**, "_[nothing to add]_", `[NOTHING TO ADD]`)
  const wrappers = new Set(['*', '_', '~', '"', "'", '`'])
  let changed = true
  while (changed && s.length > 1) {
    changed = false
    const first = s[0]
    const last = s[s.length - 1]
    if (wrappers.has(first) && (first === last || wrappers.has(last))) {
      // Trim one wrapper char from each end when both ends are wrapper chars.
      s = s.slice(1, -1).trim()
      changed = true
    }
  }
  // Drop optional square brackets.
  s = s.replace(/^\[/, '').replace(/\]$/, '').trim()
  // Drop trailing punctuation.
  s = s.replace(/[.!?,;:]+$/, '').trim()
  return s.toLowerCase() === 'nothing to add'
}

/**
 * Backward-walk the event history collecting the participant ids of every
 * turn-pass record posted since the most recent substantive message. A
 * "substantive" message is a non-whisper USER/ASSISTANT message with a
 * participantId (same predicate `calculateTurnStateFromHistory` uses for
 * `lastSpeakerId`); turn-pass records carry a null participantId so they are
 * never mistaken for substantive.
 */
export function findSkippedSinceLastSubstantive(events: ReadonlyArray<ChatEvent>): Set<string> {
  const skipped = new Set<string>()
  for (let i = events.length - 1; i >= 0; i--) {
    const m = events[i]
    if (m.type !== 'message') continue
    if (isTurnPassMessage(m)) {
      skipped.add(m.hostEvent.participantId)
      continue
    }
    if ((m.role === 'USER' || m.role === 'ASSISTANT') && m.participantId) {
      const isWhisper = Array.isArray((m as MessageEvent).targetParticipantIds)
        && ((m as MessageEvent).targetParticipantIds?.length ?? 0) > 0
      if (!isWhisper) break
    }
  }
  return skipped
}

/**
 * Whether a chat is large/busy enough for turn-skipping to apply at all.
 *
 * The feature is meant for genuine group scenes, not a one-on-one. It applies
 * only when either:
 *   - more than two active character participants are present, OR
 *   - at least two of them are LLM-driven.
 *
 * So a lone human + a single LLM (a duet) is excluded, while two-or-more LLMs,
 * or any three-plus-participant scene, qualifies.
 */
export function qualifiesForTurnSkipping(
  participants: ReadonlyArray<ChatParticipantBase>,
): boolean {
  const activeChars = participants.filter(
    p => p.type === 'CHARACTER' && isParticipantPresent(p.status) && !!p.characterId,
  )
  if (activeChars.length > 2) return true
  const llmChars = activeChars.filter(p => p.controlledBy !== 'user')
  return llmChars.length >= 2
}

/**
 * True when no character has yet taken an LLM turn in this chat — i.e. there is
 * no ASSISTANT message carrying a non-null participantId. Greetings count as
 * turns (they carry a participantId); Staff messages do not (participantId is
 * null). The very first character turn of the whole chat is skip-exempt.
 */
export function isFirstCharacterTurn(events: ReadonlyArray<ChatEvent>): boolean {
  for (const m of events) {
    if (m.type !== 'message') continue
    if (m.role === 'ASSISTANT' && m.participantId) return false
  }
  return true
}

/** How many recent visible turns to scan for a "recently addressed" signal. */
const RECENTLY_ADDRESSED_LOOKBACK = 10

/**
 * Has the responding character been addressed or mentioned since they last
 * spoke? Scans the visible conversational turns after the responder's own most
 * recent non-whisper ASSISTANT message (capped at the last
 * {@link RECENTLY_ADDRESSED_LOOKBACK}). A hit is either the responder's
 * name/alias appearing in that corpus, or a whisper targeted at the responder.
 */
export function isRecentlyAddressed(
  events: ReadonlyArray<ChatEvent>,
  respondingParticipantId: string,
  respondingCharacter: Character,
): boolean {
  // Find the responder's own last non-whisper ASSISTANT message.
  let lastOwnIdx = -1
  for (let i = events.length - 1; i >= 0; i--) {
    const m = events[i]
    if (m.type !== 'message') continue
    if (m.role !== 'ASSISTANT') continue
    if (m.participantId !== respondingParticipantId) continue
    if (m.systemSender) continue
    const isWhisper = Array.isArray(m.targetParticipantIds) && (m.targetParticipantIds?.length ?? 0) > 0
    if (isWhisper) continue
    lastOwnIdx = i
    break
  }

  // Collect visible conversational turns after that boundary.
  const visible: MessageEvent[] = []
  for (let i = lastOwnIdx + 1; i < events.length; i++) {
    const m = events[i]
    if (m.type !== 'message') continue
    if (isVisibleConversationalTurn(m, respondingParticipantId)) {
      visible.push(m)
    }
  }
  const window = visible.slice(-RECENTLY_ADDRESSED_LOOKBACK)
  if (window.length === 0) return false

  // A whisper targeted at the responder counts as addressed regardless of text.
  for (const m of window) {
    const targets = m.targetParticipantIds
    if (targets && targets.length > 0 && targets.includes(respondingParticipantId)) {
      return true
    }
  }

  const corpus = window.map(m => m.content ?? '').join('\n')
  return findMentionedCharacterIds(corpus, [respondingCharacter]).size > 0
}

export type MustSpeakReason =
  | 'not-multi-character'
  | 'feature-disabled'
  | 'first-character-turn'
  | 'summoned'
  | 'already-skipped'
  | 'all-others-skipped'
  | null

export interface ComputeSkipEligibilityOptions {
  events: ReadonlyArray<ChatEvent>
  participants: ReadonlyArray<ChatParticipantBase>
  respondingParticipantId: string
  respondingCharacter: Character
  /** Nudge / queue-popped turn — the operator explicitly summoned this voice. */
  summoned?: boolean
  /** Per-chat toggle; NULL/true = enabled. Pass `chat.turnSkippingEnabled !== false`. */
  turnSkippingEnabled: boolean
}

export interface SkipEligibility {
  offerSkip: boolean
  mustSpeakReason: MustSpeakReason
  recentlyAddressed: boolean
}

/**
 * Decide whether the responding character may be offered the skip option this
 * turn, and (for logging / the human Skip-button guard) why not.
 *
 * The single must-speak rule: a responder must speak when every OTHER active
 * CHARACTER participant (LLM or user-controlled) has a turn-pass record since
 * the last substantive message. With no other participants the `.every()` is
 * vacuously true — skipping into an empty room is intentionally forbidden.
 *
 * Precedence of withhold reasons: feature-disabled → first-character-turn →
 * summoned → already-skipped → all-others-skipped.
 */
export function computeSkipEligibility(
  options: ComputeSkipEligibilityOptions,
): SkipEligibility {
  const {
    events,
    participants,
    respondingParticipantId,
    respondingCharacter,
    summoned = false,
    turnSkippingEnabled,
  } = options

  const recentlyAddressed = isRecentlyAddressed(events, respondingParticipantId, respondingCharacter)

  let mustSpeakReason: MustSpeakReason = null

  if (!qualifiesForTurnSkipping(participants)) {
    // A one-on-one (or single-character) chat is out of scope entirely.
    mustSpeakReason = 'not-multi-character'
  } else if (!turnSkippingEnabled) {
    mustSpeakReason = 'feature-disabled'
  } else if (isFirstCharacterTurn(events)) {
    mustSpeakReason = 'first-character-turn'
  } else if (summoned) {
    mustSpeakReason = 'summoned'
  } else {
    const skipped = findSkippedSinceLastSubstantive(events)
    if (skipped.has(respondingParticipantId)) {
      mustSpeakReason = 'already-skipped'
    } else {
      const otherActiveCharacters = participants.filter(
        p =>
          p.type === 'CHARACTER' &&
          isParticipantPresent(p.status) &&
          !!p.characterId &&
          p.id !== respondingParticipantId,
      )
      const allOthersSkipped = otherActiveCharacters.every(p => skipped.has(p.id))
      if (allOthersSkipped) {
        mustSpeakReason = 'all-others-skipped'
      }
    }
  }

  return {
    offerSkip: mustSpeakReason === null,
    mustSpeakReason,
    recentlyAddressed,
  }
}
