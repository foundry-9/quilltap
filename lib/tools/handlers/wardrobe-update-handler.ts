/**
 * Update Wardrobe Item Tool Handler
 *
 * Edits the stored fields of an existing wardrobe item. Resolves the target
 * across all (non-group) tiers to LOCATE it, then enforces own-items-only:
 * shared archetypes (project / Quilltap General; `characterId === null`) are
 * read-only and the edit is refused. Only the supplied fields change. When the
 * component list changes and `types` wasn't given, the coverage union is
 * recomputed from the new components.
 *
 * Does NOT equip — wearing is a separate `wardrobe_wear` call. Echoes back the
 * updated item in `wardrobe_read` shape.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeUpdateToolInput, WardrobeUpdateToolOutput } from '../wardrobe-update-tool';
import { validateWardrobeUpdateInput } from '../wardrobe-update-tool';
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import { unionTypes } from '@/lib/wardrobe/composite-types';
import { resolveProjectMountPointIdsForChat } from '@/lib/mount-index/tiered-mount-pool';
import {
  isOwnWardrobeItem,
  normalizeNoItemSentinel,
  resolveWardrobeItemAcrossTiers,
  wardrobeItemNotFoundMessage,
} from './wardrobe-handler-shared';
import { buildWardrobeReadFailure, buildWardrobeReadOutput } from './wardrobe-read-handler';

export interface WardrobeUpdateToolContext {
  userId: string;
  chatId: string;
  characterId: string;
}

export async function executeWardrobeUpdateTool(
  input: unknown,
  context: WardrobeUpdateToolContext,
): Promise<WardrobeUpdateToolOutput> {
  const repos = getRepositories();

  const parsed = validateWardrobeUpdateInput(input);

  if (!parsed) {
    logger.warn('Wardrobe update tool validation failed', {
      context: 'wardrobe-update-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      input,
    });
    return buildWardrobeReadFailure('Invalid input: item_id or item_title is required.');
  }

  try {
    const {
      item_id,
      item_title,
      title,
      description,
      image_prompt,
      appropriateness,
      types,
      is_default,
      replace,
      component_item_ids,
    } = parsed;

    const projectMountPointIds = await resolveProjectMountPointIdsForChat(context.chatId);

    const item = await resolveWardrobeItemAcrossTiers(
      repos,
      context.characterId,
      normalizeNoItemSentinel(item_id),
      normalizeNoItemSentinel(item_title),
      projectMountPointIds,
    );
    if (!item) {
      return buildWardrobeReadFailure(wardrobeItemNotFoundMessage(item_id, item_title));
    }

    if (!isOwnWardrobeItem(item, context.characterId)) {
      return buildWardrobeReadFailure(
        `"${item.title}" is a shared wardrobe item — you can wear it but not edit or retire it. ` +
          'Only items in your own wardrobe can be changed.',
      );
    }

    const patch: Partial<WardrobeItem> = {};
    if (title !== undefined) patch.title = title;
    if (description !== undefined) patch.description = description;
    if (image_prompt !== undefined) patch.imagePrompt = image_prompt;
    if (appropriateness !== undefined) patch.appropriateness = appropriateness;
    if (types !== undefined) patch.types = types as WardrobeItemType[];
    if (is_default !== undefined) patch.isDefault = is_default;
    if (replace !== undefined) patch.replace = replace;
    if (component_item_ids !== undefined) patch.componentItemIds = component_item_ids;

    // When the component list changes and types weren't explicitly supplied,
    // recompute the coverage union from the new components (across tiers).
    if (component_item_ids !== undefined && types === undefined && component_item_ids.length > 0) {
      const comps = await repos.wardrobe.findByIdsForCharacter(context.characterId, component_item_ids, {
        projectMountPointIds,
      });
      const union = unionTypes(comps);
      if (union.length > 0) patch.types = union;
    }

    // `ownerCharacterId` must be passed so the vault mount resolves.
    const updated = await repos.wardrobe.update(item.id, patch, item.characterId);
    if (!updated) {
      return buildWardrobeReadFailure(`Failed to update wardrobe item "${item.title}"`);
    }

    logger.info('Wardrobe update completed', {
      context: 'wardrobe-update-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      itemId: updated.id,
      fields: Object.keys(patch),
    });

    return await buildWardrobeReadOutput(repos, context.characterId, context.chatId, updated, projectMountPointIds);
  } catch (error) {
    logger.error('Wardrobe update tool execution failed', {
      context: 'wardrobe-update-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined);
    return buildWardrobeReadFailure(
      error instanceof Error ? error.message : 'Unknown error during wardrobe update',
    );
  }
}

/**
 * Format wardrobe update results for inclusion in conversation context
 */
export function formatWardrobeUpdateResults(output: WardrobeUpdateToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }
  return `Updated "${output.title}" (${output.item_id}).`;
}
