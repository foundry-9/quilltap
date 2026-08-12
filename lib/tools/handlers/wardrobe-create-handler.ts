/**
 * Create Wardrobe Item Tool Handler
 *
 * Creates new wardrobe items — leaf or composite — and optionally equips
 * them immediately. Supports gifting items to other characters in the chat
 * via the optional `recipient` parameter, and an optional Portrait Cue
 * (`image_prompt`) that steers image generation.
 *
 * Composite items are built by supplying `component_item_ids` and/or
 * `component_titles`. The handler resolves both (across the character's own
 * wardrobe, the project, and Quilltap General), dedupes, computes the `types`
 * union from the components' types (overriding any LLM-supplied `types`), and
 * persists the new item with the resolved `componentItemIds`. Cycles are
 * rejected by `WardrobeRepository.create` before the row lands.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  WardrobeCreateToolInput,
  WardrobeCreateToolOutput,
} from '../wardrobe-create-tool';
import { validateWardrobeCreateInput } from '../wardrobe-create-tool';
import type { WardrobeItem, WardrobeItemType, EquippedSlots } from '@/lib/schemas/wardrobe.types';
import { WARDROBE_SLOT_TYPES, EMPTY_EQUIPPED_SLOTS } from '@/lib/schemas/wardrobe.types';
import { equipItem } from '@/lib/wardrobe/outfit-displacement';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';
import { unionTypes } from '@/lib/wardrobe/composite-types';
import { resolveProjectMountPointIdsForChat } from '@/lib/mount-index/tiered-mount-pool';
import { describeWardrobeEffect } from './wardrobe-handler-shared';

export interface WardrobeCreateToolContext {
  userId: string;
  chatId: string;
  characterId: string;
}

export class WardrobeCreateError extends Error {
  constructor(message: string, public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'NOT_FOUND') {
    super(message);
    this.name = 'WardrobeCreateError';
  }
}

/**
 * Resolve a recipient character ID from a name string by searching chat participants.
 * Returns { characterId, characterName } or null if not found.
 */
async function resolveRecipientFromChat(
  chatId: string,
  recipientName: string,
): Promise<{ characterId: string; characterName: string } | null> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(chatId);
  if (!chat) return null;

  const participants = (chat as Record<string, unknown>).participants as Array<{
    characterId?: string;
    status?: string;
  }> | undefined;

  if (!participants || !Array.isArray(participants)) return null;

  const normalizedSearch = recipientName.trim().toLowerCase();

  for (const participant of participants) {
    if (participant.status === 'removed') continue;
    const charId = participant.characterId;
    if (!charId) continue;

    const character = await repos.characters.findById(charId);
    if (!character) continue;

    if (character.name.trim().toLowerCase() === normalizedSearch) {
      return { characterId: charId, characterName: character.name };
    }
  }

  return null;
}

/**
 * Resolve component item references (IDs and/or titles) into a deduplicated,
 * ordered list of wardrobe items. Resolves across the target character's own
 * wardrobe AND shared archetypes (project + Quilltap General); the character's
 * own items win on id/title collision. ID matches are preferred over title
 * matches; unknown references throw.
 */
