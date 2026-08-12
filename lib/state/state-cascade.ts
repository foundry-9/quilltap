/**
 * Shared cascade resolver for the four-tier persistent state system:
 * **chat → project → group → general**.
 *
 * This is the single merge implementation, replacing the duplicated
 * `mergeState` helpers that previously lived in the state tool handler and the
 * chat get-state API route. It is consumed by:
 *   - the `state` LLM tool handler (`lib/tools/handlers/state-handler.ts`)
 *   - the chat get-state API route
 *   - both Pascal `$state` entrances (LLM run + manual popup)
 *
 * ## Precedence (shallow, top-level keys only)
 *
 *   merged = { ...general, ...group, ...project, ...chat }   // chat wins
 *
 * ## Group tier — the exactly-one rule
 *
 * A chat can surface more than one applicable group (a character in several
 * groups; or, in the participants-union scope, several characters each in
 * different groups). Merging an arbitrary one would be a silent lie, so the
 * group tier only contributes to `merged` when **exactly one** group applies.
 * With two or more the tier reports `status: 'ambiguous'` and merges nothing —
 * that group state is then reachable only by declaring the group explicitly
 * (see {@link resolveGroupForContext}).
 *
 * @module state/state-cascade
 */

import { getRepositories } from '@/lib/repositories/factory';
import { readGeneralState } from '@/lib/mount-index/general-state';
import { logger } from '@/lib/logger';
import type { ChatMetadata } from '@/lib/schemas/chat.types';
import type { Group } from '@/lib/schemas/group.types';

/**
 * How to determine which group(s) apply to a state read.
 *
 * - `character`: the responding character's own memberships (Knowledge's rule —
 *   a character only sees its own groups). Used by the LLM tool and Pascal.
 * - `participants-union`: the union across the chat's active character
 *   participants (`type === 'CHARACTER' && status !== 'removed'`; deliberately
 *   NOT filtered by `controlledBy`). Used by the API/UI merged view.
 * - `none`: no group tier at all.
 */
export type GroupScope =
  | { kind: 'character'; characterId: string }
  | { kind: 'participants-union' }
  | { kind: 'none' };

/** A resolvable group, trimmed to what the UI/errors need. */
export interface GroupCandidate {
  id: string;
  name: string;
}

export type GroupTierStatus = 'none' | 'single' | 'ambiguous';

/**
 * The outcome of applying the exactly-one rule.
 * - `none`: no candidate groups.
 * - `single`: exactly one; its state merged; `appliedGroupId` set.
 * - `ambiguous`: two or more; nothing merged.
 */
export interface GroupTier {
  status: GroupTierStatus;
  candidates: GroupCandidate[];
  appliedGroupId?: string;
}

export interface StateCascadeResult {
  chatState: Record<string, unknown>;
  projectState: Record<string, unknown>;
  groupState: Record<string, unknown>;
  generalState: Record<string, unknown>;
  merged: Record<string, unknown>;
  groupTier: GroupTier;
  projectId?: string;
}

/** Error codes for {@link resolveGroupForContext}. */
export type StateGroupResolutionCode =
  | 'GROUP_NOT_FOUND'
  | 'GROUP_AMBIGUOUS'
  | 'NO_GROUPS'
  | 'GROUP_REF_REQUIRED';

/**
 * Thrown when an explicit group-context op cannot pin down exactly one group.
 * Carries the candidate list so the caller can surface a helpful message.
 */
export class StateGroupResolutionError extends Error {
  constructor(
    message: string,
    public readonly code: StateGroupResolutionCode,
    public readonly candidates: GroupCandidate[],
  ) {
    super(message);
    this.name = 'StateGroupResolutionError';
  }
}

function asStateObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Format a candidate list as `"Name (id)"` for error messages. */
function formatCandidates(candidates: GroupCandidate[]): string {
  return candidates.map((c) => `"${c.name}" (${c.id})`).join(', ');
}

/**
 * Collect the group IDs implied by a scope, deduplicated.
 * Reads memberships via the hot-path `findByCharacterId` index.
 */
async function collectGroupIds(chat: ChatMetadata, scope: GroupScope): Promise<string[]> {
  const repos = getRepositories();
  const ids = new Set<string>();

  const addForCharacter = async (characterId: string) => {
    const memberships = await repos.groupCharacterMembers.findByCharacterId(characterId);
    for (const m of memberships) ids.add(m.groupId);
  };

  if (scope.kind === 'character') {
    await addForCharacter(scope.characterId);
  } else if (scope.kind === 'participants-union') {
    for (const p of chat.participants ?? []) {
      // Union across active character participants. Deliberately NOT filtered
      // by `controlledBy` — the merged view spans every character at the table.
      if (p.type !== 'CHARACTER') continue;
      if (!p.characterId) continue;
      if (p.status === 'removed') continue;
      await addForCharacter(p.characterId);
    }
  }
  // scope.kind === 'none' → no ids.

  return [...ids];
}

