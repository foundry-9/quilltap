/**
 * Fold-triggered relevant-conversations refresh.
 *
 * Relevance drifts as a conversation advances, so beyond the once-per-recap
 * injection (chat-start / character-join) we re-run *only* the
 * relevant-past-conversations search whenever a summary fold lands, and post a
 * standalone Commonplace Book whisper carrying the freshened list to each
 * present character.
 *
 * The whisper uses the dedicated `relevant-conversations` kind, which is exempt
 * from both the per-turn consolidated-whisper sweep and the LLM-context strip,
 * so it persists across turns (until the next fold replaces it) and reaches the
 * responding character. It carries a persona `content` (for the salon UI) and a
 * persona-free `opaqueContent` (for opaque characters' LLM context), mirroring
 * the existing Staff-whisper split.
 *
 * Best-effort: it never throws into the fold. When run inside the forked job
 * child, the vault reads pass through and the message writes buffer back to the
 * parent like every other fold write.
 *
 * @module services/commonplace-notifications/relevant-conversations-refresh
 */

import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { isParticipantPresent, type MessageEvent } from '@/lib/schemas/types';
import { rampLimit } from '@/lib/memory/memory-recap';
import {
  searchVaultConversationSummaries,
  renderRelevantConversationsBlock,
  READ_CONVERSATION_CALL_NOTE,
  RELEVANT_CONVERSATIONS_MIN,
  RELEVANT_CONVERSATIONS_MAX,
  RELEVANT_CONVERSATIONS_RAMP_MIN_TOKENS,
  RELEVANT_CONVERSATIONS_RAMP_MAX_TOKENS,
} from '@/lib/memory/conversation-summary-search';
import {
  buildCommonplacePersonaWhisper,
  buildCommonplaceLLMContext,
  postCommonplaceWhisper,
} from './writer';

export interface RefreshRelevantConversationsInput {
  chatId: string;
  /** The fresh fold summary — the query that drives the relevance search. */
  summary: string;
  userId: string;
  /** Embedding profile for the relevance search. */
  embeddingProfileId?: string | null;
  /** Connection-profile maxContext, scales the list size (3→10 over 4K→32K). */
  maxContext?: number | null;
}

/**
 * For each present, LLM-controlled character in the chat, re-run the
 * relevant-past-conversations search against the fresh fold summary and post a
 * refreshed `relevant-conversations` whisper, sweeping the character's prior one.
 */
export async function refreshRelevantConversationsOnFold(
  input: RefreshRelevantConversationsInput,
): Promise<void> {
  const { chatId, summary, userId, embeddingProfileId, maxContext } = input;
  const query = summary?.trim();
  if (!query) return;

  try {
    const repos = getRepositories();
    const chat = await repos.chats.findById(chatId);
    if (!chat) return;

    // Present, LLM-controlled participants are the ones whose recall whisper
    // feeds a real turn. (User-controlled characters are played by the human.)
    const presentParticipants = chat.participants.filter(
      p => isParticipantPresent(p.status) && p.controlledBy !== 'user' && p.characterId,
    );
    if (presentParticipants.length === 0) return;

    // Match the consolidated whisper's targeting: untargeted (public) in a
    // single-present-character chat, targeted per participant otherwise.
    const isMultiCharacter = presentParticipants.length > 1;
    const limit = rampLimit(
      maxContext,
      RELEVANT_CONVERSATIONS_MIN,
      RELEVANT_CONVERSATIONS_MAX,
      RELEVANT_CONVERSATIONS_RAMP_MIN_TOKENS,
      RELEVANT_CONVERSATIONS_RAMP_MAX_TOKENS,
    );

    for (const participant of presentParticipants) {
      try {
        const matches = await searchVaultConversationSummaries({
          characterId: participant.characterId,
          query,
          userId,
          embeddingProfileId,
          limit,
          excludeConversationId: chatId,
        });
        if (matches.length === 0) continue;

        const block = `${renderRelevantConversationsBlock(matches)}\n\n${READ_CONVERSATION_CALL_NOTE}`;
        const personaContent = buildCommonplacePersonaWhisper({ relevantConversations: block });
        const llmContent = buildCommonplaceLLMContext({ relevantConversations: block });
        if (!personaContent) continue;

        const targetParticipantId = isMultiCharacter ? participant.id : null;
        const posted = await postCommonplaceWhisper({
          chatId,
          targetParticipantId,
          content: personaContent,
          opaqueContent: llmContent,
          kind: 'relevant-conversations',
        });
        if (!posted) continue;

        // Sweep the character's prior relevant-conversations whisper(s) so only
        // the freshest one survives.
        await sweepPriorRelevantConversationWhispers(chatId, posted.id, targetParticipantId);
      } catch (perCharacterError) {
        logger.warn('[RelevantConversationsRefresh] Failed for a participant', {
          context: 'commonplace-notifications.relevant-conversations-refresh',
          chatId,
          characterId: participant.characterId,
          error: getErrorMessage(perCharacterError),
        });
      }
    }
  } catch (error) {
    logger.warn('[RelevantConversationsRefresh] Refresh failed', {
      context: 'commonplace-notifications.relevant-conversations-refresh',
      chatId,
      error: getErrorMessage(error),
    });
  }
}

/**
 * Remove every prior `relevant-conversations` whisper for the same target,
 * leaving the just-posted one (`keepId`). Matched on the same target scope the
 * consolidated sweep uses (null → untargeted; otherwise includes the target id).
 */
async function sweepPriorRelevantConversationWhispers(
  chatId: string,
  keepId: string,
  targetParticipantId: string | null,
): Promise<void> {
  try {
    const repos = getRepositories();
    const messages = await repos.chats.getMessages(chatId);
    const stale = messages
      .filter((m): m is MessageEvent => m.type === 'message')
      .filter(
        m =>
          m.systemSender === 'commonplaceBook' &&
          m.systemKind === 'relevant-conversations' &&
          m.id !== keepId,
      )
      .filter(m => {
        const ids = m.targetParticipantIds;
        if (targetParticipantId === null) return ids === null || ids === undefined;
        return Array.isArray(ids) && ids.includes(targetParticipantId);
      })
      .map(m => m.id);

    if (stale.length > 0) {
      await repos.chats.deleteMessagesByIds(chatId, stale);
    }
  } catch (error) {
    logger.warn('[RelevantConversationsRefresh] Failed to sweep prior whispers', {
      context: 'commonplace-notifications.relevant-conversations-refresh',
      chatId,
      targetParticipantId,
      error: getErrorMessage(error),
    });
  }
}
