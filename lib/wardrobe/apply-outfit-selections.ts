/**
 * Apply Outfit Selections — Shared Helper
 *
 * Shared between the new-chat creation flow (`/api/v1/chats`) and the
 * add-participant flow (`/api/v1/chats/[id]?action=add-participant`).
 *
 * Resolves each character's `OutfitSelection` to a concrete `EquippedSlots`
 * record and persists it on the chat via `repos.chats.setEquippedOutfit`.
 *
 * Modes:
 * - `default`       — load wardrobe items marked default and equip them
 * - `manual`        — use the slot assignments provided on the selection
 * - `none`          — empty every slot (character starts undressed)
 * - `previous_chat` — copy from `context.sourceChatId` (continuation flow);
 *                     falls back to defaults when nothing is available
 * - `llm_choose`    — ask a cheap LLM to pick an outfit; falls back to defaults
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { dissolveBundlesInSlots } from '@/lib/wardrobe/dissolve-bundles';
import {
  CLOTHING_SLOT_TYPES,
  WARDROBE_SLOT_TYPES,
  makeEmptyEquippedSlots,
} from '@/lib/schemas/wardrobe.types';
import type {
  EquippedSlots,
  OutfitSelection,
  WardrobeItem,
  WardrobeItemType,
} from '@/lib/schemas/wardrobe.types';
import type { CheapLLMSettings } from '@/lib/schemas/settings.types';
import {
  getCheapLLMProvider,
  DEFAULT_CHEAP_LLM_CONFIG,
  type CheapLLMConfig,
} from '@/lib/llm/cheap-llm';
import { chooseLLMOutfit } from '@/lib/memory/cheap-llm-tasks/outfit-selection';
import { resolveWardrobeInstructions } from '@/lib/wardrobe/wardrobe-instructions';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';
import { sharedWardrobeTiersForCharacter } from '@/lib/wardrobe/shared-tiers';
import { mergeWearablePool } from '@/lib/wardrobe/wearable-pool';
import { buildDefaultOutfit } from '@/lib/wardrobe/default-outfit';
import type {
  CreationProgressEmitter,
  OutfitPreviewSlots,
} from '@/lib/chat/creation-progress';

type Repos = RepositoryContainer;

/**
 * How long to wait on the wardrobe LLM for one character before giving up and
 * dressing them in their defaults.
 *
 * A healthy call on a cheap model is a second or two. Observed in the wild: a
 * provider that took 2m32s to emit 19 tokens, which — back when this loop was
 * serial — stalled the entire chat-creation request behind one character.
 * Concurrency stops one straggler from blocking the others; this stops a
 * straggler from blocking the chat.
 *
 * Note the underlying request is not aborted, only abandoned; it will still be
 * billed and still land in the LLM log.
 */
export const OUTFIT_LLM_TIMEOUT_MS = 60_000;

/** Sentinel distinguishing "gave up waiting" from any legitimate resolution. */
const TIMED_OUT = Symbol('outfit-llm-timed-out');

/**
 * Resolve `work`, or `TIMED_OUT` if it takes longer than `ms`.
 *
 * The timer is always cleared so a fast resolution doesn't hold the event loop
 * open, and a late rejection from `work` is absorbed by the race rather than
 * surfacing as an unhandled rejection.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([work, guard]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Context needed for LLM-based outfit selection during chat creation or
 * participant addition.
 */
export interface OutfitSelectionContext {
  userId: string;
  /**
   * Project document stores in scope for this chat, resolved by the caller from
   * the project id it already holds (`resolveProjectMountPointIds` /
   * `resolveProjectMountPointIdsForChat`). Folded into the shared wardrobe tier
   * alongside Quilltap General.
   *
   * Required rather than optional so a future call site that forgets it fails
   * to compile instead of silently dressing characters from one tier.
   */
  projectMountPointIds: string[];
  scenarioText?: string | null;
  cheapLLMConfig?: CheapLLMConfig;
  /**
   * When the new chat is a continuation of an existing one, the source chat
   * ID flows through here so the `'previous_chat'` mode can copy each
   * character's equipped outfit forward. Falls back to default outfit when
   * the source chat has nothing equipped for a given character (e.g. a
   * newly-joined participant).
   */
  sourceChatId?: string | null;
  /**
   * Optional progress emitter for the chat-creation status dialog. Only the
   * `llm_choose` mode narrates (it's the slow, LLM-backed path): it announces
   * "consulting the wardrobe for <name>" before the call and publishes the
   * decided four-slot outfit afterwards. Inert when absent.
   */
  progress?: CreationProgressEmitter;
}