async function resolveComponentItems(
  characterId: string,
  componentIds: string[] | undefined,
  componentTitles: string[] | undefined,
  projectMountPointIds: string[],
): Promise<WardrobeItem[]> {
  const ids = componentIds ?? [];
  const titles = componentTitles ?? [];
  if (ids.length === 0 && titles.length === 0) return [];

  const repos = getRepositories();
  const ownItems = await repos.wardrobe.findByCharacterId(characterId, true);
  const archetypes = await repos.wardrobe.findArchetypes(false, { projectMountPointIds });

  // Character's own items take precedence on id/title collision.
  const itemsById = new Map<string, WardrobeItem>();
  const itemsByTitle = new Map<string, WardrobeItem>();
  for (const i of [...archetypes, ...ownItems]) {
    itemsById.set(i.id, i);
    itemsByTitle.set(i.title.trim().toLowerCase(), i);
  }

  const seen = new Set<string>();
  const resolved: WardrobeItem[] = [];

  for (const id of ids) {
    const item = itemsById.get(id);
    if (!item) {
      throw new WardrobeCreateError(
        `Component item with ID "${id}" was not found in this character's wardrobe, the project, or Quilltap General`,
        'NOT_FOUND',
      );
    }
    if (!seen.has(item.id)) {
      seen.add(item.id);
      resolved.push(item);
    }
  }

  for (const title of titles) {
    const item = itemsByTitle.get(title.trim().toLowerCase());
    if (!item) {
      throw new WardrobeCreateError(
        `Component item titled "${title}" was not found in this character's wardrobe, the project, or Quilltap General`,
        'NOT_FOUND',
      );
    }
    if (!seen.has(item.id)) {
      seen.add(item.id);
      resolved.push(item);
    }
  }

  return resolved;
}

/**
 * Execute the create wardrobe item tool
 */