/**
 * Hydrate the candidate groups for a scope, fail-soft per group: a group whose
 * store is unavailable is logged and dropped rather than failing the read.
 */
export async function resolveGroupCandidates(
  chat: ChatMetadata,
  scope: GroupScope,
): Promise<Group[]> {
  const repos = getRepositories();
  const ids = await collectGroupIds(chat, scope);
  const groups: Group[] = [];
  for (const id of ids) {
    try {
      const group = await repos.groups.findById(id);
      if (group) groups.push(group);
    } catch (error) {
      logger.warn('[StateCascade] Could not hydrate a candidate group; skipping', {
        groupId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return groups;
}

/**
 * Resolve the full four-tier cascade for a chat, applying the exactly-one rule
 * to the group tier. Project and general tiers degrade to `{}` on any failure
 * (state is enrichment, never load-bearing for the chat's own read).
 */
export async function resolveStateCascade(params: {
  chat: ChatMetadata;
  groupScope: GroupScope;
}): Promise<StateCascadeResult> {
  const { chat, groupScope } = params;
  const repos = getRepositories();

  const chatState = asStateObject(chat.state);

  // --- Project tier (graceful degradation) ---
  let projectState: Record<string, unknown> = {};
  const projectId = chat.projectId || undefined;
  if (projectId) {
    try {
      const project = await repos.projects.findById(projectId);
      if (project) {
        projectState = asStateObject(project.state);
      }
    } catch (projectError) {
      logger.warn('[StateCascade] Could not load project state for merge; using {}', {
        chatId: chat.id,
        projectId,
        error: projectError instanceof Error ? projectError.message : String(projectError),
      });
    }
  }

  // --- Group tier (exactly-one rule) ---
  const candidateGroups = await resolveGroupCandidates(chat, groupScope);
  const candidates: GroupCandidate[] = candidateGroups.map((g) => ({ id: g.id, name: g.name }));

  let groupState: Record<string, unknown> = {};
  let groupTier: GroupTier;
  if (candidateGroups.length === 0) {
    groupTier = { status: 'none', candidates };
  } else if (candidateGroups.length === 1) {
    groupState = asStateObject(candidateGroups[0].state);
    groupTier = { status: 'single', candidates, appliedGroupId: candidateGroups[0].id };
  } else {
    // Two or more → skip the tier in the merged view.
    groupTier = { status: 'ambiguous', candidates };
  }

  // --- General tier (already fail-soft) ---
  const generalState = await readGeneralState();

  // --- Merge (chat wins) ---
  const merged: Record<string, unknown> = {
    ...generalState,
    ...groupState,
    ...projectState,
    ...chatState,
  };

  return {
    chatState,
    projectState,
    groupState,
    generalState,
    merged,
    groupTier,
    projectId,
  };
}

/**
 * Pin down exactly one group for an explicit group-context operation.
 *
 * Policy:
 *   - no candidates → `NO_GROUPS`
 *   - omitted ref + exactly one candidate → that candidate
 *   - omitted ref + 2+ candidates → `GROUP_REF_REQUIRED`
 *   - ref matches a candidate id → that candidate
 *   - else case-insensitive exact name match **among candidates only**:
 *       one match → it; multiple → `GROUP_AMBIGUOUS`; none → `GROUP_NOT_FOUND`
 */
export function resolveGroupForContext(params: {
  groupRef?: string;
  candidates: Group[];
}): Group {
  const { groupRef, candidates } = params;
  const brief: GroupCandidate[] = candidates.map((g) => ({ id: g.id, name: g.name }));

  if (candidates.length === 0) {
    throw new StateGroupResolutionError(
      'This character does not belong to any group, so there is no group state to reach.',
      'NO_GROUPS',
      brief,
    );
  }

  const ref = groupRef?.trim();
  if (!ref) {
    if (candidates.length === 1) return candidates[0];
    throw new StateGroupResolutionError(
      `More than one group applies; specify one by name or id: ${formatCandidates(brief)}.`,
      'GROUP_REF_REQUIRED',
      brief,
    );
  }

  // Exact id match wins outright.
  const byId = candidates.find((g) => g.id === ref);
  if (byId) return byId;

  // Case-insensitive exact name match, among candidates only.
  const lowered = ref.toLowerCase();
  const byName = candidates.filter((g) => g.name.toLowerCase() === lowered);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new StateGroupResolutionError(
      `More than one group is named "${ref}"; specify one by id: ${formatCandidates(
        byName.map((g) => ({ id: g.id, name: g.name })),
      )}.`,
      'GROUP_AMBIGUOUS',
      brief,
    );
  }

  throw new StateGroupResolutionError(
    `No group matching "${ref}" among this character's groups: ${formatCandidates(brief)}.`,
    'GROUP_NOT_FOUND',
    brief,
  );
}
