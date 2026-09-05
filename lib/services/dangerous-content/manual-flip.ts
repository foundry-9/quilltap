/**
 * Manual Concierge state transitions.
 *
 * The Salon sidebar exposes a four-state per-chat Concierge control. This
 * module is the single chokepoint that translates the requested UI state
 * into the right combination of database writes and synthetic Concierge
 * announcements, so the PUT handler doesn't have to know the rules.
 *
 * State mapping (UI → storage):
 *   - 'monitored'  → conciergeOverride = NULL, isDangerousChat = false
 *   - 'flagged'    → conciergeOverride = NULL, isDangerousChat = true
 *   - 'vouched'    → conciergeOverride = 'OFF', isDangerousChat preserved
 *   - 'uncensored' → conciergeOverride = 'UNCENSORED', isDangerousChat preserved
 *
 * Every transition posts a brief Concierge bubble into the chat so the
 * history remains honest about which mode was in effect when.
 */

import type { ChatMetadata } from '@/lib/schemas/types';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { postConciergeManualAnnouncement } from '@/lib/services/concierge-notifications/writer';
import { getConciergeState, type ConciergeState } from '@/lib/services/dangerous-content/chat-override';

const logger = createServiceLogger('ConciergeManualFlip');

/** @deprecated alias kept for callers; the canonical type is `ConciergeState`. */
export type ConciergeUIState = ConciergeState;

/**
 * Compute the current UI state from the stored fields. Thin alias over the
 * canonical {@link getConciergeState} so the derivation lives in exactly one
 * place; this writer module is allowed to also read the raw fields below.
 */
export const currentConciergeState = getConciergeState;

export interface ApplyConciergeFlipResult {
  /** The state requested by the caller, after normalization. */
  newState: ConciergeUIState;
  /** Whether anything actually changed (false on no-op requests). */
  changed: boolean;
}

/**
 * Apply a manual state change for a chat.
 *
 * - Persists the new combination of `conciergeOverride` and `isDangerousChat`.
 * - Resets classifier metadata when returning to Monitored so the scheduled
 *   scanner can re-evaluate on the next user message.
 * - Posts a synthetic Concierge announcement that reflects the actual
 *   transition (returning to Monitored from an operator state announces the
 *   Concierge's return; a plain Flagged → Monitored announces the all-clear).
 * - Is a no-op when the requested state already matches the stored one.
 */
export async function applyConciergeFlip(
  chatId: string,
  requested: ConciergeUIState,
  chat: ChatMetadata,
): Promise<ApplyConciergeFlipResult> {
  const current = currentConciergeState(chat);
  if (current === requested) {
    return { newState: requested, changed: false };
  }

  const repos = getRepositories();
  const now = new Date().toISOString();

  switch (requested) {
    case 'flagged': {
      // The operator is manually marking this chat dangerous. Stamp the
      // classification metadata so the sticky-true rule kicks in and the
      // background scanner leaves it alone.
      await repos.chats.update(chatId, {
        conciergeOverride: null,
        isDangerousChat: true,
        dangerScore: null,
        dangerCategories: [],
        dangerClassifiedAt: now,
        dangerClassifiedAtMessageCount: chat.messageCount ?? 0,
      });
      await postConciergeManualAnnouncement({ chatId, kind: 'manual-flagged' });
      break;
    }
    case 'monitored': {
      // Returning to Monitored from Flagged or from an operator state.
      // Clearing the classification metadata lets the scheduled scan
      // re-evaluate on the next user message — the user wants future
      // moderation to behave as if we'd never settled the question.
      await repos.chats.update(chatId, {
        conciergeOverride: null,
        isDangerousChat: false,
        dangerScore: null,
        dangerCategories: [],
        dangerClassifiedAt: null,
        dangerClassifiedAtMessageCount: null,
      });
      const kind = current === 'vouched' || current === 'uncensored'
        ? 'manual-resumed'
        : 'manual-safe';
      await postConciergeManualAnnouncement({ chatId, kind });
      break;
    }
    case 'vouched': {
      // Vouched Safe preserves the prior isDangerousChat so the operator can
      // return to Monitored or Flagged later and pick up where they were.
      await repos.chats.update(chatId, {
        conciergeOverride: 'OFF',
      });
      await postConciergeManualAnnouncement({ chatId, kind: 'manual-vouched' });
      break;
    }
    case 'uncensored': {
      // Uncensored likewise preserves isDangerousChat, so returning to
      // Monitored re-enters the classifier cleanly.
      await repos.chats.update(chatId, {
        conciergeOverride: 'UNCENSORED',
      });
      await postConciergeManualAnnouncement({ chatId, kind: 'manual-uncensored' });
      break;
    }
  }

  logger.info('Concierge state flipped manually', {
    chatId,
    from: current,
    to: requested,
  });

  return { newState: requested, changed: true };
}
