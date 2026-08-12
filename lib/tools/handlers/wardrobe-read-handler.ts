/**
 * Read Wardrobe Item Tool Handler
 *
 * Resolves ONE wardrobe item across all (non-group) tiers — the character's own
 * wardrobe, the project, and Quilltap General — and returns its full detail,
 * including the Portrait Cue, default/replace flags, component list, archived
 * status, ownership, and which slots it's currently equipped in.
 *
 * `buildWardrobeReadOutput` is exported and reused by `wardrobe_update` so an
 * edit echoes back the same shape.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeReadToolInput, WardrobeReadToolOutput } from '../wardrobe-read-tool';
import { validateWardrobeReadInput } from '../wardrobe-read-tool';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { resolveProjectMountPointIdsForChat } from '@/lib/mount-index/tiered-mount-pool';
import {
  findEquippedSlots,
  isOwnWardrobeItem,
  normalizeNoItemSentinel,
  resolveWardrobeItemAcrossTiers,
  wardrobeItemNotFoundMessage,
} from './wardrobe-handler-shared';

export interface WardrobeReadToolContext {
  userId: string;
  chatId: string;
  characterId: string;
}

type WardrobeRepos = ReturnType<typeof getRepositories>;

/**
 * Build the full read-shaped output for a resolved wardrobe item. Shared by
 * `wardrobe_read` and `wardrobe_update`.
 */
export async function buildWardrobeReadOutput(
  repos: WardrobeRepos,
  characterId: string,
  chatId: string,
  item: WardrobeItem,
  projectMountPointIds: string[],
): Promise<WardrobeReadToolOutput> {
  const isComposite = (item.componentItemIds?.length ?? 0) > 0;

  let componentTitles: string[] = [];
  if (isComposite) {
    const components = await repos.wardrobe.findByIdsForCharacter(characterId, item.componentItemIds, {
      projectMountPointIds,
    });
    const titleById = new Map(components.map((c) => [c.id, c.title]));
    componentTitles = item.componentItemIds
      .map((cid) => titleById.get(cid))
      .filter((t): t is string => typeof t === 'string');
  }

  const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  const equipped = findEquippedSlots(item.id, equippedSlots);

  return {
    success: true,
    item_id: item.id,
    title: item.title,
    description: item.description ?? null,
    image_prompt: item.imagePrompt ?? null,
    types: item.types,
    appropriateness: item.appropriateness ?? null,
    is_default: item.isDefault ?? false,
    replace: item.replace ?? false,
    is_composite: isComposite,
    component_item_ids: item.componentItemIds ?? [],
    component_titles: componentTitles,
    archived: item.archivedAt != null,
    is_own: isOwnWardrobeItem(item, characterId),
    is_equipped: equipped.length > 0,
    equipped_slots: equipped,
  };
}

export function buildWardrobeReadFailure(error: string): WardrobeReadToolOutput {
  return {
    success: false,
    item_id: '',
    title: '',
    description: null,
    image_prompt: null,
    types: [],
    appropriateness: null,
    is_default: false,
    replace: false,
    is_composite: false,
    component_item_ids: [],
    component_titles: [],
    archived: false,
    is_own: false,
    is_equipped: false,
    equipped_slots: [],
    error,
  };
}

export async function executeWardrobeReadTool(
  input: unknown,
  context: WardrobeReadToolContext,
): Promise<WardrobeReadToolOutput> {
  const repos = getRepositories();

  const parsed = validateWardrobeReadInput(input);

  if (!parsed) {
    logger.warn('Wardrobe read tool validation failed', {
      context: 'wardrobe-read-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      input,
    });
    return buildWardrobeReadFailure('Invalid input: item_id or item_title is required.');
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
      return buildWardrobeReadFailure(wardrobeItemNotFoundMessage(item_id, item_title));
    }

    return await buildWardrobeReadOutput(repos, context.characterId, context.chatId, item, projectMountPointIds);
  } catch (error) {
    logger.error('Wardrobe read tool execution failed', {
      context: 'wardrobe-read-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined);
    return buildWardrobeReadFailure(
      error instanceof Error ? error.message : 'Unknown error during wardrobe read',
    );
  }
}

/**
 * Format wardrobe read results for inclusion in conversation context
 */
export function formatWardrobeReadResults(output: WardrobeReadToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }

  const lines: string[] = [`${output.title} (${output.item_id})`];
  lines.push(`  types: ${output.types.join(', ')}`);
  if (output.appropriateness) lines.push(`  appropriateness: ${output.appropriateness}`);
  if (output.description) lines.push(`  description: ${output.description}`);
  lines.push(`  portrait cue: ${output.image_prompt ?? '(none — falls back to title)'}`);
  if (output.is_composite) {
    lines.push(`  composite: ${output.component_titles.join(', ') || 'unresolved components'} (replace=${output.replace})`);
  }
  lines.push(`  default: ${output.is_default ? 'yes' : 'no'} | own: ${output.is_own ? 'yes' : 'no (shared — read-only)'}`);
  if (output.archived) lines.push('  archived: yes (hidden from listings, cannot be worn)');
  lines.push(`  equipped: ${output.is_equipped ? output.equipped_slots.join(', ') : 'no'}`);

  return lines.join('\n');
}