/**
 * Map a resolved outfit's per-slot leaf items into the lightweight preview DTO
 * the status dialog renders (no full `WardrobeItem` payloads over the wire).
 */
function toOutfitPreviewSlots(
  leafItemsBySlot: Record<WardrobeItemType, WardrobeItem[]>,
): OutfitPreviewSlots {
  const map = (items: WardrobeItem[]) =>
    items.map((i) => ({
      id: i.id,
      title: i.title,
      isComposite: (i.componentItemIds?.length ?? 0) > 0,
    }));
  return Object.fromEntries(
    WARDROBE_SLOT_TYPES.map((slot) => [slot, map(leafItemsBySlot[slot] ?? [])]),
  ) as OutfitPreviewSlots;
}

/**
 * Apply outfit selections to a chat.
 * Processes each selection based on its mode:
 * - 'default': Load default wardrobe items and append each to the slots it covers
 * - 'manual': Use the provided slot assignments directly (already arrays)
 * - 'none': Set every slot to an empty array
 * - 'previous_chat': Copy equipped state from the source chat (continuation flow)
 * - 'llm_choose': Ask a cheap LLM to pick an outfit, fall back to defaults on
 *   failure, on an unflagged empty answer, or on {@link OUTFIT_LLM_TIMEOUT_MS}
 *
 * Runs in two phases:
 *
 *  1. **Resolve, concurrently.** Every character's slots are worked out in
 *     parallel via `Promise.allSettled` — `llm_choose` is a network round trip
 *     apiece, and serially they added up (one stalled provider held the whole
 *     cast). Nothing is written here, and one character's failure can't cancel
 *     its siblings.
 *  2. **Commit, serially.** `chats.setEquippedOutfit` reads the chat's whole
 *     `equippedOutfit` map, sets one key, and writes it back, so concurrent
 *     writers would lose every entry but the last.
 *
 * Resolves only once every character has landed one way or the other. Never
 * throws: a character that can't be resolved or persisted is logged and left
 * as-is rather than failing the chat around them.
 */
