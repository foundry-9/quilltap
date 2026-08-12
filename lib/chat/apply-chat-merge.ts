/**
 * Merge-conversation ("fold another thread in") backfill.
 *
 * When the Salon Organize sidebar's "Merge In…" button folds a second
 * conversation into the current one, the action handler calls this module to:
 *
 *   1. Add every character from the source chat that isn't already a
 *      participant of the target chat, as an LLM-controlled participant
 *      (the target keeps its own user-controlled character as the operator's
 *      voice). Each join posts a Host welcome bubble, compiles the identity
 *      stack, and applies the chosen starting outfit.
 *   2. Post a Host recap bubble at the tail of the target chat — it links back
 *      to the source chat and carries the source's rolling summary, so both the
 *      operator and the characters pick up the newcomers' thread.
 *   3. Post a reciprocal Host back-link bubble in the source chat.
 *
 * Unlike a continuation (which replays the source tail into a fresh chat), a
 * merge does NOT replay turns and does NOT touch the target's turn state — the
 * recap stands in for the history, and new participants slot into the turn
 * order naturally via `addParticipant`.
 *
 * Errors during a single character's join are logged and swallowed so one bad
 * character can't abort the whole merge; the recap and back-link are posted
 * last so we never cross-link a merge that failed to populate.
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ChatMetadata } from '@/lib/schemas/types';
import type { OutfitSelection } from '@/lib/schemas/wardrobe.types';
import {
  postHostAddAnnouncement,
  postHostMergeFromAnnouncement,
  postHostMergeToAnnouncement,
} from '@/lib/services/host-notifications/writer';
import { compileIdentityStackForParticipant } from '@/lib/services/system-prompt-compiler/compiler';
import {
  applyOutfitSelections,
  buildCheapLLMConfig,
} from '@/lib/wardrobe/apply-outfit-selections';
import { resolveProjectMountPointIds } from '@/lib/mount-index/tiered-mount-pool';

type Repos = RepositoryContainer;

export interface ApplyChatMergeParams {
  /** The receiving chat — newcomers and the recap land here. */
  targetChatId: string;
  /** The chat whose characters + summary are folded in. */
  sourceChatId: string;
  userId: string;
  /**
   * Optional allowlist of source character IDs to bring across. When provided,
   * only these characters merge in (still minus any already present and any
   * removed in the source); when omitted, every eligible source character
   * merges. Lets the operator gate the merge, not just de-duplicate.
   */
  includeCharacterIds?: string[];
  /** Per-character starting-outfit selections from the modal. */
  outfitSelections?: OutfitSelection[];
  repos: Repos;
}

export interface ApplyChatMergeResult {
  /** Character IDs actually added to the target chat. */
  mergedCharacterIds: string[];
  /** Source character IDs skipped because they were already in the target. */
  skippedAlreadyPresentCharacterIds: string[];
  /** Whether the recap bubble was posted in the target chat. */
  postedRecap: boolean;
  /** Whether the back-link bubble was posted in the source chat. */
  postedSourceBackLink: boolean;
}

/**
 * Resolve the connection profile for a freshly-merged LLM character: prefer the
 * profile they used in the source chat (if it still resolves), then the user's
 * default, then their first profile. Returns null when the user has none.
 */
async function resolveMergedProfileId(
  sourceProfileId: string | null | undefined,
  userId: string,
  repos: Repos,
): Promise<string | null> {
  if (sourceProfileId) {
    const existing = await repos.connections.findById(sourceProfileId);
    if (existing) return sourceProfileId;
  }
  const userDefault = await repos.connections.findDefault(userId);
  if (userDefault) return userDefault.id;
  const all = await repos.connections.findByUserId(userId);
  return all[0]?.id ?? null;
}

/**
 * Add the source chat's missing characters into the target chat, then post the
 * recap and back-link bubbles. See module header for the full contract.
 */
