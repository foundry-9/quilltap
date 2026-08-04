/**
 * Writer for Commonplace Book chat whispers.
 *
 * The Commonplace Book is the personified memory system. When a character is
 * about to take a turn, what they "remember" — narrative recap, relevant
 * memories, inter-character memories — used to be spliced into the system
 * prompt. We now hand that material to the Commonplace Book to whisper into
 * the conversation as a targeted ASSISTANT-role message that only the
 * responding character can see.
 *
 * Targeting is via `targetParticipantIds`: a single participant ID = private
 * to that character + sender. `null` would be public, but Commonplace Book
 * whispers are always private — they're recall, not announcement.
 *
 * Errors never propagate — turn processing must never fail because a memory
 * whisper couldn't be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { MessageEvent } from '@/lib/schemas/types';

export type CommonplaceWhisperKind =
  | 'memory-recap'
  | 'relevant-memories'
  | 'inter-character-memories'
  | 'consolidated'
  /**
   * Standalone refresh of the relevant-past-conversations list, posted on each
   * summary fold (relevance drifts as the conversation advances). Unlike the
   * per-turn `consolidated` whisper — recomputed and inlined every turn, and
   * stripped from LLM context — this kind PERSISTS across turns (until the next
   * fold replaces it) and is intentionally exempt from the consolidated sweep
   * and the LLM-context strip, so the freshened list reaches both the salon UI
   * and the responding character.
   */
  | 'relevant-conversations'
  /**
   * Recall-on-reference (fourth cadence): a scoped, dated mini-recap posted on
   * a RETROSPECTIVE turn — the user referenced past shared events, so the
   * Commonplace Book surfaces the relevant past conversations with dates and
   * `read_conversation` UUIDs. Turn-specific: swept by the same sweep as the
   * consolidated whisper (unlike `relevant-conversations`).
   */
  | 'retrospective-recall';

/**
 * Memory content parts for a single turn's recall. Each section is the raw
 * formatted text computed by the memory injector (with its existing markdown
 * headers like `## Relevant Memories`).
 */
export interface CommonplaceParts {
  /** Snapshot of the chat's present moment (location, who is here, what they
   * are doing, what they are wearing, and the announced time when applicable).
   * Rendered ahead of memory sections — the speaker takes stock of *now*
   * before recalling. */
  currentState?: string;
  /** Narrative recap of what the character remembers (chat start / character join only). */
  recap?: string;
  /** Semantic-search results that bear on the current moment. */
  relevant?: string;
  /** Memories about other present characters (multi-character chats only). */
  interChar?: string;
  /**
   * Material drawn from the responding character's own knowledge base —
   * files in their vault's `Knowledge/` folder, packed inline when the
   * body is small enough or summarised as `doc_read_file` pointers
   * otherwise. Independent of the memory sections.
   */
  knowledge?: string;
  /**
   * The relevant-past-conversations list (already rendered as a markdown block
   * with its `read_conversation` call note). Used by the fold-triggered refresh
   * whisper; the per-turn consolidated whisper leaves this empty (its
   * conversation lists ride inside `recap` at chat-start / character-join).
   */
  relevantConversations?: string;
  /**
   * Retrospective mini-recap (recall-on-reference): the dated, drillable
   * conversation list emitted when the turn references past shared events.
   * Rides in the LLM recall text and in its own `retrospective-recall`
   * whisper — never inside the consolidated whisper body.
   */
  retrospectiveRecall?: string;
}

/**
 * Build the persona-voiced consolidated whisper for the chat transcript / UI.
 * The Commonplace Book speaks once, bundling whichever sections are non-empty.
 */
