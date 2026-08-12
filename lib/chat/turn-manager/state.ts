/**
 * Turn State Management
 *
 * Functions for initializing and calculating turn state.
 */

import { turnManagerLogger as logger } from './logger';
import type { TurnState, CalculateTurnStateOptions } from './types';
import type { ChatEvent, ChatParticipantBase, MessageEvent } from '@/lib/schemas/types';
import { isParticipantPresent } from '@/lib/schemas/chat.types';
import { isTurnPassMessage } from './skip-signal';

/**
 * Creates a fresh turn state (e.g., for a new chat or after reset)
 * NOTE: This function may be called during React render (e.g., in useState initializer),
 * so it MUST NOT contain any side effects like logging that could trigger state updates.
 */
export function createInitialTurnState(): TurnState {
  return {
    spokenSinceUserTurn: [],
    currentTurnParticipantId: null,
    queue: [],
    lastSpeakerId: null,
  };
}

/**
 * Calculates turn state, sourcing `spokenSinceUserTurn` (semantically "spoken
 * this cycle") from the chat row's persisted field rather than walking message
 * history. `lastSpeakerId` is still derived from history — the most recent
 * non-whisper USER or ASSISTANT message with a participantId.
 *
 * USER and ASSISTANT messages count symmetrically — user-controlled
 * characters take turns in the rotation by the human typing as them.
 */
export function calculateTurnStateFromHistory(
  options: CalculateTurnStateOptions
): TurnState {
  const { messages, spokenThisCycleParticipantIds } = options;
  const state = createInitialTurnState();

  // Source spokenThisCycle from persisted state (defaults to empty).
  if (spokenThisCycleParticipantIds) {
    try {
      const parsed = JSON.parse(spokenThisCycleParticipantIds);
      if (Array.isArray(parsed)) {
        state.spokenSinceUserTurn = parsed.filter((id): id is string => typeof id === 'string');
      }
    } catch {
      // Default to empty cycle on parse failure — recovers naturally on next save.
    }
  }

  // lastSpeakerId = most recent non-whisper message with a participantId.
  // A Host turn-pass record occupies the floor position of the character who
  // passed (stall prevention): without this, the last substantive speaker
  // would stay permanently unpickable while everyone else ping-pongs passes.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (isTurnPassMessage(msg)) {
      state.lastSpeakerId = msg.hostEvent.participantId;
      break;
    }
    if (msg.role !== 'USER' && msg.role !== 'ASSISTANT') continue;
    if (!msg.participantId) continue;
    const isWhisper = 'targetParticipantIds' in msg
      && Array.isArray(msg.targetParticipantIds)
      && msg.targetParticipantIds.length > 0;
    if (isWhisper) continue;
    state.lastSpeakerId = msg.participantId;
    break;
  }

  return state;
}

/**
 * Updates turn state after a message is sent. Call this after saving each
 * message to keep in-memory state current.
 *
 * USER and ASSISTANT messages are treated symmetrically — user-controlled
 * characters take turns in the rotation. `spokenSinceUserTurn` accumulates
 * across the cycle and only clears when the cycle wraps (i.e. when everyone
 * has spoken at least once); cycle wrap is signalled by `selectNextSpeaker`
 * returning `cycleComplete: true` and is applied by the orchestrator's
 * persisted-state writer.
 */
export function updateTurnStateAfterMessage(
  currentState: TurnState,
  message: MessageEvent,
  _userParticipantId: string | null
): TurnState {
  if (message.role !== 'USER' && message.role !== 'ASSISTANT') return currentState;
  if (!message.participantId) return currentState;
  // Whisper messages don't affect turn order
  const isWhisper = 'targetParticipantIds' in message
    && Array.isArray(message.targetParticipantIds)
    && message.targetParticipantIds.length > 0;
  if (isWhisper) return currentState;

  const newState = { ...currentState };
  const participantId = message.participantId;

  if (!newState.spokenSinceUserTurn.includes(participantId)) {
    newState.spokenSinceUserTurn = [...newState.spokenSinceUserTurn, participantId];
  }

  newState.lastSpeakerId = participantId;
  newState.queue = newState.queue.filter(id => id !== participantId);
  newState.currentTurnParticipantId = null;

  return newState;
}

