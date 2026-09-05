/**
 * Writer for Concierge chat notifications.
 *
 * When the gatekeeper classifies a chat as dangerous, this helper injects a
 * synthetic ASSISTANT-role chat message announcing the Concierge's quiet
 * intervention. Characters at the table see — through the avatar of the
 * Concierge, in discreet language — that the conversation has been marked
 * for handling by more appropriate providers.
 *
 * Errors never propagate — the danger-classification job must never fail
 * because an announcement couldn't be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { CATEGORY_LABELS } from '@/lib/services/dangerous-content/gatekeeper.service';
import type { MessageEvent } from '@/lib/schemas/types';

export interface ConciergeDangerDetails {
  /** Overall danger score (0-1) returned by the classifier. */
  score: number;
  /** Threshold at which the classifier flips to "dangerous." */
  threshold: number;
  /** Per-category breakdown from the classifier. */
  categories: Array<{ category: string; score: number; label?: string }>;
  /** 'moderation' for a dedicated moderation provider; 'llm' for the cheap-LLM fallback. */
  source?: 'moderation' | 'llm';
  /** Provider that performed the classification (e.g. 'OPENAI'). */
  providerName?: string;
}

export interface ConciergeDangerAnnouncement {
  chatId: string;
  details?: ConciergeDangerDetails;
}

interface RankedCategory {
  category: string;
  score: number;
  label: string;
}

function rankCategories(details: ConciergeDangerDetails): RankedCategory[] {
  const named: RankedCategory[] = details.categories.map(c => ({
    category: c.category,
    score: c.score,
    label: CATEGORY_LABELS[c.category] || c.label || c.category,
  }));

  const crossing = named.filter(c => c.score >= details.threshold);
  const ranked = (crossing.length > 0 ? crossing : named)
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return ranked;
}

function formatCategoryPhrase(categories: RankedCategory[], scoreWord: string): string {
  if (categories.length === 0) return '';
  if (categories.length === 1) {
    const c = categories[0];
    return `${c.label} (${scoreWord} ${c.score.toFixed(2)})`;
  }
  const head = categories.slice(0, -1).map(c => `${c.label} (${scoreWord} ${c.score.toFixed(2)})`).join(', ');
  const tail = categories[categories.length - 1];
  return `${head} and ${tail.label} (${scoreWord} ${tail.score.toFixed(2)})`;
}

/**
 * Bare noun phrase naming the classifier that rendered the verdict, e.g.
 * "the house's OPENAI moderation assayer" or "the cheap-LLM assayer, OPENAI".
 * Returns '' when no provider is known.
 */
function assayerNounPhrase(details: ConciergeDangerDetails): string {
  if (!details.providerName) return '';
  return details.source === 'moderation'
    ? `the house's ${details.providerName} moderation assayer`
    : `the cheap-LLM assayer, ${details.providerName}`;
}

function formatAssayer(details: ConciergeDangerDetails): string {
  const noun = assayerNounPhrase(details);
  return noun ? ` (per ${noun})` : '';
}

export function buildDangerContent(details?: ConciergeDangerDetails): string {
  const opener =
    "The Concierge, with his customary discretion, has stepped quietly to the table.";
  const closer =
    "He has arranged for the present conversation — and any adjunct errands it may occasion — " +
    "to be entrusted to a desk better appointed to subjects of its particular character. " +
    "No interruption is required; pray continue at your leisure.";

  if (!details) {
    return `${opener} ${closer}`;
  }

  const ranked = rankCategories(details);
  const phrase = formatCategoryPhrase(ranked, 'severity');
  const overall = details.score.toFixed(2);
  const threshold = details.threshold.toFixed(2);
  const assayer = formatAssayer(details);

  // When the overall severity actually meets the threshold, the arithmetic
  // itself drew the line. When it does not, the classifier flagged the matter
  // of its own accord (e.g. OpenAI's moderation endpoint returning `flagged`
  // against its own catalogue, independent of our numeric threshold) — so say
  // so plainly, and offer the severities as informational rather than decisive.
  const crossedThreshold = details.score >= details.threshold;

  let specifics: string;
  if (crossedThreshold) {
    specifics = phrase
      ? `The matter that drew his eye: ${phrase} — together registering ${overall} against the present threshold of ${threshold}${assayer}.`
      : `The matter, on close inspection, registered ${overall} against the present threshold of ${threshold}${assayer}.`;
  } else {
    const verdictBy = assayerNounPhrase(details) || 'the house assayer';
    specifics = phrase
      ? `The matter was marked by the direct verdict of ${verdictBy}: ${phrase}. The severities themselves stayed shy of the present threshold of ${threshold} (the highest reading ${overall}) — it was the assayer's own judgement, not the tally, that drew his eye.`
      : `The matter was marked by the direct verdict of ${verdictBy}, the severities notwithstanding — they stayed shy of the present threshold of ${threshold} (registering ${overall}).`;
  }

  return `${opener} ${specifics} ${closer}`;
}

