/**
 * Side-effect applier — where a custom tool's resolved effects actually land.
 *
 * The execution core (`executeCustomTool`) resolves a run's effects pure —
 * which effect fires, what value it writes — and both entrances hand the
 * result here. This module decides WHERE each write goes and issues the
 * writes, batched one per touched store.
 *
 * ## "Write where it lives"
 *
 * A `state.<path>` effect lands at the tier whose top-level first path segment
 * already exists, searched in cascade-precedence order chat → project → group
 * → general (the project tier only when the cascade carries a `projectId`, the
 * group tier only under the exactly-one rule, `groupTier.status === 'single'`).
 * A key found nowhere defaults to the CHAT tier — the most local store, the
 * least blast radius. The search runs against the local working copies, so an
 * earlier effect that minted a fresh key at the chat tier pins later writes of
 * that key there too.
 *
 * Known consequence, documented rather than fixed: with two or more applicable
 * groups the cascade's group tier contributes nothing (the exactly-one rule),
 * so a key living only in group state is invisible to this search and the
 * effect shadows it at the chat tier — consistent with what a read of the
 * merged cascade would have shown.
 *
 * ## Job-child safety
 *
 * Every write goes through the buffered `getRepositories()` proxy, and the
 * cascade and metadata snapshot are read once at run start and never re-read —
 * no read-your-writes anywhere (the BACKGROUND_JOBS_CHILD contract). State
 * tiers and character metadata are whole-object replaces, so an effect racing
 * a same-turn `state` call can lose one side; that is the pre-existing
 * accepted risk from state-cascade.md, and re-reading just before the write is
 * deliberately rejected because the job child forbids it.
 *
 * ## Never throws
 *
 * The roll already happened and Pascal still announces. Each store's write is
 * individually try/caught (including `CharacterVaultUnavailableError` when a
 * vault disappears mid-run); a failed store logs a warning and its effects
 * drop from the applied list.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { writeGeneralState } from '@/lib/mount-index/general-state';
import { getErrorMessage } from '@/lib/error-utils';
import { getAtPath, setAtPath } from '@/lib/state/state-paths';
import type { StateCascadeResult } from '@/lib/state/state-cascade';
import { isApplicableEffect, type ResolvedEffect } from './custom-tools';

const CONTEXT = 'pascal.side-effects';

/** The four stores a state effect can land in. */
export type EffectTier = 'chat' | 'project' | 'group' | 'general';

/** One write that actually landed — the shape `pascalMeta.effects` records. */
export interface AppliedEffect {
  /** The effect's raw target ("state.encounter.count", "metadata.lockpick"). */
  target: string;
  /** What the store held before, when it held anything. */
  previous?: unknown;
  /** What was written. */
  next: unknown;
  /** Which store a state write landed in. Absent on metadata writes. */
  tier?: EffectTier;
}

export interface ApplyCustomToolEffectsParams {
  chatId: string;
  toolName: string;
  /** The core's resolved effects; skipped entries are ignored here. */
  effects: ResolvedEffect[];
  /**
   * The whole cascade, read once at run start — the RMW base for every state
   * tier. null (the cascade could not be read) → state effects skip fail-soft.
   */
  cascade: StateCascadeResult | null;
  /** The rolling character. null → metadata effects skip fail-soft. */
  characterId: string | null;
  /** The character's fact sheet, hydrated at run start — the metadata RMW base. */
  metadataSnapshot: Record<string, unknown>;
}

/** Every store an application may touch, for the ordered commit below. */
type Store = EffectTier | 'metadata';

/**
 * Apply a run's resolved effects. Returns the writes that landed, in effect
 * order, for `pascalMeta.effects`. Never throws.
 */
