import { logger } from '@/lib/logger';
import { EMPTY_EQUIPPED_SLOTS, WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { describeOutfit } from '@/lib/wardrobe/outfit-description';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';
import { enqueueWardrobeOutfitAnnouncement } from '@/lib/background-jobs/queue-service';
import { getRepositories } from '@/lib/repositories/factory';
import type { ToolExecutionContext } from '@/lib/chat/tool-executor';

type WardrobeRepos = ReturnType<typeof getRepositories>;

/**
 * Sentinels an LLM sometimes emits for "no item". Treated as undefined so a
 * stray `item_id: "none"` doesn't get looked up as a real id.
 */
export const NO_ITEM_SENTINELS = new Set(['none', 'null', '']);

export function normalizeNoItemSentinel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return NO_ITEM_SENTINELS.has(value.trim().toLowerCase()) ? undefined : value;
}

/**
 * Resolve a wardrobe item across all (non-group) tiers — the character's own
 * wardrobe, the project store(s), and Quilltap General — by id (preferred) or
 * title (case-insensitive fallback).
 *
 * - by id: `findByIdForCharacter` already spans character → project → general
 *   (and includes archived items, which callers reject as needed).
 * - by title: scan the character's own items first (character wins on
 *   collision), then the merged archetype set.
 *
 * The group tier is intentionally NOT covered yet — the repository doesn't
 * accept group mounts. Wiring it in is a tracked follow-up.
 */
export async function resolveWardrobeItemAcrossTiers(
  repos: WardrobeRepos,
  characterId: string,
  itemId: string | undefined,
  itemTitle: string | undefined,
  projectMountPointIds?: string[],
): Promise<WardrobeItem | null> {
  if (itemId) {
    const found = await repos.wardrobe.findByIdForCharacter(characterId, itemId, {
      projectMountPointIds,
    });
    if (found) return found;
  }

  if (itemTitle) {
    const lower = itemTitle.trim().toLowerCase();
    const own = await repos.wardrobe.findByCharacterId(characterId, true);
    const ownMatch = own.find((i) => i.title.toLowerCase() === lower);
    if (ownMatch) return ownMatch;

    const archetypes = await repos.wardrobe.findArchetypes(false, { projectMountPointIds });
    const archMatch = archetypes.find((i) => i.title.toLowerCase() === lower);
    if (archMatch) return archMatch;
  }

  return null;
}

/**
 * True when the item belongs to THIS character (editable), false when it is a
 * shared archetype (project / Quilltap General; `characterId === null`) or owned
 * by someone else. The single guard standing between the model and a repo
 * update/archive that would mutate a communal item for everyone.
 */
export function isOwnWardrobeItem(item: WardrobeItem, characterId: string): boolean {
  return item.characterId === characterId;
}

interface WardrobeReposForSummary {
  chats: {
    getEquippedOutfitForCharacter(chatId: string, characterId: string): Promise<EquippedSlots | null>;
  };
  wardrobe: {
    findByCharacterId(characterId: string, includeArchived?: boolean): Promise<WardrobeItem[]>;
    findByIdsForCharacter(
      characterId: string,
      ids: string[],
      opts?: { projectMountPointIds?: string[] },
    ): Promise<WardrobeItem[]>;
  };
}

export function emptyEquippedState(): EquippedSlots {
  return { ...EMPTY_EQUIPPED_SLOTS };
}

/**
 * Find every slot the item is equipped in. Slots are arrays, so a single item
 * can occupy multiple slots (a multi-slot dress) and we want them all.
 */
export function findEquippedSlots(
  itemId: string,
  equippedSlots: EquippedSlots | null,
): string[] {
  if (!equippedSlots) return [];
  const slots: string[] = [];
  for (const slot of WARDROBE_SLOT_TYPES) {
    if ((equippedSlots[slot] ?? []).includes(itemId)) {
      slots.push(slot);
    }
  }
  return slots;
}