export function buildDangerOpaqueContent(details?: ConciergeDangerDetails): string {
  const opener =
    "Content advisory: the present conversation — and any adjunct operations it occasions — " +
    "has been routed to a provider better suited to subjects of its particular character.";
  const closer = "No interruption is required; proceed at your leisure.";

  if (!details) {
    return `${opener} ${closer}`;
  }

  const ranked = rankCategories(details);
  const triggers = formatCategoryPhrase(ranked, 'score');
  const overall = details.score.toFixed(2);
  const threshold = details.threshold.toFixed(2);
  const providerVia = details.providerName
    ? `${details.providerName} (${details.source === 'moderation' ? 'moderation endpoint' : 'cheap-LLM fallback'})`
    : 'the classifier';
  const crossedThreshold = details.score >= details.threshold;

  let specifics: string;
  if (crossedThreshold) {
    const via = details.providerName ? ` Classified by ${providerVia}.` : '';
    specifics = triggers
      ? `Triggers: ${triggers}. Overall score ${overall} against threshold ${threshold}.${via}`
      : `Overall score ${overall} against threshold ${threshold}.${via}`;
  } else {
    // Flagged by the classifier itself, below the numeric threshold. Report the
    // scores for context but make clear they did not drive the decision.
    specifics = triggers
      ? `Flagged directly by ${providerVia}, below the numeric threshold. Triggers: ${triggers}. Highest score ${overall}, threshold ${threshold} (not reached).`
      : `Flagged directly by ${providerVia}, below the numeric threshold. Overall score ${overall}, threshold ${threshold} (not reached).`;
  }

  return `${opener} ${specifics} ${closer}`;
}

/**
 * Manual-transition announcements. These mirror the auto-classification
 * variant above but speak to operator-driven flips of the per-chat
 * Concierge state. They never include classifier details (because there was
 * no classification) and never honor an opaque audience — the operator is
 * announcing their own choice, in their own voice, through the Concierge.
 */
export type ConciergeManualKind =
  | 'manual-flagged'      // -> Flagged (the operator flipped the switch themselves)
  | 'manual-safe'         // Flagged -> Monitored (the operator says all clear)
  | 'manual-vouched'      // anything -> Vouched Safe (operator vouches; the Concierge stops watching)
  | 'manual-resumed'      // Vouched/Uncensored -> Monitored (operator calls the Concierge back)
  | 'manual-uncensored';  // anything -> Uncensored (operator opens the uncensored door themselves)

function buildManualContent(kind: ConciergeManualKind): string {
  switch (kind) {
    case 'manual-flagged':
      return "By the operator's own hand, the Concierge has thrown the switch: the conversation is to be entrusted henceforth to a desk better appointed to subjects of its particular character. Pray continue at your leisure.";
    case 'manual-safe':
      return "By the operator's own hand, the Concierge stands down for the moment. Routine arrangements are restored; he shall, of course, return to his post should the matter again take a turn.";
    case 'manual-vouched':
      return "The operator has vouched for the present company, and the Concierge, satisfied, takes the afternoon off. No moderation, no rerouting, no quiet interventions; the ordinary desks remain in service, on the operator's own recognizance.";
    case 'manual-resumed':
      return "The Concierge returns to his post. Customary watch is resumed; the present arrangements are once again subject to his discreet attentions.";
    case 'manual-uncensored':
      return "By the operator's own hand, the Concierge has been sent away and the uncensored door stands open. Nothing is to be examined, nothing softened; the conversation and its errands go henceforth to the frank desk, entirely on the operator's own recognizance.";
  }
}

function buildManualOpaqueContent(kind: ConciergeManualKind): string {
  switch (kind) {
    case 'manual-flagged':
      return 'Operator advisory: this conversation has been manually marked for handling by an uncensored provider. Subsequent traffic may be routed accordingly.';
    case 'manual-safe':
      return 'Operator advisory: the prior dangerous-content mark has been manually cleared. Standard routing is restored.';
    case 'manual-vouched':
      return 'Operator advisory: moderation is disabled for this conversation. No classification, scanning, or provider rerouting will run on the operator’s behalf. Ordinary providers still apply.';
    case 'manual-resumed':
      return 'Operator advisory: standard moderation is restored for this conversation.';
    case 'manual-uncensored':
      return 'Operator advisory: this conversation has been manually routed to the uncensored providers. No classification or scanning will run; prompts go out unaltered.';
  }
}

export interface ConciergeManualAnnouncement {
  chatId: string;
  kind: ConciergeManualKind;
}

export async function postConciergeManualAnnouncement(
  params: ConciergeManualAnnouncement,
): Promise<MessageEvent | null> {
  const { chatId, kind } = params;
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();
    const content = buildManualContent(kind);
    const opaqueContent = buildManualOpaqueContent(kind);

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      opaqueContent,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'concierge',
      systemKind: 'danger',
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[ConciergeNotification] Manual transition announced', {
      context: 'concierge-notifications',
      chatId,
      messageId,
      kind,
    });

    return message;
  } catch (error) {
    logger.error('[ConciergeNotification] Failed to post manual announcement', {
      context: 'concierge-notifications',
      chatId,
      kind,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

export async function postConciergeDangerAnnouncement(
  params: ConciergeDangerAnnouncement,
): Promise<MessageEvent | null> {
  const { chatId, details } = params;
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();
    const content = buildDangerContent(details);
    const opaqueContent = buildDangerOpaqueContent(details);

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      opaqueContent,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'concierge',
      systemKind: 'danger',
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[ConciergeNotification] Danger announcement posted', {
      context: 'concierge-notifications',
      chatId,
      messageId,
      score: details?.score,
      threshold: details?.threshold,
      categories: details?.categories.map(c => c.category),
      source: details?.source,
      providerName: details?.providerName,
    });

    return message;
  } catch (error) {
    logger.error('[ConciergeNotification] Failed to post danger announcement', {
      context: 'concierge-notifications',
      chatId,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}
