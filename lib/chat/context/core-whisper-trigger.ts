/**
 * Aurora Core whisper — cadence trigger.
 *
 * Pure function. Given a chat's event history and the participant about to
 * take the next turn, decide whether to offer this character their own
 * `Core/` packet before that turn fires.
 *
 * The three triggers (composed by OR; only one fire per turn):
 *
 *   - **first**    — the character has never been offered a Core whisper in
 *                    this chat. Covers two cases: the character has not yet
 *                    spoken (the literal first-turn case) AND chats that
 *                    predate the feature (the bootstrap case, where the
 *                    character has spoken before but never been offered a
 *                    Core packet).
 *   - **periodic** — `interval` of their own visible turns have passed since
 *                    the last Core whisper for them.
 *   - **silence**  — the last `silenceThreshold` visible conversational turns
 *                    immediately before this one were authored by *someone else*
 *                    (user or another participant). Long stretches without your
 *                    voice are exactly where convergence pressure builds; the
 *                    packet says "you're still here — what do you think?"
 *
 * Visible conversational turn (`isVisibleConversationalTurn`) excludes:
 *
 *   - Non-message events (`context-summary`, `system`).
 *   - Staff whispers — any message with a `systemSender` set.
 *   - `isSilentMessage === true`.
 *   - Empty / tool-call-only assistant turns (trimmed content empty).
 *   - Private whispers targeted away from this responding character
 *     (`targetParticipantIds` set, but doesn't include them) — those aren't
 *     part of this character's room cadence.
 *
 * Continue / nudge turns skip the whisper entirely — a continuation is not
 * a new response.
 *
 * Computed on demand from the message history (no persistent counter).
 */

import type { ChatEvent, MessageEvent } from '@/lib/schemas/chat.types';

export type CoreWhisperReason = 'first' | 'periodic' | 'silence' | 'context-transition';

export interface ShouldFireCoreWhisperResult {
  fire: boolean;
  reason: CoreWhisperReason | null;
}

export interface ShouldFireCoreWhisperOptions {
  events: ChatEvent[];
  respondingParticipantId: string;
  isContinue: boolean;
  isNudge: boolean;
  interval: number;
  silenceThreshold: number;
  /** When true, the first visible turn after a Librarian rolling-summary fold counts as a `context-transition` fire. */
  fireOnContextTransition?: boolean;
}

/**
 * A conversational turn visible to the responding character: a real
 * (non-Staff) USER/ASSISTANT message with content, not silent, and not a
 * whisper targeted away from this character. Shared single source of truth —
 * also consumed by `lib/chat/turn-manager/skip-signal.ts`.
 */
export function isVisibleConversationalTurn(
  m: MessageEvent,
  respondingParticipantId: string,
): boolean {
  if (m.systemSender) return false;
  if (m.isSilentMessage === true) return false;
  if (typeof m.content !== 'string' || m.content.trim() === '') return false;
  const targets = m.targetParticipantIds;
  if (targets && targets.length > 0 && !targets.includes(respondingParticipantId)) {
    return false;
  }
  return true;
}

/**
 * Conservative v1 definition of a major context transition: the most recent
 * Librarian rolling-summary fold whisper. Returns its index, or -1.
 *
 * The Librarian's rolling-summary `systemKind` values use kebab-case slugs
 * containing the literal words `summary` or `rolling` (e.g. `rolling-summary`,
 * `per-character-summary`). The earlier substring check on `fold` was too
 * loose — it false-matched announcements like `folder-created-by-character`,
 * which represent a character filing a folder, not a memory fold. The
 * tightened check uses kebab-segment membership so `summary` / `rolling`
 * match cleanly without catching unrelated kinds.
 */
function findLatestContextTransitionIndex(
  events: ChatEvent[],
  respondingParticipantId: string,
): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type !== 'message') continue;
    const m = ev as MessageEvent;
    if (m.systemSender !== 'librarian') continue;
    if (!m.systemKind) continue;
    const segments = m.systemKind.toLowerCase().split(/[-_]/);
    if (!segments.includes('summary') && !segments.includes('rolling')) continue;
    // A per-character Librarian summary that isn't addressed to this character
    // shouldn't count as a transition for them.
    const targets = m.targetParticipantIds;
    if (targets && targets.length > 0 && !targets.includes(respondingParticipantId)) continue;
    return i;
  }
  return -1;
}

export function shouldFireCoreWhisper(
  options: ShouldFireCoreWhisperOptions,
): ShouldFireCoreWhisperResult {
  const {
    events,
    respondingParticipantId,
    isContinue,
    isNudge,
    interval,
    silenceThreshold,
    fireOnContextTransition = true,
  } = options;

  if (isContinue || isNudge) return { fire: false, reason: null };

  let lastCoreWhisperIdx = -1;
  let mySelfTurnCount = 0;
  let mySelfTurnsAfterWhisper = 0;
  let silenceRun = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type !== 'message') {
      // System/context-summary events neither extend nor break the silence run.
      continue;
    }
    const m = ev as MessageEvent;

    if (
      m.systemSender === 'aurora' &&
      m.systemKind === 'core-whisper' &&
      (m.targetParticipantIds?.includes(respondingParticipantId) ?? false)
    ) {
      lastCoreWhisperIdx = i;
      mySelfTurnsAfterWhisper = 0;
      // A Core whisper isn't a turn by anyone; don't touch silenceRun.
      continue;
    }

    const visible = isVisibleConversationalTurn(m, respondingParticipantId);
    if (!visible) continue;

    const isMine =
      m.role === 'ASSISTANT' && m.participantId === respondingParticipantId;

    if (isMine) {
      mySelfTurnCount++;
      if (lastCoreWhisperIdx >= 0 && i > lastCoreWhisperIdx) {
        mySelfTurnsAfterWhisper++;
      }
      silenceRun = 0;
    } else {
      silenceRun++;
    }
  }

  // "First" covers both the literal first-turn case AND the bootstrap case
  // for chats that predate the feature — a character who has spoken many
  // times but never been offered a Core packet gets one on their next turn.
  if (lastCoreWhisperIdx < 0) return { fire: true, reason: 'first' };

  if (mySelfTurnsAfterWhisper >= interval) return { fire: true, reason: 'periodic' };

  if (silenceRun >= silenceThreshold) return { fire: true, reason: 'silence' };

  if (fireOnContextTransition) {
    const transitionIdx = findLatestContextTransitionIndex(events, respondingParticipantId);
    if (transitionIdx >= 0 && transitionIdx > lastCoreWhisperIdx) {
      return { fire: true, reason: 'context-transition' };
    }
  }

  return { fire: false, reason: null };
}