export async function applyOutfitSelections(
  chatId: string,
  selections: OutfitSelection[],
  repos: Repos,
  context?: OutfitSelectionContext,
): Promise<void> {
  const projectMountPointIds = context?.projectMountPointIds ?? [];

  // The project + general tiers are the same for every character in this batch,
  // and `findArchetypes` re-reads and YAML-parses every file in each shared
  // folder. Fetch them at most once, lazily — a batch of `manual`/`none`
  // selections shouldn't pay for a wardrobe read at all.
  let sharedPoolPromise: Promise<WardrobeItem[]> | null = null;
  const getSharedPool = (): Promise<WardrobeItem[]> => {
    if (!sharedPoolPromise) {
      sharedPoolPromise = repos.wardrobe
        .findArchetypes(false, { projectMountPointIds })
        .catch((error) => {
          logger.warn('[applyOutfitSelections] Failed to read shared wardrobe tiers; using the character vault alone', {
            chatId,
            projectMountCount: projectMountPointIds.length,
            error: getErrorMessage(error, 'Unknown error'),
          });
          return [] as WardrobeItem[];
        });
    }
    return sharedPoolPromise;
  };

  /**
   * The group tier can't join the batched read: it's keyed on the character's
   * own memberships, so each character gets their own. Read separately and
   * layered over the batch tiers below (group beats project beats general).
   */
  const getGroupTier = async (characterId: string): Promise<WardrobeItem[]> => {
    try {
      const { groupMountPointIds } = await sharedWardrobeTiersForCharacter(characterId, []);
      if (groupMountPointIds.length === 0) return [];
      return await repos.wardrobe.findArchetypesInMounts(groupMountPointIds, false);
    } catch (error) {
      logger.warn('[applyOutfitSelections] Failed to read group wardrobe tier; skipping it', {
        chatId,
        characterId,
        error: getErrorMessage(error, 'Unknown error'),
      });
      return [];
    }
  };

  // Per-character merged pool (shared tiers under the character's own vault),
  // memoized so a character whose `llm_choose` falls back to defaults doesn't
  // re-read their vault.
  const poolByCharacter = new Map<string, Promise<WardrobeItem[]>>();
  const getPool = (characterId: string): Promise<WardrobeItem[]> => {
    let pending = poolByCharacter.get(characterId);
    if (!pending) {
      pending = (async () => {
        const [batchShared, group] = await Promise.all([
          getSharedPool(),
          getGroupTier(characterId),
        ]);
        // Group last: a group's livery shadows the project's copy of the same id.
        const shared = [...batchShared, ...group];
        let own: WardrobeItem[] = [];
        try {
          own = await repos.wardrobe.findByCharacterId(characterId);
        } catch (error) {
          logger.warn('[applyOutfitSelections] Failed to read character wardrobe; using shared tiers alone', {
            chatId,
            characterId,
            error: getErrorMessage(error, 'Unknown error'),
          });
        }
        const pool = mergeWearablePool(shared, own);
        logger.debug('[applyOutfitSelections] Resolved wearable pool', {
          chatId,
          characterId,
          poolSize: pool.length,
          sharedCount: shared.length,
          groupCount: group.length,
          ownCount: own.length,
          projectMountCount: projectMountPointIds.length,
        });
        return pool;
      })();
      poolByCharacter.set(characterId, pending);
    }
    return pending;
  };

  /** Publish a resolved outfit to the status dialog. Never throws. */
  const publishPreview = async (
    characterId: string,
    characterName: string,
    slots: EquippedSlots,
  ): Promise<void> => {
    if (!context?.progress) return;
    try {
      const resolved = await resolveEquippedOutfitForCharacter(
        repos,
        characterId,
        slots,
        await sharedWardrobeTiersForCharacter(characterId, projectMountPointIds),
      );
      context.progress.wardrobeResult(
        characterId,
        characterName,
        toOutfitPreviewSlots(resolved.leafItemsBySlot),
      );
    } catch (resolveError) {
      logger.warn('[applyOutfitSelections] Failed to resolve outfit for progress preview', {
        chatId,
        characterId,
        error: getErrorMessage(resolveError, 'Unknown error'),
      });
    }
  };

  /**
   * Work out what a character should be wearing. Returns `null` when nothing
   * should be written at all (an unrecognised mode).
   *
   * Deliberately does **no** persistence: these run concurrently, and
   * `setEquippedOutfit` is a read-modify-write of a single JSON column keyed by
   * character, so concurrent writers would drop each other's entries. The
   * caller commits the results serially afterwards.
   */
  const resolveSelection = async (
    selection: OutfitSelection,
  ): Promise<EquippedSlots | null> => {
    const { characterId, mode } = selection;

    switch (mode) {
      case 'default':
        return buildDefaultOutfit(await getPool(characterId));

      case 'manual':
        return selection.slots ?? makeEmptyEquippedSlots();

      case 'none':
        return makeEmptyEquippedSlots();

      case 'previous_chat': {
        if (context?.sourceChatId) {
          try {
            const previousSlots = await repos.chats.getEquippedOutfitForCharacter(
              context.sourceChatId,
              characterId,
            );
            if (previousSlots) return previousSlots;
          } catch (error) {
            logger.warn('[applyOutfitSelections] Failed to copy previous-chat outfit; falling back to default', {
              chatId,
              characterId,
              sourceChatId: context.sourceChatId,
              error: getErrorMessage(error, 'Unknown error'),
            });
          }
        } else {
          logger.warn('[applyOutfitSelections] previous_chat outfit mode requested without sourceChatId; falling back to default', {
            chatId,
            characterId,
          });
        }
        return buildDefaultOutfit(await getPool(characterId));
      }

      case 'llm_choose': {
        let chosen: EquippedSlots | null = null;
        // Track whether we announced a consult so the fallback path can still
        // resolve the dialog's panel instead of leaving it spinning.
        let consulted = false;
        let consultedName = '';
        let deliberatelyUnclothed = false;

        if (context) {
          try {
            const character = await repos.characters.findById(characterId);
            // Candidates come from all three tiers: a character whose entire
            // wardrobe is shared used to fail this guard and fall through to
            // (empty) defaults without the LLM ever being consulted.
            const wardrobeItems = await getPool(characterId);

            if (character && wardrobeItems.length > 0) {
              const allProfiles = await repos.connections.findAll();
              const defaultProfile = allProfiles.find((p) => p.isDefault) || allProfiles[0];

              if (defaultProfile) {
                const cheapSelection = getCheapLLMProvider(
                  defaultProfile,
                  context.cheapLLMConfig || DEFAULT_CHEAP_LLM_CONFIG,
                  allProfiles,
                  false, // ollamaAvailable
                );

                // Narrate the slow bit: the dialog shows "Consulting the
                // wardrobe for <name>…" until the result lands.
                consulted = true;
                consultedName = character.name;
                context.progress?.wardrobeStart(characterId, character.name);

                // Optional dressing instructions: nearest tier's
                // `Wardrobe/instructions.md` wins (character > group >
                // project > general) and the search stops there. Soft-fails
                // to null — instructions never block the outfit choice.
                const { groupMountPointIds } = await sharedWardrobeTiersForCharacter(
                  characterId,
                  [],
                ).catch(() => ({ groupMountPointIds: [] as string[] }));
                const dressingInstructions = await resolveWardrobeInstructions({
                  characterMountPointId: character.characterDocumentMountPointId ?? null,
                  groupMountPointIds: groupMountPointIds ?? [],
                  projectMountPointIds,
                }).catch(() => null);
                if (dressingInstructions) {
                  logger.debug('[applyOutfitSelections] Dressing instructions in play', {
                    chatId,
                    characterId,
                    tier: dressingInstructions.tier,
                    mountPointId: dressingInstructions.mountPointId,
                  });
                }

                const startedAt = Date.now();
                const result = await withTimeout(
                  chooseLLMOutfit(
                    character.name,
                    character.description || null,
                    character.personality || null,
                    character.manifesto || null,
                    wardrobeItems,
                    context.scenarioText || null,
                    dressingInstructions?.content ?? null,
                    cheapSelection,
                    context.userId,
                    chatId,
                    characterId,
                  ),
                  OUTFIT_LLM_TIMEOUT_MS,
                );

                if (result === TIMED_OUT) {
                  logger.warn('[applyOutfitSelections] LLM outfit selection timed out, falling back to defaults', {
                    chatId,
                    characterId,
                    timeoutMs: OUTFIT_LLM_TIMEOUT_MS,
                    poolSize: wardrobeItems.length,
                  });
                } else {
                  // `chooseLLMOutfit` never fails parsing — it drops ids it
                  // can't validate and still reports success. An all-empty
                  // answer therefore means either "nothing usable" or "naked on
                  // purpose", and only the model's own `deliberate` flag tells
                  // the two apart. Without it, dress them in their defaults.
                  // Only the *clothing* slots count here: a pick of nothing but
                  // a hairdo is still "chose nothing to wear".
                  const picked =
                    !!result.result &&
                    CLOTHING_SLOT_TYPES.some((slot) => result.result!.slots[slot].length > 0);
                  const declaredBare = result.result?.deliberatelyUnclothed === true;

                  if (result.success && result.result && (picked || declaredBare)) {
                    // The prompt lets the model pick a bundle outright; break
                    // it into its parts before it's stored, so the wardrobe
                    // reads as garments rather than an opaque card.
                    chosen = dissolveBundlesInSlots(
                      result.result.slots,
                      new Map(wardrobeItems.map((i) => [i.id, i])),
                    );
                    deliberatelyUnclothed = declaredBare && !picked;
                  } else {
                    logger.warn('[applyOutfitSelections] LLM outfit selection failed, falling back to defaults', {
                      chatId,
                      characterId,
                      error: result.error,
                      emptyResult: result.success && !picked,
                      poolSize: wardrobeItems.length,
                      elapsedMs: Date.now() - startedAt,
                    });
                  }
                }
              }
            }
          } catch (error) {
            logger.warn('[applyOutfitSelections] Error during LLM outfit selection, falling back to defaults', {
              chatId,
              characterId,
              error: getErrorMessage(error, 'Unknown error'),
            });
          }
        }

        if (chosen) {
          if (deliberatelyUnclothed) {
            logger.info('[applyOutfitSelections] Character is deliberately unclothed by LLM choice', {
              chatId,
              characterId,
            });
            context?.progress?.log(`${consultedName} chose to wear nothing at all.`, 'info');
          }
          await publishPreview(characterId, consultedName, chosen);
          return chosen;
        }

        const slots = buildDefaultOutfit(await getPool(characterId));
        // If we already told the dialog we were consulting this character,
        // resolve their panel with the default we fell back to (and note it).
        if (consulted && context?.progress) {
          context.progress.log(`${consultedName} settled on their usual attire.`, 'warn');
          await publishPreview(characterId, consultedName, slots);
        }
        return slots;
      }

      default:
        logger.warn('[applyOutfitSelections] Unknown outfit selection mode', { chatId, characterId, mode });
        return null;
    }
  };

  // Resolve every character concurrently — the `llm_choose` path is a network
  // round trip apiece, and serially they added up (one stalled provider call
  // held up the whole cast). `allSettled` means we don't move on until every
  // character has landed one way or the other, and one character's blow-up
  // can't cancel its siblings.
  const resolved = await Promise.allSettled(selections.map(resolveSelection));

  // Commit serially, in the caller's order. `setEquippedOutfit` reads the chat's
  // whole `equippedOutfit` map, sets one key, and writes it back — running these
  // concurrently would lose every entry but the last.
  for (let i = 0; i < selections.length; i += 1) {
    const { characterId } = selections[i];
    const outcome = resolved[i];

    if (outcome.status === 'rejected') {
      logger.error('[applyOutfitSelections] Failed to resolve outfit; character left as-is', {
        chatId,
        characterId,
        error: getErrorMessage(outcome.reason, 'Unknown error'),
      });
      continue;
    }
    if (!outcome.value) continue;

    try {
      await repos.chats.setEquippedOutfit(chatId, characterId, outcome.value);
    } catch (error) {
      logger.error('[applyOutfitSelections] Failed to persist equipped outfit', {
        chatId,
        characterId,
        error: getErrorMessage(error, 'Unknown error'),
      });
    }
  }
}

/**
 * Build a CheapLLMConfig from a chatSettings row (or fall back to defaults).
 * Shared so callers don't have to repeat the same merge.
 */
export function buildCheapLLMConfig(
  chatSettings: { cheapLLMSettings?: CheapLLMSettings | null } | null | undefined,
): CheapLLMConfig {
  const settings = chatSettings?.cheapLLMSettings;
  if (!settings) return DEFAULT_CHEAP_LLM_CONFIG;
  return {
    ...DEFAULT_CHEAP_LLM_CONFIG,
    strategy: settings.strategy,
    fallbackToLocal: settings.fallbackToLocal,
    userDefinedProfileId: settings.userDefinedProfileId ?? undefined,
    defaultCheapProfileId: settings.defaultCheapProfileId ?? undefined,
  };
}
