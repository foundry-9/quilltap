/**
 * Archive Wardrobe Item Tool Handler
 *
 * Soft-retires a wardrobe item via `WardrobeRepository.archive` (sets
 * `archivedAt`). Never hard-deletes — restoring is a human-only UI action.
 * Resolves the target across all (non-group) tiers to LOCATE it, then enforces
 * own-items-only: shared archetypes (project / Quilltap General) are read-only
 * and the call is refused.
 *
 * If the archived item was currently equipped, the Aurora announcement + avatar
 * generation fire so the visible outfit refreshes (archive does not itself
 * remove the item from equipped slots — it stays worn until taken off).
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeArchiveToolInput, WardrobeArchiveToolOutput } from '../wardrobe-archive-tool';
import { validateWardrobeArchiveInput } from '../wardrobe-archive-tool';
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import { resolveProjectMountPointIdsForChat } from '@/lib/mount-index/tiered-mount-pool';
import {
  isOwnWardrobeItem,
  normalizeNoItemSentinel,
  notifyWardrobeChanged,
  resolveWardrobeItemAcrossTiers,
  wardrobeItemNotFoundMessage,
} from './wardrobe-handler-shared';

export interface WardrobeArchiveToolContext {
  userId: string;
  chatId: string;
  characterId: string;
  /** Per-turn announcement queue. Forwarded from `ToolExecutionContext`. */
  pendingWardrobeAnnouncements?: Set<string>;
}

function buildFailureResponse(error: string): WardrobeArchiveToolOutput {
  return { success: false, item_id: '', title: '', action: 'archived', error };
}

export async function executeWardrobeArchiveTool(
  input: unknown,
  context: WardrobeArchiveToolContext,
): Promise<WardrobeArchiveToolOutput> {
  const repos = getRepositories();

  const parsed = validateWardrobeArchiveInput(input);

  if (!parsed) {
    logger.warn('Wardrobe archive tool validation failed', {
      context: 'wardrobe-archive-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      input,
    });
    return buildFailureResponse('Invalid input: item_id or item_title is required.');
  }

  try {
    const { item_id, item_title } = parsed;
    const projectMountPointIds = await resolveProjectMountPointIdsForChat(context.chatId);

    const item = await resolveWardrobeItemAcrossTiers(
      repos,
      context.characterId,
      normalizeNoItemSentinel(item_id),
      normalizeNoItemSentinel(item_title),
      projectMountPointIds,
    );
    if (!item) {
      return buildFailureResponse(wardrobeItemNotFoundMessage(item_id, item_title));
    }

    if (!isOwnWardrobeItem(item, context.characterId)) {
      return buildFailureResponse(
        `"${item.title}" is a shared wardrobe item — you can wear it but not edit or retire it. ` +
          'Only items in your own wardrobe can be archived.',
      );
    }

    // Is the item currently equipped? (Archive doesn't clear equipped slots, but
    // an equipped-then-archived item warrants a visible refresh.)
    const equipped = await repos.chats.getEquippedOutfitForCharacter(context.chatId, context.characterId);
    const wasEquipped = !!equipped && WARDROBE_SLOT_TYPES.some((s) => (equipped[s] ?? []).includes(item.id));

    const archived = await repos.wardrobe.archive(item.id, item.characterId);
    if (!archived) {
      return buildFailureResponse(`Failed to archive wardrobe item "${item.title}"`);
    }

    if (wasEquipped) {
      await notifyWardrobeChanged(
        repos,
        {
          userId: context.userId,
          chatId: context.chatId,
          characterId: context.characterId,
          pendingWardrobeAnnouncements: context.pendingWardrobeAnnouncements,
        },
        'wardrobe-archive-handler',
      );
    }

    logger.info('Wardrobe item archived', {
      context: 'wardrobe-archive-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      itemId: item.id,
      itemTitle: item.title,
      wasEquipped,
    });

    return { success: true, item_id: item.id, title: item.title, action: 'archived' };
  } catch (error) {
    logger.error('Wardrobe archive tool execution failed', {
      context: 'wardrobe-archive-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined);
    return buildFailureResponse(
      error instanceof Error ? error.message : 'Unknown error during wardrobe archive',
    );
  }
}

/**
 * Format wardrobe archive results for inclusion in conversation context
 */
export function formatWardrobeArchiveResults(output: WardrobeArchiveToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }
  return `Archived "${output.title}" (${output.item_id}). It's hidden from listings and can't be worn; a human can restore it.`;
}