/**
 * Returns the next value for `chat.spokenThisCycleParticipantIds` after the
 * given message is persisted, or `null` if the field should not change (the
 * message doesn't affect turn order — wrong type, role, whisper, or missing
 * participantId).
 *
 * The list wraps (resets to just the new speaker) once every active CHARACTER
 * participant has spoken at least once this cycle. This mirrors the
 * cycle-wrap logic in `selectNextSpeaker`: when the set of spoken participants
 * matches the active set, the next round starts fresh with only the new
 * speaker recorded.
 *
 * Returns the JSON-encoded string ready for the chat-row update, or `null`
 * to signal "no write needed". Returning `null` (rather than the existing
 * value) lets callers skip the column entirely in their update payload.
 */
/**
 * Core of the two cycle-advance helpers: record `participantId` as having taken
 * a turn this cycle, wrapping the list to just that id once every active
 * CHARACTER participant has spoken. Returns the JSON to persist, or `null` when
 * no write is needed. Shared by {@link computeSpokenThisCycleAfterMessage} and
 * {@link computeSpokenThisCycleAfterSkip}.
 */
function advanceSpokenThisCycle(
  participantId: string,
  participants: ChatParticipantBase[],
  currentSpokenJson: string | null | undefined,
): string | null {
  let current: string[] = [];
  if (currentSpokenJson) {
    try {
      const parsed = JSON.parse(currentSpokenJson);
      if (Array.isArray(parsed)) {
        current = parsed.filter((id): id is string => typeof id === 'string');
      }
    } catch {
      // Treat as empty cycle; we'll overwrite.
    }
  }

  const next = current.includes(participantId)
    ? current
    : [...current, participantId];

  // Cycle wrap: when every active CHARACTER participant has spoken at least
  // once this cycle, reset to just the new speaker so the next round starts
  // fresh. This matches the wrap behavior `selectNextSpeaker` produces when
  // it returns `cycleComplete: true`.
  const activeIds = new Set(
    participants
      .filter(p => p.type === 'CHARACTER' && isParticipantPresent(p.status) && p.characterId)
      .map(p => p.id),
  );

  if (activeIds.size > 0) {
    const spokenActive = next.filter(id => activeIds.has(id));
    if (spokenActive.length >= activeIds.size) {
      return JSON.stringify([participantId]);
    }
  }

  if (next === current) return null; // no-op
  return JSON.stringify(next);
}

export function computeSpokenThisCycleAfterMessage(
  message: ChatEvent,
  participants: ChatParticipantBase[],
  currentSpokenJson: string | null | undefined,
): string | null {
  if (message.type !== 'message') return null;
  if (message.role !== 'USER' && message.role !== 'ASSISTANT') return null;
  if (!message.participantId) return null;

  const isWhisper = 'targetParticipantIds' in message
    && Array.isArray(message.targetParticipantIds)
    && message.targetParticipantIds.length > 0;
  if (isWhisper) return null;

  return advanceSpokenThisCycle(message.participantId, participants, currentSpokenJson);
}

/**
 * Returns the next value for `chat.spokenThisCycleParticipantIds` after a
 * skip-user-turn action. The given user-controlled participant is appended to
 * the cycle (as if they had taken a turn), so the rotation can advance to the
 * next character without the human having to type. Cycle-wrap rules match
 * `computeSpokenThisCycleAfterMessage`.
 *
 * Returns `null` if the participantId is already recorded and no other change
 * is needed (the caller can skip the column in their update payload).
 */
export function computeSpokenThisCycleAfterSkip(
  skippedParticipantId: string,
  participants: ChatParticipantBase[],
  currentSpokenJson: string | null | undefined,
): string | null {
  return advanceSpokenThisCycle(skippedParticipantId, participants, currentSpokenJson);
}