export function buildCommonplacePersonaWhisper(parts: CommonplaceParts): string {
  const sections: string[] = [];
  const currentState = parts.currentState?.trim();
  const recap = parts.recap?.trim();
  const relevant = parts.relevant?.trim();
  const interChar = parts.interChar?.trim();
  const knowledge = parts.knowledge?.trim();
  const relevantConversations = parts.relevantConversations?.trim();
  const retrospectiveRecall = parts.retrospectiveRecall?.trim();

  if (currentState) {
    sections.push(
      `The Commonplace Book sets its memories aside for a moment to take stock of where you stand:\n\n${currentState}`,
    );
  }
  if (recap) {
    sections.push(
      `The Commonplace Book lays open at your bookmark; here is the gist of what you have noted so far:\n\n${recap}`,
    );
  }
  if (relevant) {
    sections.push(
      `The Commonplace Book turns to the entries that bear on this moment.\n\n${relevant}`,
    );
  }
  if (interChar) {
    sections.push(
      `The Commonplace Book opens to the pages where you have noted those present.\n\n${interChar}`,
    );
  }
  if (knowledge) {
    sections.push(
      `The Commonplace Book pulls down volumes from your own shelves — the references and reckonings you yourself have curated:\n\n${knowledge}`,
    );
  }
  if (relevantConversations) {
    sections.push(
      `The conversation has wandered on, and the Commonplace Book re-marks the past dialogues that now bear on the present:\n\n${relevantConversations}`,
    );
  }
  if (retrospectiveRecall) {
    sections.push(
      `You speak of days gone by, and the Commonplace Book obligingly riffles back through its dated pages:\n\n${retrospectiveRecall}`,
    );
  }
  return sections.join('\n\n').trim();
}

/**
 * Build the plain second-person framing for the LLM context. No Staff persona
 * — just direct "you remember" prompts so the model receives recall as a
 * clean instruction rather than a meta-narrative.
 */
export function buildCommonplaceLLMContext(parts: CommonplaceParts): string {
  const sections: string[] = [];
  const currentState = parts.currentState?.trim();
  const recap = parts.recap?.trim();
  const relevant = parts.relevant?.trim();
  const interChar = parts.interChar?.trim();
  const knowledge = parts.knowledge?.trim();
  const relevantConversations = parts.relevantConversations?.trim();
  const retrospectiveRecall = parts.retrospectiveRecall?.trim();

  if (currentState) {
    sections.push(`Here is the present state of the scene:\n\n${currentState}`);
  }
  if (recap) {
    sections.push(`You remember the gist of what has happened so far:\n\n${recap}`);
  }
  if (relevant) {
    sections.push(`You remember the following entries that bear on this moment:\n\n${relevant}`);
  }
  if (interChar) {
    sections.push(`You also recall about the others present:\n\n${interChar}`);
  }
  if (knowledge) {
    sections.push(`You also recall the following from your knowledge base:\n\n${knowledge}`);
  }
  if (relevantConversations) {
    sections.push(`You also recall these past conversations that bear on the present:\n\n${relevantConversations}`);
  }
  if (retrospectiveRecall) {
    sections.push(`The past is being referenced — these past conversations cover the period in question:\n\n${retrospectiveRecall}`);
  }
  return sections.join('\n\n').trim();
}

interface PostParams {
  chatId: string;
  /** Participant ID of the character this whisper is targeted at, if any. Null/undefined = public. */
  targetParticipantId?: string | null;
  /** Pre-formatted body text. The persona voicing is the caller's responsibility. */
  content: string;
  /**
   * Persona-free body swapped into opaque characters' LLM context (paired with
   * `content` exactly as other Staff writers do). Omit for whispers that are
   * stripped from LLM context anyway (the per-turn consolidated whisper).
   */
  opaqueContent?: string | null;
  kind: CommonplaceWhisperKind;
}

export async function postCommonplaceWhisper(
  params: PostParams,
): Promise<MessageEvent | null> {
  const { chatId, targetParticipantId, content, opaqueContent, kind } = params;

  if (!content || content.trim().length === 0) {
    return null;
  }

  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      opaqueContent: opaqueContent ?? null,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'commonplaceBook',
      systemKind: kind,
      targetParticipantIds: targetParticipantId ? [targetParticipantId] : null,
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[CommonplaceWhisper] Whisper posted', {
      context: 'commonplace-notifications',
      chatId,
      messageId,
      kind,
      targetParticipantId,
      contentLength: content.length,
    });

    return message;
  } catch (error) {
    logger.error('[CommonplaceWhisper] Failed to post whisper', {
      context: 'commonplace-notifications',
      chatId,
      kind,
      targetParticipantId,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}
