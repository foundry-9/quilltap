/**
 * Wear Wardrobe Items Tool Handler
 *
 * Applies an ordered array of put-on operations in sequence, each building on
 * the last (equipped state is loaded/mutated/persisted per primitive, so it
 * accumulates naturally). Per-operation mode maps to the displacement
 * primitives in `lib/wardrobe/outfit-displacement.ts`:
 *
 *   - `wear`        → `equipItem(item)`   (honors the item's replace flag)
 *   - `replace`     → `replaceItem(item)` (force-swap the covered slots)
 *   - `add_to_slot` → `addToSlot(slot, item)`
 *
 * Single garments and composites are handled identically — the item's own
 * `replace` flag decides layer-vs-swap. The handler FAILS FAST on the first bad
 * operation (item not found / archived / slot mismatch), returning the partial
 * results plus the resulting state. Avatar generation and the Aurora
 * announcement fire ONCE after the loop.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  WardrobeWearToolInput,
  WardrobeWearToolOutput,
  WardrobeWearOpResult,
} from '../wardrobe-wear-tool';
import { validateWardrobeWearInput } from '../wardrobe-wear-tool';
import { equipItem, replaceItem, addToSlot } from '@/lib/wardrobe/outfit-displacement';
import { resolveProjectMountPointIdsForChat } from '@/lib/mount-index/tiered-mount-pool';
import {
  buildWardrobeCoverageSummaryFromState,
  describeWardrobeEffect,
  emptyEquippedState,
  formatWardrobeMutationResults,
  loadCurrentWardrobeState,
  normalizeNoItemSentinel,
  notifyWardrobeChanged,
  resolveWardrobeItemAcrossTiers,
  wardrobeItemNotFoundMessage,
} from './wardrobe-handler-shared';

export interface WardrobeWearToolContext {
  userId: string;
  chatId: string;
  characterId: string;
  /** Per-turn announcement queue. Forwarded from `ToolExecutionContext`. */
  pendingWardrobeAnnouncements?: Set<string>;
}

class WardrobeWearError extends Error {}

function buildFailureResponse(error: string): WardrobeWearToolOutput {
  return {
    success: false,
    operations: [],
    current_state: emptyEquippedState(),
    coverage_summary: '',
    error,
  };
}

export async function executeWardrobeWearTool(
  input: unknown,
  context: WardrobeWearToolContext,
): Promise<WardrobeWearToolOutput> {
  const repos = getRepositories();

  const parsed = validateWardrobeWearInput(input);

  if (!parsed) {
    logger.warn('Wardrobe wear tool validation failed', {
      context: 'wardrobe-wear-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      input,
    });
    return buildFailureResponse(
      'Invalid input: provide a non-empty "operations" array. Each operation needs ' +
        'an item_id or item_title; mode=add_to_slot also needs a slot.',
    );
  }

  const projectMountPointIds = await resolveProjectMountPointIdsForChat(context.chatId);

  const results: WardrobeWearOpResult[] = [];
  let appliedCount = 0;
  let failedError: string | undefined;

  for (const op of parsed.operations) {
    const mode = op.mode ?? 'wear';
    const itemId = normalizeNoItemSentinel(op.item_id);
    const itemTitle = normalizeNoItemSentinel(op.item_title);

    try {
      const item = await resolveWardrobeItemAcrossTiers(
        repos,
        context.characterId,
        itemId,
        itemTitle,
        projectMountPointIds,
      );
      if (!item) {
        throw new WardrobeWearError(wardrobeItemNotFoundMessage(itemId, itemTitle));
      }
      if (item.archivedAt) {
        throw new WardrobeWearError(`Item "${item.title}" is archived and cannot be worn`);
      }

      let effect: 'layered' | 'replaced';
      let slotsAffected: string[];

      if (mode === 'add_to_slot') {
        const slot = op.slot!;
        if (!item.types.includes(slot)) {
          throw new WardrobeWearError(
            `Item "${item.title}" (types: ${item.types.join(', ')}) cannot be added to the "${slot}" slot`,
          );
        }
        await addToSlot(repos, context.chatId, context.characterId, slot, item);
        effect = 'layered';
        slotsAffected = [slot];
      } else if (mode === 'replace') {
        await replaceItem(repos, context.chatId, context.characterId, item);
        effect = 'replaced';
        slotsAffected = item.types;
      } else {
        // mode === 'wear'
        await equipItem(repos, context.chatId, context.characterId, item);
        effect = item.replace ? 'replaced' : 'layered';
        slotsAffected = item.types;
      }

      results.push({
        mode,
        effect,
        effect_summary: describeWardrobeEffect(effect, slotsAffected, item.title),
        item: { item_id: item.id, title: item.title },
        slots_affected: slotsAffected,
      });
      appliedCount++;

      logger.info('Wardrobe item worn', {
        context: 'wardrobe-wear-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        itemId: item.id,
        itemTitle: item.title,
        mode,
        effect,
        slotsAffected,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error wearing item';
      results.push({
        mode,
        effect: 'layered',
        effect_summary: '',
        item: null,
        slots_affected: [],
        error: message,
      });
      failedError = message;
      logger.warn('Wardrobe wear operation failed', {
        context: 'wardrobe-wear-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        mode,
        message,
      });
      break; // fail-fast
    }
  }

  // Fire side effects ONCE, only if at least one operation actually landed.
  if (appliedCount > 0) {
    await notifyWardrobeChanged(
      repos,
      {
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        pendingWardrobeAnnouncements: context.pendingWardrobeAnnouncements,
      },
      'wardrobe-wear-handler',
    );
  }

  const currentState = await loadCurrentWardrobeState(repos, context.chatId, context.characterId);
  const coverageSummary = await buildWardrobeCoverageSummaryFromState(
    repos,
    context.characterId,
    currentState,
    { projectMountPointIds },
  );

  return {
    success: failedError === undefined,
    operations: results,
    current_state: currentState,
    coverage_summary: coverageSummary,
    ...(failedError ? { error: failedError } : {}),
  };
}

/**
 * Format wardrobe wear results for inclusion in conversation context
 */
export function formatWardrobeWearResults(output: WardrobeWearToolOutput): string {
  return formatWardrobeMutationResults(output);
}