export async function executeWardrobeCreateTool(
  input: unknown,
  context: WardrobeCreateToolContext,
): Promise<WardrobeCreateToolOutput> {
  const repos = getRepositories();

  try {
    const parsed = validateWardrobeCreateInput(input);
    if (!parsed) {
      logger.warn('Wardrobe create tool validation failed', {
        context: 'wardrobe-create-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        input,
      });
      return {
        success: false,
        item_id: '',
        title: '',
        equipped: false,
        error:
          'Invalid input: title (string) is required. Either supply types ' +
          '(non-empty array of valid slot types) for a leaf item, or ' +
          'component_item_ids / component_titles for a composite item.',
      };
    }

    const {
      title,
      description,
      image_prompt,
      types,
      appropriateness,
      equip_now,
      recipient,
      component_item_ids,
      component_titles,
      replace,
    } = parsed;

    // Resolve the target character — defaults to the calling character
    let targetCharacterId = context.characterId;
    let recipientName: string | undefined;

    if (recipient) {
      const resolved = await resolveRecipientFromChat(context.chatId, recipient);

      if (!resolved) {
        logger.warn('Wardrobe create recipient not found in chat', {
          context: 'wardrobe-create-handler',
          userId: context.userId,
          chatId: context.chatId,
          recipientName: recipient,
        });
        return {
          success: false,
          item_id: '',
          title: '',
          equipped: false,
          error: `Could not find a character named "${recipient}" in this chat`,
        };
      }

      targetCharacterId = resolved.characterId;
      recipientName = resolved.characterName;
    }

    const projectMountPointIds = await resolveProjectMountPointIdsForChat(context.chatId);

    // Resolve components against the target character's wardrobe (plus shared
    // archetypes) so a gifted composite references items in the recipient's
    // collection. If components are supplied, the new item is a composite; its
    // coverage is the union of the components' slots, optionally widened by any
    // `types` the caller lists.
    const components = await resolveComponentItems(
      targetCharacterId,
      component_item_ids,
      component_titles,
      projectMountPointIds,
    );

    const isComposite = components.length > 0;
    let resolvedTypes: WardrobeItemType[];
    if (isComposite) {
      const union = unionTypes(components);
      if (union.length === 0) {
        throw new WardrobeCreateError(
          'Composite components do not cover any slots — this should not happen',
          'VALIDATION_ERROR',
        );
      }
      const designated = new Set<WardrobeItemType>([
        ...union,
        ...((types as WardrobeItemType[]) ?? []),
      ]);
      resolvedTypes = WARDROBE_SLOT_TYPES.filter((s) => designated.has(s));
    } else {
      resolvedTypes = (types as WardrobeItemType[]) ?? [];
    }

    const componentItemIds = components.map((c) => c.id);

    const newItem = await repos.wardrobe.create({
      characterId: targetCharacterId,
      title,
      description: description || null,
      imagePrompt: image_prompt || null,
      types: resolvedTypes,
      componentItemIds,
      appropriateness: appropriateness || null,
      isDefault: false,
      replace: isComposite ? replace ?? false : false,
    });

    let equipped = false;
    let effect: 'layered' | 'replaced' | undefined;
    let currentState: EquippedSlots | undefined;

    if (equip_now) {
      await equipItem(repos, context.chatId, targetCharacterId, newItem);

      equipped = true;
      effect = newItem.replace ? 'replaced' : 'layered';

      const chat = await repos.chats.findById(context.chatId);
      if (chat) {
        const equippedOutfit = (chat as Record<string, unknown>).equippedOutfit as Record<string, EquippedSlots> | undefined;
        currentState = equippedOutfit?.[targetCharacterId] || { ...EMPTY_EQUIPPED_SLOTS };
      }

      await triggerAvatarGenerationIfEnabled(repos, {
        userId: context.userId,
        chatId: context.chatId,
        characterId: targetCharacterId,
        callerContext: 'wardrobe-create-handler',
      });
    }

    logger.info('Wardrobe create completed', {
      context: 'wardrobe-create-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      targetCharacterId,
      recipientName,
      itemId: newItem.id,
      title: newItem.title,
      isComposite,
      componentCount: componentItemIds.length,
      equipped,
      effect,
    });

    return {
      success: true,
      item_id: newItem.id,
      title: newItem.title,
      equipped,
      ...(effect
        ? {
            effect,
            effect_summary: describeWardrobeEffect(effect, resolvedTypes, newItem.title),
          }
        : {}),
      is_composite: isComposite,
      resolved_types: resolvedTypes,
      ...(componentItemIds.length > 0 ? { resolved_component_item_ids: componentItemIds } : {}),
      ...(recipientName ? { recipient_name: recipientName } : {}),
      ...(currentState ? { current_state: currentState } : {}),
    };
  } catch (error) {
    if (error instanceof WardrobeCreateError) {
      logger.warn('Wardrobe create error', {
        context: 'wardrobe-create-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        code: error.code,
        message: error.message,
      });
      return {
        success: false,
        item_id: '',
        title: '',
        equipped: false,
        error: error.message,
      };
    }

    logger.error('Wardrobe create tool execution failed', {
      context: 'wardrobe-create-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      item_id: '',
      title: '',
      equipped: false,
      error: error instanceof Error ? error.message : 'Unknown error during wardrobe item creation',
    };
  }
}

/**
 * Format wardrobe create results for inclusion in conversation context
 */
export function formatWardrobeCreateResults(output: WardrobeCreateToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }

  const recipientNote = output.recipient_name ? ` for ${output.recipient_name}` : '';

  const kindLabel = output.is_composite ? 'composite outfit' : 'wardrobe item';
  const parts: string[] = [`Created ${kindLabel} "${output.title}" (${output.item_id})${recipientNote}`];

  if (output.is_composite && output.resolved_component_item_ids?.length) {
    parts.push(
      `- Bundles ${output.resolved_component_item_ids.length} item${output.resolved_component_item_ids.length === 1 ? '' : 's'}; covers ${(output.resolved_types ?? []).join(', ')}`,
    );
  }

  if (output.equipped) {
    parts.push(`- Equipped immediately${recipientNote ? ` on ${output.recipient_name}` : ''}`);

    if (output.current_state) {
      const slotSummary = WARDROBE_SLOT_TYPES
        .map((slot) => {
          const ids = output.current_state![slot];
          const label = !ids || ids.length === 0 ? '(empty)' : ids.join(', ');
          return `  ${slot}: ${label}`;
        })
        .join('\n');
      parts.push(`- Current outfit:\n${slotSummary}`);
    }
  } else {
    parts.push(`- Not equipped (added to wardrobe${recipientNote ? ` of ${output.recipient_name}` : ''} only)`);
  }

  return parts.join('\n');
}