/**
 * What a wardrobe mutation did to the slots it touched, reported back to the
 * LLM so it knows whether existing items survived.
 *
 *   - `layered`  — the item was added on top; whatever was already in those
 *                  slots stayed (the item's `replace` flag is off).
 *   - `replaced` — those slots were cleared and set to just this item.
 *   - `removed`  — a named item was taken off; any other layers stayed.
 *   - `cleared`  — the slot(s) were emptied entirely.
 */
export type WardrobeEffect = 'layered' | 'replaced' | 'removed' | 'cleared';

/**
 * One-sentence, model-facing description of what a wardrobe mutation just did.
 * Phrased identically across the wardrobe tools so the LLM gets a consistent
 * read on layer-vs-replace.
 */
export function describeWardrobeEffect(
  effect: WardrobeEffect,
  slots: readonly string[],
  itemTitle?: string | null,
): string {
  const slotList = slots.length > 0 ? slots.join(', ') : 'the slot';
  const those = slots.length > 1 ? 'those slots' : 'that slot';
  const title = itemTitle ? `"${itemTitle}"` : 'the item';
  switch (effect) {
    case 'layered':
      return `Layered ${title} into ${slotList}. The item's replace flag is off, so whatever was already in ${those} was kept.`;
    case 'replaced':
      return `Replaced ${slotList} with ${title} — anything previously in ${those} was cleared.`;
    case 'removed':
      return itemTitle
        ? `Took ${title} off ${slotList}; any other layers there stayed.`
        : `Cleared ${slotList}.`;
    case 'cleared':
      return `Cleared ${slotList} entirely.`;
  }
}

/**
 * The shape shared by `wardrobe_wear` / `wardrobe_take_off` outputs, as far as
 * the context formatter cares.
 */
interface WardrobeMutationOutput {
  success: boolean;
  operations: Array<{ error?: string; effect_summary?: string }>;
  current_state: EquippedSlots;
  coverage_summary: string;
  error?: string;
}

/**
 * Format a wear/take-off result for conversation context: the per-operation
 * effect lines, then the resulting per-slot outfit, then the coverage summary.
 * Identical presentation for both tools so the LLM reads them the same way.
 */
export function formatWardrobeMutationResults(output: WardrobeMutationOutput): string {
  if (!output.success && output.operations.length === 0) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }

  const lines: string[] = [];
  for (const op of output.operations) {
    if (op.error) {
      lines.push(`Failed: ${op.error}`);
    } else if (op.effect_summary) {
      lines.push(op.effect_summary);
    }
  }

  lines.push('');
  lines.push('Current outfit:');
  const state = output.current_state;
  for (const slotKey of WARDROBE_SLOT_TYPES) {
    const ids = state[slotKey];
    lines.push(`  ${slotKey}: ${ids.length === 0 ? '(empty)' : ids.join(', ')}`);
  }
  lines.push('');
  lines.push(`Summary: ${output.coverage_summary}`);

  return lines.join('\n');
}

export async function loadCurrentWardrobeState(
  repos: WardrobeReposForSummary,
  chatId: string,
  characterId: string,
): Promise<EquippedSlots> {
  const equippedOutfit = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  return equippedOutfit ?? emptyEquippedState();
}

/**
 * Build the human-readable `coverage_summary` returned to the LLM in wardrobe
 * tool results. Delegates to `resolveEquippedOutfitForCharacter` so the LLM
 * sees the same canonical resolution Aurora uses — composites expanded
 * (loading components via `findByCharacterId`, not just `findByIds` on
 * equipped slot IDs) and multi-slot atomic items routed by their own `types`.
 */
export async function buildWardrobeCoverageSummaryFromState(
  repos: WardrobeReposForSummary,
  characterId: string,
  slots: EquippedSlots,
  opts?: { projectMountPointIds?: string[] },
): Promise<string> {
  const resolved = await resolveEquippedOutfitForCharacter(repos, characterId, slots, {
    projectMountPointIds: opts?.projectMountPointIds,
  });
  return describeOutfit(resolved.outfitValues);
}