export async function applyCustomToolEffects(
  params: ApplyCustomToolEffectsParams
): Promise<AppliedEffect[]> {
  const { chatId, toolName, effects, cascade, characterId, metadataSnapshot } = params;

  const applicable = effects.filter(isApplicableEffect);
  if (applicable.length === 0) return [];

  // Local working copies — read once, mutated in effect order, committed once
  // per touched store. Sequential effects see each other's values through
  // these, never through a store re-read.
  const tiers = cascade
    ? {
        chat: { ...cascade.chatState },
        project: { ...cascade.projectState },
        group: { ...cascade.groupState },
        general: { ...cascade.generalState },
      }
    : null;
  let metadataNext: Record<string, unknown> | null = null;

  const skip = (reason: string, detail: Record<string, unknown> = {}): void => {
    logger.debug('Custom tool effect not applied', { context: CONTEXT, chatId, tool: toolName, reason, ...detail });
  };

  /** Applications in effect order, each tagged with the store it rode. */
  const pending: Array<{ store: Store; entry: AppliedEffect }> = [];

  for (const effect of applicable) {
    const { target, value } = effect;

    if (target.kind === 'metadata') {
      if (!characterId) {
        // A run nobody made writes to nobody's sheet.
        skip('no rolling character, metadata effect skipped', { target: target.raw });
        continue;
      }
      metadataNext ??= { ...metadataSnapshot };
      const previous = metadataNext[target.key];
      metadataNext[target.key] = value;
      pending.push({
        store: 'metadata',
        entry: { target: target.raw, ...(previous !== undefined ? { previous } : {}), next: value },
      });
      continue;
    }

    if (!tiers || !cascade) {
      skip('state cascade unavailable, state effect skipped', { target: target.raw });
      continue;
    }

    const first = target.path[0];

    // Underscore guard, re-checked at apply time — defense in depth behind the
    // load-time rejection in `parseEffectTarget`.
    if (typeof first === 'string' && first.startsWith('_')) {
      logger.warn('Custom tool effect refused — underscore-guarded state key', {
        context: CONTEXT,
        chatId,
        tool: toolName,
        target: target.raw,
      });
      continue;
    }

    const tier = resolveTier(tiers, cascade, String(first));
    const store = tiers[tier];
    const previous = getAtPath(store, target.path);
    setAtPath(store, target.path, value);
    pending.push({
      store: tier,
      entry: { target: target.raw, ...(previous !== undefined ? { previous } : {}), next: value, tier },
    });
  }

  // Commit — at most one write per touched store, each individually fail-soft.
  const touched = new Set<Store>(pending.map((p) => p.store));
  const failed = new Set<Store>();
  const repos = getRepositories();

  const commit = async (store: Store, write: () => Promise<unknown>): Promise<void> => {
    if (!touched.has(store)) return;
    try {
      await write();
    } catch (error) {
      failed.add(store);
      logger.warn('Custom tool effect write failed; those effects were dropped', {
        context: CONTEXT,
        chatId,
        tool: toolName,
        store,
        error: getErrorMessage(error),
      });
    }
  };

  await commit('chat', () => repos.chats.update(chatId, { state: tiers!.chat }));
  await commit('project', () => repos.projects.update(cascade!.projectId!, { state: tiers!.project }));
  await commit('group', () => repos.groups.update(cascade!.groupTier.appliedGroupId!, { state: tiers!.group }));
  await commit('general', () => writeGeneralState(tiers!.general));
  await commit('metadata', () => repos.characters.update(characterId!, { metadata: metadataNext! }));

  const applied = pending.filter((p) => !failed.has(p.store)).map((p) => p.entry);

  if (applied.length > 0) {
    logger.debug('Custom tool effects applied', {
      context: CONTEXT,
      chatId,
      tool: toolName,
      applied: applied.map((entry) => entry.target),
    });
  }

  return applied;
}

/**
 * "Write where it lives": the first tier, in cascade-precedence order, whose
 * top-level object already carries the key. Found nowhere → the chat tier.
 */
function resolveTier(
  tiers: Record<EffectTier, Record<string, unknown>>,
  cascade: StateCascadeResult,
  firstSegment: string
): EffectTier {
  const searchable: EffectTier[] = ['chat'];
  if (cascade.projectId) searchable.push('project');
  if (cascade.groupTier.status === 'single') searchable.push('group');
  searchable.push('general');

  for (const tier of searchable) {
    if (Object.prototype.hasOwnProperty.call(tiers[tier], firstSegment)) return tier;
  }
  return 'chat';
}