export async function applyChatMerge(
  params: ApplyChatMergeParams,
): Promise<ApplyChatMergeResult> {
  const { targetChatId, sourceChatId, userId, includeCharacterIds, outfitSelections = [], repos } = params;

  const result: ApplyChatMergeResult = {
    mergedCharacterIds: [],
    skippedAlreadyPresentCharacterIds: [],
    postedRecap: false,
    postedSourceBackLink: false,
  };

  if (targetChatId === sourceChatId) {
    logger.warn('[ChatMerge] Refusing to merge a chat into itself', { targetChatId });
    return result;
  }

  const sourceChat = await repos.chats.findById(sourceChatId);
  if (!sourceChat) {
    logger.warn('[ChatMerge] Source chat not found, skipping merge', { targetChatId, sourceChatId });
    return result;
  }

  const targetChat = await repos.chats.findById(targetChatId);
  if (!targetChat) {
    logger.error('[ChatMerge] Target chat not found, aborting merge', { targetChatId, sourceChatId });
    return result;
  }

  // Any character with a participant row in the target — regardless of status —
  // counts as "already here." Excluding removed rows too keeps us from creating
  // a duplicate participant row for a character who was previously dismissed.
  const targetCharacterIds = new Set(
    targetChat.participants
      .filter((p) => p.type === 'CHARACTER' && p.characterId)
      .map((p) => p.characterId as string),
  );

  // Optional operator allowlist: when provided, only these source characters
  // come across. Empty/undefined → no gate (every eligible character merges).
  const allowSet =
    includeCharacterIds && includeCharacterIds.length > 0 ? new Set(includeCharacterIds) : null;

  // Incoming = source CHARACTER participants that are present (not removed),
  // not already in the target, allowed by the operator's gate (if any),
  // de-duplicated by characterId, source order preserved. User-controlled
  // source characters are brought in as LLM-driven.
  const seen = new Set<string>();
  const incoming = sourceChat.participants.filter((p) => {
    if (p.type !== 'CHARACTER' || !p.characterId) return false;
    if (p.status === 'removed') return false;
    const cid = p.characterId;
    if (targetCharacterIds.has(cid)) {
      if (!result.skippedAlreadyPresentCharacterIds.includes(cid)) {
        result.skippedAlreadyPresentCharacterIds.push(cid);
      }
      return false;
    }
    if (allowSet && !allowSet.has(cid)) return false; // operator excluded this one
    if (seen.has(cid)) return false;
    seen.add(cid);
    return true;
  });

  const chatSettings = await repos.chatSettings.findByUserId(userId);
  const cheapLLMConfig = buildCheapLLMConfig(chatSettings);

  // Project wardrobe tier for the target chat. Hoisted out of the per-character
  // loop — it's the same for every merged character.
  const projectMountPointIds = await resolveProjectMountPointIds(targetChat.projectId ?? null);

  // Character tags to fold into the chat's tag set, mirroring the add-character
  // flow (handleAddParticipant) so merged characters surface under the chat's
  // tags too. Applied once after all joins.
  const tagsToMerge = new Set<string>();

  let displayOrder = targetChat.participants.filter((p) => p.status !== 'removed').length;

  for (const sourceParticipant of incoming) {
    const characterId = sourceParticipant.characterId as string;
    try {
      const character = await repos.characters.findById(characterId);
      if (!character) {
        logger.warn('[ChatMerge] Source character not found, skipping', { sourceChatId, characterId });
        continue;
      }

      const connectionProfileId = await resolveMergedProfileId(
        sourceParticipant.connectionProfileId,
        userId,
        repos,
      );

      const updatedChat = await repos.chats.addParticipant(targetChatId, {
        type: 'CHARACTER',
        characterId,
        controlledBy: 'llm',
        connectionProfileId,
        imageProfileId: null,
        displayOrder,
        isActive: true,
        status: 'active',
        hasHistoryAccess: false,
        joinScenario: null,
      });
      if (!updatedChat) {
        logger.error('[ChatMerge] Failed to add merged participant', { targetChatId, characterId });
        continue;
      }
      displayOrder += 1;

      const newParticipant = updatedChat.participants.find(
        (p) => p.type === 'CHARACTER' && p.characterId === characterId && p.status !== 'removed',
      );
      if (!newParticipant) {
        logger.error('[ChatMerge] Added participant not found after insert', { targetChatId, characterId });
        continue;
      }

      result.mergedCharacterIds.push(characterId);
      for (const tagId of character.tags ?? []) tagsToMerge.add(tagId);

      // Host welcome bubble — same announcement the add-participant action posts.
      await postHostAddAnnouncement({
        chatId: targetChatId,
        character,
        participantId: newParticipant.id,
        initialStatus: newParticipant.status,
      });

      try {
        await compileIdentityStackForParticipant(updatedChat, newParticipant.id);
      } catch (error) {
        logger.warn('[ChatMerge] Failed to compile identity stack for merged participant', {
          targetChatId,
          participantId: newParticipant.id,
          error: getErrorMessage(error),
        });
      }

      // Apply the chosen starting outfit. Default to "Same as last conversation"
      // (`previous_chat`, sourced from the merged chat) when the modal sent
      // nothing for this character — that's the merge's natural intent.
      const selection: OutfitSelection =
        outfitSelections.find((s) => s.characterId === characterId) ?? {
          characterId,
          mode: 'previous_chat',
        };
      try {
        await applyOutfitSelections(targetChatId, [selection], repos, {
          userId,
          projectMountPointIds,
          scenarioText: targetChat.scenarioText ?? null,
          cheapLLMConfig,
          sourceChatId,
        });
      } catch (error) {
        logger.error('[ChatMerge] Failed to apply outfit for merged participant', {
          targetChatId,
          characterId,
          mode: selection.mode,
          error: getErrorMessage(error),
        });
      }

      logger.info('[ChatMerge] Merged character into chat', {
        targetChatId,
        sourceChatId,
        characterId,
        participantId: newParticipant.id,
        outfitMode: selection.mode,
      });
    } catch (error) {
      logger.error('[ChatMerge] Failed to merge character', {
        targetChatId,
        sourceChatId,
        characterId,
        error: getErrorMessage(error),
      });
    }
  }

  // Fold merged characters' tags into the chat's tag set (one update).
  if (tagsToMerge.size > 0) {
    try {
      const refreshed = await repos.chats.findById(targetChatId);
      const existing = new Set(refreshed?.tags ?? []);
      const merged = [...existing];
      for (const tagId of tagsToMerge) {
        if (!existing.has(tagId)) merged.push(tagId);
      }
      if (merged.length !== existing.size) {
        await repos.chats.update(targetChatId, { tags: merged });
      }
    } catch (error) {
      logger.warn('[ChatMerge] Failed to merge character tags into chat', {
        targetChatId,
        error: getErrorMessage(error),
      });
    }
  }

  // Recap + back-link only when at least one character actually came across —
  // a no-op merge (everyone already present, or every join failed) leaves no
  // orphan bubbles in either chat.
  if (result.mergedCharacterIds.length > 0) {
    // Recap bubble in the target — posted after the joins so it lands at the
    // tail (the latest point in the conversation).
    try {
      const recap = await postHostMergeFromAnnouncement({
        chatId: targetChatId,
        sourceChatId,
        sourceTitle: sourceChat.title ?? null,
        summaryText: sourceChat.contextSummary ?? null,
      });
      result.postedRecap = recap !== null;
    } catch (error) {
      logger.error('[ChatMerge] Failed to post merge recap bubble', {
        targetChatId,
        sourceChatId,
        error: getErrorMessage(error),
      });
    }

    // Back-link bubble in the source chat — last, so we never link from a chat
    // we failed to populate.
    try {
      const backLink = await postHostMergeToAnnouncement({
        chatId: sourceChatId,
        targetChatId,
        targetTitle: targetChat.title ?? null,
      });
      result.postedSourceBackLink = backLink !== null;
    } catch (error) {
      logger.error('[ChatMerge] Failed to post source back-link bubble', {
        targetChatId,
        sourceChatId,
        error: getErrorMessage(error),
      });
    }
  }

  logger.info('[ChatMerge] Merge complete', {
    targetChatId,
    sourceChatId,
    mergedCount: result.mergedCharacterIds.length,
    skippedAlreadyPresentCount: result.skippedAlreadyPresentCharacterIds.length,
    postedRecap: result.postedRecap,
    postedSourceBackLink: result.postedSourceBackLink,
  });

  return result;
}