export async function scheduleWardrobeAnnouncement(
  sourceContext: string,
  args: {
    userId: string;
    chatId: string;
    characterId: string;
    extraLogFields?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await enqueueWardrobeOutfitAnnouncement(args.userId, {
      chatId: args.chatId,
      characterId: args.characterId,
    });
  } catch (error) {
    logger.warn('Failed to schedule wardrobe outfit announcement', {
      context: sourceContext,
      chatId: args.chatId,
      characterId: args.characterId,
      ...(args.extraLogFields ?? {}),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Record that the given character's wardrobe was modified during this turn.
 *
 * If the tool execution context has a `pendingWardrobeAnnouncements` Set
 * (the orchestrator initializes one per turn), the characterId is added to
 * it and Aurora's notification is deferred until the orchestrator drains the
 * Set at end-of-turn — collapsing N wardrobe edits in a single LLM response
 * into a single announcement.
 *
 * If the Set is missing (legacy callers without orchestrator threading), the
 * announcement is enqueued immediately so behavior degrades safely.
 */
/**
 * The "not found" message the wardrobe tools return when an item can't be
 * resolved by id or title. Phrased identically across `wardrobe_read`,
 * `wardrobe_update`, `wardrobe_wear`, `wardrobe_take_off`, and
 * `wardrobe_archive`.
 */
export function wardrobeItemNotFoundMessage(
  itemId: string | undefined,
  itemTitle: string | undefined,
): string {
  return `Wardrobe item not found${itemId ? ` with ID "${itemId}"` : ''}${itemTitle ? ` with title "${itemTitle}"` : ''}`;
}

/**
 * Fire the two side effects that must follow any equipped-state change: refresh
 * the character's avatar (if enabled) and queue Aurora's wardrobe announcement.
 * Both the caller-context label (avatar) and source-context label
 * (announcement) share the handler's name. Called ONCE per turn after a wardrobe
 * mutation actually lands.
 */
export async function notifyWardrobeChanged(
  repos: WardrobeRepos,
  context: Pick<ToolExecutionContext, 'userId' | 'chatId' | 'pendingWardrobeAnnouncements'> & {
    characterId: string;
  },
  sourceContext: string,
): Promise<void> {
  await triggerAvatarGenerationIfEnabled(repos, {
    userId: context.userId,
    chatId: context.chatId,
    characterId: context.characterId,
    callerContext: sourceContext,
  });
  await recordPendingWardrobeAnnouncement(
    {
      userId: context.userId,
      chatId: context.chatId,
      pendingWardrobeAnnouncements: context.pendingWardrobeAnnouncements,
    },
    { sourceContext, characterId: context.characterId },
  );
}

export async function recordPendingWardrobeAnnouncement(
  context: Pick<ToolExecutionContext, 'userId' | 'chatId' | 'pendingWardrobeAnnouncements'>,
  args: {
    sourceContext: string;
    characterId: string;
    extraLogFields?: Record<string, unknown>;
  },
): Promise<void> {
  if (context.pendingWardrobeAnnouncements) {
    context.pendingWardrobeAnnouncements.add(args.characterId);
    return;
  }
  await scheduleWardrobeAnnouncement(args.sourceContext, {
    userId: context.userId,
    chatId: context.chatId,
    characterId: args.characterId,
    extraLogFields: args.extraLogFields,
  });
}

/**
 * Drain the per-turn `pendingWardrobeAnnouncements` Set, scheduling one
 * Aurora announcement per character. Idempotent — clearing the Set after the
 * drain means later calls in the same turn produce no duplicate announcements.
 *
 * Safe to call when the Set is missing or empty (no-op).
 */
export async function flushPendingWardrobeAnnouncements(
  context: Pick<ToolExecutionContext, 'userId' | 'chatId' | 'pendingWardrobeAnnouncements'>,
): Promise<void> {
  const pending = context.pendingWardrobeAnnouncements;
  if (!pending || pending.size === 0) return;
  const characterIds = Array.from(pending);
  pending.clear();
  for (const characterId of characterIds) {
    await scheduleWardrobeAnnouncement('orchestrator-turn-end', {
      userId: context.userId,
      chatId: context.chatId,
      characterId,
    });
  }
}
