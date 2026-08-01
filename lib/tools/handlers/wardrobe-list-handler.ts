/**
 * List Wardrobe Tool Handler
 *
 * Retrieves wardrobe items for a character, with optional filtering by type
 * and appropriateness. Shows equipped status per item, marks composite items
 * (with `componentItemIds`) and lists their component titles for the LLM.
 *
 * Outfit presets are no longer a separate concept — composites are wardrobe
 * items addressed by id like everything else, so they show up in the same
 * listing.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeListToolInput, WardrobeListToolOutput, WardrobeListItemResult } from '../wardrobe-list-tool';
import { validateWardrobeListInput } from '../wardrobe-list-tool';
import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { resolveProjectMountPointIdsForChat } from '@/lib/mount-index/tiered-mount-pool';
import { findEquippedSlots } from './wardrobe-handler-shared';

/**
 * Context required for wardrobe list tool execution
 */
export interface WardrobeListToolContext {
  /** User ID for authentication and logging */
  userId: string;
  /** Chat ID for equipped outfit lookup */
  chatId: string;
  /** Character ID whose wardrobe to list */
  characterId: string;
}

/**
 * Error thrown during wardrobe list execution
 */
export class WardrobeListError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'NOT_FOUND'
  ) {
    super(message);
    this.name = 'WardrobeListError';
  }
}

/**
 * Execute the wardrobe_list tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID, chat ID, and character ID
 * @returns Tool output with filtered wardrobe items and equipped status
 */
export async function executeWardrobeListTool(
  input: unknown,
  context: WardrobeListToolContext
): Promise<WardrobeListToolOutput> {
  const repos = getRepositories();

  try {
    const parsed = validateWardrobeListInput(input);
    if (!parsed) {
      logger.warn('Wardrobe list tool validation failed', {
        context: 'wardrobe-list-handler',
        userId: context.userId,
        characterId: context.characterId,
        input,
      });
      return {
        success: false,
        items: [],
        total_count: 0,
        error:
          'Invalid input: type_filter must be a string array, appropriateness_filter must be a string, include_equipped must be a boolean',
      };
    }

    const validatedInput = parsed;
    const { type_filter, appropriateness_filter, include_equipped } = validatedInput;

    // The character's own wardrobe merged under the shared archetypes (project
    // + Quilltap General). Character items win on id collision so a personal
    // override masks the shared item. (The group tier is a tracked follow-up —
    // the repo doesn't accept group mounts yet.)
    const projectMountPointIds = await resolveProjectMountPointIdsForChat(context.chatId);
    const allItems = await repos.wardrobe.findWearablePoolForCharacter(context.characterId, {
      projectMountPointIds,
    });

    const equippedSlots: EquippedSlots | null = await repos.chats.getEquippedOutfitForCharacter(
      context.chatId,
      context.characterId
    );

    let filteredItems = allItems;

    if (type_filter && type_filter.length > 0) {
      const lowerTypeFilter = type_filter.map((t) => t.toLowerCase());
      filteredItems = filteredItems.filter((item) =>
        item.types.some((type) => lowerTypeFilter.includes(type.toLowerCase()))
      );
    }

    if (appropriateness_filter && appropriateness_filter.trim() !== '') {
      const lowerFilter = appropriateness_filter.toLowerCase();
      filteredItems = filteredItems.filter(
        (item) =>
          item.appropriateness != null &&
          item.appropriateness.toLowerCase().includes(lowerFilter)
      );
    }

    // Map every item by id for composite-component title resolution. We
    // include the unfiltered list so a filtered composite can still show its
    // components (some of which may have been filtered out themselves).
    const itemsById = new Map<string, WardrobeItem>();
    for (const item of allItems) itemsById.set(item.id, item);

    // Build result list with equipped status and composite metadata.
    const resultItems: WardrobeListItemResult[] = filteredItems.map((item) => {
      const equipped = findEquippedSlots(item.id, equippedSlots);
      const isComposite = (item.componentItemIds?.length ?? 0) > 0;
      const componentTitles = isComposite
        ? item.componentItemIds
            .map((cid) => itemsById.get(cid)?.title)
            .filter((t): t is string => typeof t === 'string')
        : undefined;
      return {
        item_id: item.id,
        title: item.title,
        description: item.description ?? null,
        image_prompt: item.imagePrompt ?? null,
        types: item.types,
        appropriateness: item.appropriateness ?? null,
        is_own: item.characterId === context.characterId,
        is_equipped: equipped.length > 0,
        // Preserve the original single-slot field shape; with arrays-per-slot
        // we expose the *first* slot the item appears in for back-compat,
        // and the full set on `equipped_slots`.
        equipped_slot: equipped[0] ?? null,
        ...(isComposite
          ? {
              is_composite: true,
              component_item_ids: item.componentItemIds,
              component_titles: componentTitles,
            }
          : {}),
      } as WardrobeListItemResult;
    });

    // Filter out equipped items if include_equipped is explicitly false
    const finalItems =
      include_equipped === false
        ? resultItems.filter((item) => !item.is_equipped)
        : resultItems;

    logger.info('Wardrobe list completed', {
      context: 'wardrobe-list-handler',
      userId: context.userId,
      characterId: context.characterId,
      chatId: context.chatId,
      totalItems: allItems.length,
      filteredCount: finalItems.length,
      hasTypeFilter: !!type_filter,
      hasAppropriatenessFilter: !!appropriateness_filter,
      includeEquipped: include_equipped !== false,
      compositeCount: finalItems.filter((i) => (i as WardrobeListItemResult & { is_composite?: boolean }).is_composite).length,
    });

    return {
      success: true,
      items: finalItems,
      total_count: finalItems.length,
    };
  } catch (error) {
    logger.error('Wardrobe list tool execution failed', {
      context: 'wardrobe-list-handler',
      userId: context.userId,
      characterId: context.characterId,
      chatId: context.chatId,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      items: [],
      total_count: 0,
      error: error instanceof Error ? error.message : 'Unknown error during wardrobe list operation',
    };
  }
}

/**
 * Format wardrobe list results for inclusion in conversation context
 *
 * @param output - Wardrobe list tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatWardrobeListResults(output: WardrobeListToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }

  if (output.items.length === 0) {
    return 'Wardrobe: No items found matching the specified filters.';
  }

  const lines: string[] = [`Wardrobe (${output.total_count} item${output.total_count !== 1 ? 's' : ''}):`];

  for (const item of output.items) {
    const typeTags = item.types.map((t) => `[${t}]`).join(' ');
    const equippedTag = item.is_equipped ? ` (EQUIPPED in ${item.equipped_slot})` : '';
    const sharedTag = item.is_own ? '' : ' [shared — read-only]';
    const appropriatenessTag = item.appropriateness ? ` | ${item.appropriateness}` : '';
    const description = item.description ? ` - ${item.description}` : '';
    const cueTag = item.image_prompt ? ` (cue: ${item.image_prompt})` : '';
    const composite = item as WardrobeListItemResult & {
      is_composite?: boolean;
      component_titles?: string[];
    };
    const compositeTag = composite.is_composite
      ? ` [composite: ${(composite.component_titles ?? []).join(', ') || 'unresolved components'}]`
      : '';

    lines.push(`  ${typeTags} ${item.title}${equippedTag}${sharedTag}${appropriatenessTag}${compositeTag}${cueTag}${description}`);
  }

  return lines.join('\n');
}
