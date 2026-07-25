/**
 * Custom Tools — discovery, tier shadowing, and the shared execution core.
 *
 * Pascal deals from a roster of user-authored pseudo-tools: `Tools/*.tool.json`
 * documents living at the root of any document store. This module finds them,
 * resolves which definition wins when several stores name the same tool, and
 * runs one — validating parameters, drawing the roll, evaluating the outcome
 * table, and rendering the message.
 *
 * Two entrances share this core: the `run_custom` tool (a model rolls) and the
 * composer popup (the human rolls). Both land on {@link executeCustomTool} so a
 * roll means the same thing whoever asked for it.
 *
 * ## Freshness
 *
 * The roster is re-resolved at every assembly point and never cached across
 * turns. A `.tool.json` added, edited, or deleted mid-chat takes effect on the
 * next LLM call and the next popup open, with no "reload tools" step. This is
 * affordable — one folder listing per mount, against the local index — and it
 * is the only correct choice: edits to a document inside a mount don't reliably
 * touch the mount index, so an index-invalidated cache would miss exactly the
 * changes users most expect to see.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { listDatabaseFiles, readDatabaseDocument, DatabaseStoreError } from '@/lib/mount-index/database-store';
import {
  resolveTieredMountPool,
  type MountTier,
  type TieredMountPool,
} from '@/lib/mount-index/tiered-mount-pool';
import { getErrorMessage } from '@/lib/error-utils';
import { parsePath, getAtPath } from '@/lib/state/state-paths';
import {
  QtapCustomToolSchema,
  collectUnknownKeys,
  formatDefinitionIssues,
  isParamRef,
  isStateRef,
  MAX_LLM_OUTPUT_LENGTH,
  MAX_ROSTER_SIZE,
  TOOLS_FOLDER,
  TOOL_FILE_SUFFIX,
  type CustomToolLlm,
  type CustomToolParameter,
  type LlmComparator,
  type MetadataComparator,
  type NumberOrParamRef,
  type NumericComparator,
  type OutcomeState,
  type ParamComparator,
  type ParamRef,
  type QtapCustomTool,
  type RollRange,
  type StateRef,
  type Visibility,
  type When,
} from './custom-tool.types';
import { isPrimitive, metadataComparatorHolds } from './metadata-match';
import { evaluateToolGate, hasToolGate } from './tool-gate';

/**
 * The persistent-state view a run resolves `$state` references against — the
 * merged cascade (chat → project → group → general). Always an object; an
 * entrance that has no state to offer passes `{}`.
 */
export type CustomToolState = Record<string, unknown>;

/**
 * Resolve a `$state` reference against the merged state. Pure and total: it
 * returns the value at the path when present AND of the fallback's type, and
 * the fallback otherwise. It never throws — the required fallback is exactly
 * what makes a run always dealable.
 */
export function resolveStateValue(ref: StateRef, state: CustomToolState): number | string | boolean {
  const found = getAtPath(state ?? {}, parsePath(ref.$state));
  if (typeof found === typeof ref.fallback) {
    if (typeof found === 'number') return Number.isFinite(found) ? found : ref.fallback;
    if (typeof found === 'string' || typeof found === 'boolean') return found;
  }
  return ref.fallback;
}
import { formatDiceBreakdown, parseDiceNotation, rollNotation, type DiceNotation, type DiceRollResult } from './dice';

const CONTEXT = 'pascal.custom-tools';

/** Tier precedence, nearest first. A nearer tier shadows a farther one. */
const TIER_ORDER: MountTier[] = ['character', 'participant', 'group', 'project', 'global'];

/**
 * A definition found in a store, with the provenance needed to resolve
 * shadowing and to record what actually ran in `pascalMeta`.
 */
export interface DiscoveredCustomTool {
  definition: QtapCustomTool;
  tier: MountTier;
  mountPointId: string;
  mountName: string;
  /** Vault-relative path, so the UI can link to the file the user wrote. */
  definitionPath: string;
}

/** A `.tool.json` that failed to load — surfaced as a badge rather than hidden. */
export interface CustomToolLoadError {
  definitionPath: string;
  mountPointId: string;
  mountName: string;
  tier: MountTier;
  reason: string;
}

/** The resolved roster for one invoker's perspective. */
export interface CustomToolRoster {
  /** Runnable tools, keyed by name, after shadowing and `disabled` suppression. */
  tools: Map<string, DiscoveredCustomTool>;
  /** Definitions that could not be loaded. */
  errors: CustomToolLoadError[];
  /** Names dropped because the roster hit {@link MAX_ROSTER_SIZE}. */
  droppedForCap: string[];
}

/** Who is asking, and from where. */
export interface RosterContext {
  userId: string;
  chatId: string;
  /** The invoking character — their vault is the 'character' tier. */
  characterId?: string | null;
  characterMountPointId?: string | null;
  /** Every character in the chat — their vaults form the 'participant' tier. */
  characterIds?: string[];
  projectId?: string | null;
  /**
   * The invoking character's hydrated fact sheet, which availability gates are
   * answered against. Optional: a caller that already holds it (every one of
   * them does — the popup hydrates perspectives, the turn resolves a responding
   * character) passes it to spare a read, and one that doesn't leaves the
   * roster to fetch it, but only if some definition turns out to be gated.
   */
  metadata?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * True for a root-level `*.tool.json`.
 *
 * `listDatabaseFiles({ folder })` filters by PREFIX, so it happily returns
 * `Tools/nested/deep/x.tool.json`. Definitions are a flat root-level
 * convention; a nested file is somebody's archive, not a live tool.
 */
function isRootToolFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  if (!lower.endsWith(TOOL_FILE_SUFFIX)) return false;
  const rest = relativePath.slice(TOOLS_FOLDER.length + 1);
  return rest.length > 0 && !rest.includes('/');
}

/** List `Tools/*.tool.json` in a database-backed store. */
async function listToolFilesFromDatabase(mountPointId: string): Promise<string[]> {
  const entries = await listDatabaseFiles(mountPointId, { folder: TOOLS_FOLDER });
  return entries
    .filter((e) => e.kind !== 'folder' && isRootToolFile(e.relativePath))
    .map((e) => e.relativePath);
}

/**
 * List `Tools/*.tool.json` in an on-disk store (filesystem or obsidian).
 *
 * A missing `Tools/` folder is the normal case — it is a lazy convention like
 * Suparṇā's `Mail/`, never scaffolded — so ENOENT yields [] rather than an error.
 */
async function listToolFilesFromDisk(basePath: string): Promise<string[]> {
  const folder = path.join(basePath, TOOLS_FOLDER);
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(TOOL_FILE_SUFFIX))
      .map((e) => `${TOOLS_FOLDER}/${e.name}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw error;
  }
}

/** Read one definition's bytes, whichever kind of store holds it. */
async function readToolFile(
  mount: { id: string; mountType: string; basePath: string },
  relativePath: string
): Promise<string> {
  if (mount.mountType === 'database') {
    const { content } = await readDatabaseDocument(mount.id, relativePath);
    return content;
  }
  return fs.readFile(path.join(mount.basePath, relativePath), 'utf-8');
}

/**
 * Load every definition in one mount. Never throws: a broken file becomes an
 * error entry, because one malformed `.tool.json` must not take the whole
 * roster down with it.
 *
 * Exported for Pascal's Workbench, whose library view lists every store's
 * definitions — valid and broken alike — through this same read → parse →
 * validate sequence rather than a second copy of it.
 */
export async function loadToolsFromMount(
  mountPointId: string,
  tier: MountTier
): Promise<{ found: DiscoveredCustomTool[]; errors: CustomToolLoadError[] }> {
  const found: DiscoveredCustomTool[] = [];
  const errors: CustomToolLoadError[] = [];

  const repos = getRepositories();
  const mount = await repos.docMountPoints.findById(mountPointId);
  if (!mount || !mount.enabled) return { found, errors };

  const mountName = mount.name;

  let paths: string[];
  try {
    paths =
      mount.mountType === 'database'
        ? await listToolFilesFromDatabase(mountPointId)
        : await listToolFilesFromDisk(mount.basePath);
  } catch (error) {
    logger.warn('Custom-tool listing failed for mount', {
      context: CONTEXT,
      mountPointId,
      mountName,
      error: getErrorMessage(error),
    });
    return { found, errors };
  }

  // Same-mount duplicate `name` is a rejection (the spec's rule 5): within one
  // store there is no tier to break the tie, so neither file can be trusted to
  // be the one the author meant.
  const nameToPath = new Map<string, string>();

  for (const relativePath of paths) {
    let raw: string;
    try {
      raw = await readToolFile(mount, relativePath);
    } catch (error) {
      // Deleted between list and read — a race, not a defect. Skip quietly.
      if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') continue;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      errors.push({ definitionPath: relativePath, mountPointId, mountName, tier, reason: `could not be read: ${getErrorMessage(error)}` });
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      errors.push({ definitionPath: relativePath, mountPointId, mountName, tier, reason: `is not valid JSON: ${getErrorMessage(error)}` });
      continue;
    }

    const unknownKeys = collectUnknownKeys(parsedJson);
    if (unknownKeys.length > 0) {
      // Tolerated, not rejected — `persist` is a planned v2 key and an older
      // build must not choke on a newer file.
      logger.debug('Custom tool carries keys this build does not know', {
        context: CONTEXT,
        mountPointId,
        definitionPath: relativePath,
        unknownKeys,
      });
    }

    const result = QtapCustomToolSchema.safeParse(parsedJson);
    if (!result.success) {
      const reason = formatDefinitionIssues(result.error);
      errors.push({ definitionPath: relativePath, mountPointId, mountName, tier, reason });
      logger.debug('Custom tool rejected at load time', {
        context: CONTEXT,
        mountPointId,
        definitionPath: relativePath,
        reason,
      });
      continue;
    }

    const definition = result.data;
    const priorPath = nameToPath.get(definition.name);
    if (priorPath) {
      errors.push({
        definitionPath: relativePath,
        mountPointId,
        mountName,
        tier,
        reason: `defines "${definition.name}", which ${priorPath} in this same store already defines`,
      });
      continue;
    }
    nameToPath.set(definition.name, relativePath);

    found.push({ definition, tier, mountPointId, mountName, definitionPath: relativePath });
  }

  return { found, errors };
}

/** Bucket the pool into (tier, mountPointId) pairs in precedence order. */
function orderedMounts(pool: TieredMountPool): Array<{ tier: MountTier; mountPointId: string }> {
  const byTier: Record<MountTier, string[]> = {
    character: pool.characterMountPointId ? [pool.characterMountPointId] : [],
    participant: pool.participantMountPointIds,
    group: pool.groupMountPointIds,
    project: pool.projectMountPointIds,
    global: pool.globalMountPointId ? [pool.globalMountPointId] : [],
  };

  const ordered: Array<{ tier: MountTier; mountPointId: string }> = [];
  for (const tier of TIER_ORDER) {
    // Same-tier collisions resolve by mount id, lexicographically — arbitrary
    // but stable, so a roster never flickers between two equally-close stores.
    for (const mountPointId of [...byTier[tier]].sort()) {
      ordered.push({ tier, mountPointId });
    }
  }
  return ordered;
}

/**
 * The invoking character's fact sheet, for the availability gates.
 *
 * Fail-soft to `{}`: a vault that cannot be read is not a reason to abandon the
 * whole roster, and an empty sheet has a defined meaning at the gate (nothing
 * qualifies, nothing is disqualified — see `lib/pascal/tool-gate.ts`).
 */
async function loadInvokerMetadata(ctx: RosterContext): Promise<Record<string, unknown>> {
  if (ctx.metadata) return ctx.metadata;
  if (!ctx.characterId) return {};

  try {
    const character = await getRepositories().characters.findById(ctx.characterId);
    return character?.metadata ?? {};
  } catch (error) {
    logger.debug('Custom-tool gates: the invoker’s fact sheet could not be read, treating it as empty', {
      context: CONTEXT,
      chatId: ctx.chatId,
      characterId: ctx.characterId,
      error: getErrorMessage(error),
    });
    return {};
  }
}

/**
 * Resolve the roster for one invoker.
 *
 * Iterates tier buckets explicitly rather than flattening the pool: flattening
 * dedups into a Set and throws away the tier attribution that shadowing and
 * `pascalMeta.definitionTier` both depend on.
 */
export async function resolveCustomToolRoster(ctx: RosterContext): Promise<CustomToolRoster> {
  const pool = await resolveTieredMountPool(
    {
      userId: ctx.userId,
      characterId: ctx.characterId ?? null,
      characterMountPointId: ctx.characterMountPointId ?? null,
      characterIds: ctx.characterIds,
      projectId: ctx.projectId ?? null,
    },
    { includeParticipants: true }
  );

  const tools = new Map<string, DiscoveredCustomTool>();
  const errors: CustomToolLoadError[] = [];
  const droppedForCap: string[] = [];
  /** Names switched off by a nearer tier. They must stay off further out. */
  const suppressed = new Set<string>();

  // Fetched at most once, and only if a gated definition actually turns up:
  // most rosters carry none, and none of them should pay for a vault read.
  let sheet: Promise<Record<string, unknown>> | null = null;
  const invokerMetadata = (): Promise<Record<string, unknown>> => {
    sheet ??= loadInvokerMetadata(ctx);
    return sheet;
  };

  for (const { tier, mountPointId } of orderedMounts(pool)) {
    const { found, errors: mountErrors } = await loadToolsFromMount(mountPointId, tier);
    errors.push(...mountErrors);

    for (const entry of found) {
      const { name } = entry.definition;

      // Nearest tier wins. Once a name is decided — by a live definition or by
      // a `disabled` tombstone — farther tiers cannot revive it.
      if (tools.has(name) || suppressed.has(name)) continue;

      // The availability gate, and it runs BEFORE `disabled` on purpose. A
      // gated-out definition makes no claim on the name at all — not even a
      // tombstone — so a farther tier may still deal one. That is the useful
      // arrangement: a character's own vault holds the variant written for
      // characters like them, and the General store holds the plain one
      // everybody else gets. `disabled`, by contrast, stays absolute; a gated
      // tombstone ("suppress this name for novices") is simply both keys at
      // once, and reads exactly as it says.
      if (hasToolGate(entry.definition)) {
        const verdict = evaluateToolGate(entry.definition, await invokerMetadata());
        if (!verdict.available) {
          logger.debug('Custom tool withheld by its availability gate', {
            context: CONTEXT,
            name,
            tier,
            mountPointId,
            characterId: ctx.characterId ?? null,
            withheldBy: verdict.withheldBy,
          });
          continue;
        }
      }

      if (entry.definition.disabled) {
        suppressed.add(name);
        logger.debug('Custom tool suppressed by a disabled definition', {
          context: CONTEXT,
          name,
          tier,
          mountPointId,
        });
        continue;
      }

      if (tools.size >= MAX_ROSTER_SIZE) {
        droppedForCap.push(name);
        continue;
      }

      tools.set(name, entry);
    }
  }

  if (droppedForCap.length > 0) {
    // Never truncate silently — a missing tool with no explanation reads as a
    // bug in the feature rather than a cap the user can act on.
    logger.warn('Custom-tool roster hit its cap; tools were dropped', {
      context: CONTEXT,
      chatId: ctx.chatId,
      cap: MAX_ROSTER_SIZE,
      dropped: droppedForCap,
    });
  }


  return { tools, errors, droppedForCap };
}

/** Everything the Workbench library shows: every definition in every enabled store. */
export interface CustomToolLibrary {
  entries: DiscoveredCustomTool[];
  errors: CustomToolLoadError[];
}

/**
 * Enumerate every definition in every enabled store — the Workbench library.
 *
 * Deliberately NOT the tiered roster: no shadowing, no `disabled` suppression,
 * no per-invoker perspective, no cap. The library is the authoring surface, so
 * it shows the whole table face up; which definition would win a given chat
 * depends on the invoker and is not this function's question to answer.
 *
 * Tier attribution is meaningless without an invoker, so every entry carries
 * `'global'` — callers should not read anything into it.
 */
export async function listAllCustomTools(): Promise<CustomToolLibrary> {
  const repos = getRepositories();
  const mounts = await repos.docMountPoints.findEnabled();

  const entries: DiscoveredCustomTool[] = [];
  const errors: CustomToolLoadError[] = [];

  for (const mount of [...mounts].sort((a, b) => a.id.localeCompare(b.id))) {
    const { found, errors: mountErrors } = await loadToolsFromMount(mount.id, 'global');
    entries.push(...found);
    errors.push(...mountErrors);
  }

  return { entries, errors };
}

// ---------------------------------------------------------------------------
// Execution core
// ---------------------------------------------------------------------------

/**
 * What an LLM invoker hands back: the model's raw answer, or the technical
 * reason there is none. The invoker never sees the author's `errorMessage` —
 * translating failure into the author's words is the execution core's job.
 */
export type LlmInvokeResult =
  | { ok: true; output: string; provider?: string; model?: string }
  | { ok: false; reason: string };

/** What the core tells an invoker about the answer it is prepared to keep. */
export interface LlmInvokeOptions {
  /**
   * The effective output cap (the definition's `maxOutput`, or the default).
   * Advisory: the real invoker scales the call's token budget from it, so a
   * long-form consult is not starved at the provider. The core still enforces
   * the cap on whatever comes back.
   */
  maxOutputChars: number;
}

/**
 * The seam between the execution core and whatever actually talks to a model.
 * Injected by the entrances (`lib/pascal/llm-consult.ts` builds the real one)
 * so the core stays pure enough to test — and so the proving bench can hand in
 * a pretend oracle instead of spending money.
 */
export type LlmInvoker = (prompt: string, options?: LlmInvokeOptions) => Promise<LlmInvokeResult>;

/**
 * The consult as the rest of a run sees it — subjects, templates, and the roll
 * record all read from this one resolution.
 */
export interface LlmConsultResult {
  /** Whether the consult produced an answer. */
  ok: boolean;
  /** The model's trimmed answer on success; the author's `errorMessage` on failure. */
  output: string;
  /** The rendered prompt actually posed — the record of what was asked. */
  prompt: string;
  /** Technical failure reason. Logged and recorded, never spoken in the fiction. */
  reason?: string;
  provider?: string;
  model?: string;
}

/** The pair `when.llm` tests and `{{llm}}` renders. */
export type LlmSubject = Pick<LlmConsultResult, 'ok' | 'output'>;

/** A run that could not be completed. Never becomes a fabricated outcome. */
export class CustomToolRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomToolRunError';
  }
}

/** Resolved parameter values, post-default and post-clamp. */
export type ResolvedParams = Record<string, number | string | boolean>;

/** Everything a run produced — enough to post the message and fill pascalMeta. */
export interface CustomToolRunResult {
  tool: string;
  params: ResolvedParams;
  rollForm: 'range' | 'dice';
  notation?: string;
  raw: number;
  diceRolls?: number[];
  value: number;
  state: OutcomeState;
  outcomeIndex: number;
  /** The rendered outcome message, templates substituted. */
  message: string;
  /** Dice breakdown, or '' for Form A. */
  diceBreakdown: string;
  visibility: Visibility;
  /**
   * The metadata keys the winning outcome tested, and what they held when it
   * was tested. Absent when the winning row consulted no metadata.
   */
  metadataTested?: MetadataTested;
  /** The LLM consult, when the definition declares one. */
  llm?: LlmConsultResult;
}

/**
 * Validate and coerce caller-supplied parameters against the declarations.
 *
 * Unknown keys are rejected rather than ignored: a model passing `bonuss: 5`
 * has misunderstood the tool, and silently rolling without the bonus would look
 * like the tool worked.
 */
export function resolveParams(
  definition: QtapCustomTool,
  supplied: Record<string, unknown> | null | undefined,
  state: CustomToolState = {}
): ResolvedParams {
  const declared = definition.parameters ?? {};
  const given = supplied ?? {};

  for (const key of Object.keys(given)) {
    if (!(key in declared)) {
      throw new CustomToolRunError(
        `"${key}" is not a parameter of ${definition.name}` +
          (Object.keys(declared).length ? ` (expected: ${Object.keys(declared).join(', ')})` : ' (it takes none)')
      );
    }
  }

  const resolved: ResolvedParams = {};
  for (const [name, spec] of Object.entries(declared)) {
    resolved[name] = coerceParam(definition.name, name, spec, given[name], state);
  }
  return resolved;
}

function coerceParam(
  toolName: string,
  name: string,
  spec: CustomToolParameter,
  value: unknown,
  state: CustomToolState
): number | string | boolean {
  // An omitted parameter falls to its default, which may itself be a `$state`
  // reference resolved against the merged state (its fallback is type-checked
  // against this parameter's type at load time, so it always fits).
  if (value === undefined || value === null) {
    return isStateRef(spec.default) ? resolveStateValue(spec.default, state) : spec.default;
  }

  switch (spec.type) {
    case 'number':
    case 'integer': {
      // Models routinely pass numbers as strings; accept that rather than
      // failing a roll over a quoting habit.
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        throw new CustomToolRunError(`${toolName}: parameter "${name}" must be a number, got ${JSON.stringify(value)}`);
      }
      const rounded = spec.type === 'integer' ? Math.round(n) : n;
      return clamp(rounded, spec.min, spec.max);
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new CustomToolRunError(`${toolName}: parameter "${name}" must be a boolean, got ${JSON.stringify(value)}`);
    }
    case 'string':
      return typeof value === 'string' ? value : String(value);
  }
}

/** Clamp into the declared range. Bounds are optional and independent. */
function clamp(value: number, min?: number, max?: number): number {
  let out = value;
  if (min !== undefined && out < min) out = min;
  if (max !== undefined && out > max) out = max;
  return out;
}

/** Resolve a roll field: literal, `$param` reference, `$state` reference, or the field's default. */
function resolveRollField(
  toolName: string,
  field: string,
  spec: NumberOrParamRef | undefined,
  params: ResolvedParams,
  fallback: number,
  state: CustomToolState
): number {
  if (spec === undefined) return fallback;

  if (isParamRef(spec)) {
    const value = params[spec.$param];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new CustomToolRunError(
        `${toolName}: roll.${field} references "${spec.$param}", which resolved to ${JSON.stringify(value)} rather than a finite number`
      );
    }
    return value;
  }

  // A `$state` roll field resolves to its (numeric, load-checked) value or its
  // numeric fallback — never a failure, so a roll is always dealable.
  if (isStateRef(spec)) {
    const value = resolveStateValue(spec, state);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new CustomToolRunError(
        `${toolName}: roll.${field} $state reference resolved to ${JSON.stringify(value)} rather than a finite number`
      );
    }
    return value;
  }

  if (!Number.isFinite(spec)) {
    throw new CustomToolRunError(`${toolName}: roll.${field} is not a finite number`);
  }
  return spec;
}

/**
 * A uniform float in [min, max), drawn from crypto-strength randomness.
 *
 * `randomInt` only deals in integers, so the fraction comes from 6 random bytes
 * (48 bits — comfortably more precision than a double's 52-bit mantissa needs
 * for this, and far beyond what any outcome table can distinguish).
 */
function cryptoUniform(min: number, max: number): number {
  const bytes = randomBytes(6);
  let scaled = 0;
  for (const byte of bytes) scaled = scaled * 256 + byte;
  const fraction = scaled / 2 ** 48;
  return min + fraction * (max - min);
}

/** Draw the raw value for Form A, honouring `$param` and `$state` bounds. */
function rollRange(
  definition: QtapCustomTool,
  range: RollRange,
  params: ResolvedParams,
  state: CustomToolState
): { raw: number; value: number } {
  const min = resolveRollField(definition.name, 'min', range.min, params, 0, state);
  const max = resolveRollField(definition.name, 'max', range.max, params, 1, state);
  const multiplier = resolveRollField(definition.name, 'multiplier', range.multiplier, params, 1, state);
  const offset = resolveRollField(definition.name, 'offset', range.offset, params, 0, state);

  if (min > max) {
    throw new CustomToolRunError(
      `${definition.name}: the roll's low bound (${min}) is above its high bound (${max})`
    );
  }

  const raw = min === max ? min : cryptoUniform(min, max);

  // The transform order is fixed and load-bearing: multiply, then offset, then
  // round. Rounding first would quantise before the offset could shift it.
  let value = raw * multiplier;
  value = value + offset;
  if (range.round) value = Math.round(value);

  if (!Number.isFinite(value)) {
    throw new CustomToolRunError(`${definition.name}: the roll produced a value that is not a finite number`);
  }

  return { raw, value };
}

/** Everything an outcome test may be posed about. */
export interface OutcomeSubjects {
  /** The final post-transform value. */
  value: number;
  /** The raw pre-transform draw. */
  roll: number;
  /** The resolved parameters, post-default and post-clamp. */
  params: ResolvedParams;
  /**
   * The invoking character's metadata sheet, as hydrated from their vault's
   * `metadata.json`. Absent (or `{}`) when nobody in particular rolled — every
   * `metadata` test then fails and the catch-all answers.
   */
  metadata?: Record<string, unknown>;
  /**
   * The LLM consult's result. Absent when the definition declares no `llm`
   * block — an `llm` test then fails soft and the table falls through.
   */
  llm?: LlmSubject;
  /**
   * The merged persistent state (chat → project → group → general) that
   * `$state` comparator operands resolve against. Absent → treated as `{}`,
   * so every `$state` operand falls to its own fallback.
   */
  state?: CustomToolState;
}

/** The metadata keys a run actually consulted, and what they held at the time. */
export type MetadataTested = Record<string, number | string | boolean>;

/**
 * Resolve a comparator operand: a literal, or the value of the parameter it
 * references.
 *
 * The reference is validated at load time, so a failure here is a regression
 * rather than an authoring error — it throws instead of quietly declining to
 * match, which would look like the table simply skipping a row.
 */
function resolveOperand(
  toolName: string,
  operand: number | string | boolean | ParamRef | StateRef,
  params: ResolvedParams,
  label: string,
  state: CustomToolState
): number | string | boolean {
  // A `$state` operand resolves against the merged state, falling back to its
  // own (load-typed) fallback — it never throws, matching the metadata doctrine.
  if (isStateRef(operand)) return resolveStateValue(operand, state);

  if (!isParamRef(operand)) return operand;

  const value = params[operand.$param];
  if (value === undefined) {
    throw new CustomToolRunError(
      `${toolName}: ${label} references "${operand.$param}", which is not a declared parameter`
    );
  }
  return value;
}

/** Demand a number for an ordering comparison. Load-time validation precedes this. */
function requireNumber(toolName: string, value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CustomToolRunError(
      `${toolName}: ${label} cannot be ordered — it is ${JSON.stringify(value)} rather than a finite number`
    );
  }
  return value;
}

/** Demand a string for a containment comparison. Load-time validation precedes this. */
function requireString(toolName: string, value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new CustomToolRunError(
      `${toolName}: ${label} cannot be searched — it is ${JSON.stringify(value)} rather than a string`
    );
  }
  return value;
}

/**
 * Evaluate one comparator against one subject. Keys AND together, and an
 * operand may be a `$param` reference rather than a literal.
 */
function matchesComparator(
  toolName: string,
  comparator: NumericComparator | ParamComparator,
  subject: number | string | boolean,
  subjectLabel: string,
  params: ResolvedParams,
  state: CustomToolState
): boolean {
  const operandFor = (key: keyof ParamComparator): number | string | boolean =>
    resolveOperand(
      toolName,
      (comparator as ParamComparator)[key] as number | string | boolean | ParamRef | StateRef,
      params,
      `${subjectLabel} ${key}`,
      state
    );

  const order = (key: 'gt' | 'gte' | 'lt' | 'lte'): [number, number] => [
    requireNumber(toolName, subject, subjectLabel),
    requireNumber(toolName, operandFor(key), `${subjectLabel} ${key}`),
  ];

  if (comparator.gt !== undefined) {
    const [a, b] = order('gt');
    if (!(a > b)) return false;
  }
  if (comparator.gte !== undefined) {
    const [a, b] = order('gte');
    if (!(a >= b)) return false;
  }
  if (comparator.lt !== undefined) {
    const [a, b] = order('lt');
    if (!(a < b)) return false;
  }
  if (comparator.lte !== undefined) {
    const [a, b] = order('lte');
    if (!(a <= b)) return false;
  }
  if (comparator.eq !== undefined && subject !== operandFor('eq')) return false;
  if (comparator.neq !== undefined && subject === operandFor('neq')) return false;

  // Containment is strict and case-sensitive here, matching eq's exactness on
  // declared values; the forgiving variant lives with the LLM subject, whose
  // text is a model's prose rather than an author's literal.
  const wide = comparator as ParamComparator;
  const searched = (key: 'contains' | 'ncontains'): boolean =>
    requireString(toolName, subject, subjectLabel).includes(
      requireString(toolName, operandFor(key), `${subjectLabel} ${key}`)
    );

  if (wide.contains !== undefined && !searched('contains')) return false;
  if (wide.ncontains !== undefined && searched('ncontains')) return false;

  return true;
}

/**
 * Evaluate one comparator against one metadata key — the fail-soft twin of
 * {@link matchesComparator}.
 *
 * The semantics live in {@link metadataComparatorHolds}, shared verbatim with
 * the availability gate so the two can never drift; what this wrapper adds is
 * the two things the shared table cannot know about — how to resolve a
 * `$param`/`$state` operand, and where to log a declined row.
 *
 * `$param` operands still throw if they don't resolve: those ARE load-validated,
 * so a failure there is a regression rather than a fact about the character.
 */
function matchesMetadataComparator(
  toolName: string,
  comparator: MetadataComparator,
  key: string,
  metadata: Record<string, unknown>,
  params: ResolvedParams,
  state: CustomToolState
): boolean {
  return metadataComparatorHolds(comparator, key, metadata, {
    resolveOperand: (comparatorKey) =>
      resolveOperand(
        toolName,
        comparator[comparatorKey] as number | string | boolean | ParamRef | StateRef,
        params,
        `metadata "${key}" ${comparatorKey}`,
        state
      ),
    onDecline: (reason) =>
      logger.debug('Custom tool metadata test did not match', {
        context: CONTEXT,
        tool: toolName,
        key,
        reason,
      }),
  });
}

/**
 * Evaluate one comparator against the LLM consult — the second fail-soft
 * evaluator, for the same reason as {@link matchesMetadataComparator}: the
 * subject's run-time type is unknowable at load time, because the answer is
 * whatever the model chose to say.
 *
 * Reconciliation rules, chosen so an author testing an oracle they prompted
 * for "YES", "42", or "the west door" gets the match they meant:
 *
 * - `ok` tests the consult's success flag directly.
 * - Ordering comparators need the answer to parse as a finite number; an
 *   answer that doesn't simply declines the row (debug-logged).
 * - eq/neq compare numerically when both sides are numbers, and otherwise as
 *   trimmed, case-insensitive strings — a model that says "yes." instead of
 *   "YES" has still said yes. (Trailing sentence punctuation is also
 *   forgiven for that reason.)
 * - contains/ncontains search the answer for the operand under that same
 *   trimmed, case-insensitive reconciliation.
 *
 * `$param` operands still throw when they fail to resolve: those are
 * load-validated, so a failure is a regression, not a fact about the model.
 */
function matchesLlmComparator(
  toolName: string,
  comparator: LlmComparator,
  llm: LlmSubject,
  params: ResolvedParams,
  state: CustomToolState
): boolean {
  const decline = (reason: string): false => {
    logger.debug('Custom tool llm test did not match', { context: CONTEXT, tool: toolName, reason });
    return false;
  };

  if (comparator.ok !== undefined && comparator.ok !== llm.ok) return false;

  const answer = llm.output.trim();
  const numericAnswer = answer !== '' && Number.isFinite(Number(answer)) ? Number(answer) : null;

  const operandFor = (comparatorKey: Exclude<keyof LlmComparator, 'ok'>): number | string | boolean =>
    resolveOperand(
      toolName,
      (comparator as Record<string, unknown>)[comparatorKey] as number | string | boolean | ParamRef | StateRef,
      params,
      `the llm answer ${comparatorKey}`,
      state
    );

  for (const comparatorKey of ['gt', 'gte', 'lt', 'lte'] as const) {
    if (comparator[comparatorKey] === undefined) continue;
    const operand = operandFor(comparatorKey);
    if (numericAnswer === null || typeof operand !== 'number') {
      return decline(`${comparatorKey} orders ${JSON.stringify(answer)}, and only numbers can be ordered`);
    }
    const held =
      comparatorKey === 'gt'
        ? numericAnswer > operand
        : comparatorKey === 'gte'
          ? numericAnswer >= operand
          : comparatorKey === 'lt'
            ? numericAnswer < operand
            : numericAnswer <= operand;
    if (!held) return false;
  }

  const equalsAnswer = (operand: number | string | boolean): boolean => {
    if (typeof operand === 'number' && numericAnswer !== null) return numericAnswer === operand;
    const operandText = String(operand).trim().toLowerCase();
    const answerText = answer.toLowerCase();
    return answerText === operandText || answerText === `${operandText}.` || answerText === `${operandText}!`;
  };

  if (comparator.eq !== undefined && !equalsAnswer(operandFor('eq'))) return false;
  if (comparator.neq !== undefined && equalsAnswer(operandFor('neq'))) return false;

  // Containment under eq's reconciliation: trimmed, case-insensitive, and the
  // operand stringified — an author hunting "west door" should find "the West
  // Door", because the subject here is a model's prose, not a declared value.
  const containsAnswer = (operand: number | string | boolean): boolean =>
    answer.toLowerCase().includes(String(operand).trim().toLowerCase());

  if (comparator.contains !== undefined && !containsAnswer(operandFor('contains'))) return false;
  if (comparator.ncontains !== undefined && containsAnswer(operandFor('ncontains'))) return false;

  return true;
}

/**
 * Evaluate an outcome test. Every subject named must hold — bare comparators
 * against the final value, `roll` against the raw draw, `params` against what
 * the caller supplied, `metadata` against the invoking character's fact sheet.
 */
export function matchesWhen(when: When, subjects: OutcomeSubjects, toolName = 'custom tool'): boolean {
  if (when === true) return true;

  const { value, roll, params } = subjects;
  const metadata = subjects.metadata ?? {};
  const state = subjects.state ?? {};

  if (!matchesComparator(toolName, when, value, 'the rolled value', params, state)) return false;

  if (when.roll !== undefined && !matchesComparator(toolName, when.roll, roll, 'the raw roll', params, state)) {
    return false;
  }

  for (const [name, comparator] of Object.entries(when.params ?? {})) {
    const subject = params[name];
    if (subject === undefined) {
      // Load-time validation rejects a test of an undeclared parameter.
      throw new CustomToolRunError(`${toolName}: an outcome tests "${name}", which is not a declared parameter`);
    }
    if (!matchesComparator(toolName, comparator, subject, `parameter "${name}"`, params, state)) return false;
  }

  for (const [key, comparator] of Object.entries(when.metadata ?? {})) {
    if (!matchesMetadataComparator(toolName, comparator, key, metadata, params, state)) return false;
  }

  if (when.llm !== undefined) {
    // No consult ran (a definition without an `llm` block, or a simulation
    // that supplied none): the test fails soft, exactly like a metadata key
    // the character doesn't carry.
    if (!subjects.llm) {
      logger.debug('Custom tool llm test did not match — no consult ran', { context: CONTEXT, tool: toolName });
      return false;
    }
    if (!matchesLlmComparator(toolName, when.llm, subjects.llm, params, state)) return false;
  }

  return true;
}

/**
 * The metadata a winning outcome consulted, for the roll record.
 *
 * Only the keys that row actually tested, and only their primitive values —
 * which is every key it tested, since a row whose metadata comparator declined
 * (absent key, non-primitive value, wrong type) is precisely a row that did not
 * win. So the transcript records what the table saw, not the whole sheet: the
 * sheet is the character's business, and may hold things the room shouldn't.
 */
export function collectMetadataTested(
  when: When,
  metadata: Record<string, unknown> | undefined
): MetadataTested | undefined {
  if (when === true || when.metadata === undefined || !metadata) return undefined;

  const tested: MetadataTested = {};
  for (const key of Object.keys(when.metadata)) {
    const value = metadata[key];
    if (isPrimitive(value)) tested[key] = value;
  }
  return Object.keys(tested).length > 0 ? tested : undefined;
}

/**
 * Render a number for display: integers plain, floats to 4 significant digits.
 */
export function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // `toPrecision` can hand back exponential form for extremes; Number() folds
  // that back to the shortest faithful representation.
  return String(Number(value.toPrecision(4)));
}

/**
 * Substitute the four placeholder families. Plain string replacement — user
 * text is never interpreted, and an unknown placeholder is left as written.
 *
 * `{{metadata.key}}` follows that same leave-it-as-written rule when the key is
 * absent or holds a list or an object: the alternative — rendering an empty
 * string — would quietly eat the hole in the sentence, where the placeholder
 * left standing tells the author exactly which key their character lacks.
 */
export function renderTemplate(
  message: string,
  vars: {
    value: number;
    roll: number;
    dice: string;
    params: ResolvedParams;
    metadata?: Record<string, unknown>;
    /** The consult's result. Absent while rendering the consult's own prompt. */
    llm?: LlmSubject;
    /** The merged persistent state, for `{{state.path}}` placeholders. */
    state?: CustomToolState;
  }
): string {
  return message.replace(/\{\{([^}]+)\}\}/g, (whole, rawKey: string) => {
    const key = rawKey.trim();

    if (key === 'value') return formatValue(vars.value);
    if (key === 'roll') return formatValue(vars.roll);
    if (key === 'dice') return vars.dice;

    if (key === 'llm') {
      if (vars.llm) return vars.llm.output;
      logger.debug('Custom tool message references {{llm}} with no consult to render', { context: CONTEXT });
      return whole;
    }

    if (key.startsWith('params.')) {
      const name = key.slice('params.'.length);
      if (name in vars.params) {
        const v = vars.params[name];
        return typeof v === 'number' ? formatValue(v) : String(v);
      }
    }

    if (key.startsWith('metadata.')) {
      const name = key.slice('metadata.'.length);
      const v = vars.metadata?.[name];
      if (isPrimitive(v)) {
        return typeof v === 'number' ? formatValue(v) : String(v);
      }
      logger.debug('Custom tool message references metadata the character cannot render', {
        context: CONTEXT,
        placeholder: whole,
        reason: v === undefined ? 'no such metadata key' : 'the key does not hold a primitive',
      });
      return whole;
    }

    if (key.startsWith('state.')) {
      // `{{state.path}}` follows the `{{metadata.*}}` doctrine: render the value
      // when the path holds a primitive, otherwise leave the placeholder as
      // written so the hole in the sentence is visible rather than silently
      // eaten. `state.` is stripped and the remainder is a full state path.
      const statePath = key.slice('state.'.length);
      const v = getAtPath(vars.state ?? {}, parsePath(statePath));
      if (isPrimitive(v)) {
        return typeof v === 'number' ? formatValue(v) : String(v);
      }
      logger.debug('Custom tool message references state it cannot render', {
        context: CONTEXT,
        placeholder: whole,
        reason: v === undefined ? 'no such state path' : 'the path does not hold a primitive',
      });
      return whole;
    }

    logger.debug('Custom tool message carries an unknown placeholder', { context: CONTEXT, placeholder: whole });
    return whole;
  });
}

/**
 * Resolve a definition's LLM consult: render the prompt, pose it through the
 * injected invoker, and translate whatever happens into the author's terms.
 *
 * Fail-soft by design — a consult NEVER throws. A provider error, a timeout,
 * an empty answer, or an entrance that wired no invoker all land in the same
 * place: `ok: false` with the author's `errorMessage` as the output, so the
 * outcome table gets to deal with the silence the way its author wrote it to.
 */
async function resolveLlmConsult(
  toolName: string,
  spec: CustomToolLlm,
  prompt: string,
  invoke: LlmInvoker | undefined
): Promise<LlmConsultResult> {
  const failed = (reason: string): LlmConsultResult => {
    logger.warn('Custom tool LLM consult failed', { context: CONTEXT, tool: toolName, reason });
    return { ok: false, output: spec.errorMessage, prompt, reason };
  };

  if (!invoke) return failed('no LLM invoker was available in this context');

  // The author's own leash, or the default. errorMessage is never subject to
  // it — those are the author's words, kept whole.
  const maxOutput = spec.maxOutput ?? MAX_LLM_OUTPUT_LENGTH;

  let result: LlmInvokeResult;
  try {
    result = await invoke(prompt, { maxOutputChars: maxOutput });
  } catch (error) {
    return failed(getErrorMessage(error));
  }

  if (!result.ok) return failed(result.reason);

  const output = result.output.trim().slice(0, maxOutput).trim();
  if (output === '') return failed('the model returned an empty answer');

  return {
    ok: true,
    output,
    prompt,
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.model ? { model: result.model } : {}),
  };
}

/**
 * Run a definition: validate params, roll, transform, consult (when declared),
 * evaluate, render.
 *
 * No writes, no message posting — both entrances call this and then decide how
 * to announce the result. The one impurity is the optional LLM consult, which
 * arrives as an injected {@link LlmInvoker} so this stays testable and the
 * proving bench can substitute a pretend oracle.
 */
export async function executeCustomTool(
  definition: QtapCustomTool,
  suppliedParams: Record<string, unknown> | null | undefined,
  overrides?: {
    private?: boolean;
    metadata?: Record<string, unknown>;
    /** Merged persistent state for `$state` refs and `{{state.path}}`. Default {}. */
    state?: CustomToolState;
    llmInvoke?: LlmInvoker;
  }
): Promise<CustomToolRunResult> {
  const state = overrides?.state ?? {};
  const params = resolveParams(definition, suppliedParams, state);

  let raw: number;
  let value: number;
  let rollForm: 'range' | 'dice';
  let notation: string | undefined;
  let diceRolls: number[] | undefined;
  let diceBreakdown = '';

  if (typeof definition.roll === 'string') {
    rollForm = 'dice';
    const parsed = parseDiceNotation(definition.roll);
    if (!parsed) {
      // Load-time validation should have caught this; a regression here must
      // still fail loudly rather than invent a number.
      throw new CustomToolRunError(`${definition.name}: "${definition.roll}" is not dice notation this build can roll`);
    }
    const rolled: DiceRollResult = rollNotation(parsed);
    notation = definition.roll;
    diceRolls = rolled.results;
    diceBreakdown = formatDiceBreakdown(rolled);
    // Dice carry their own modifier; Form A's multiplier/offset/round do not
    // apply, so raw and value are the same total.
    raw = rolled.total;
    value = rolled.total;
  } else {
    rollForm = 'range';
    const range = definition.roll ?? {};
    const drawn = rollRange(definition, range, params, state);
    raw = drawn.raw;
    value = drawn.value;
  }

  const metadata = overrides?.metadata ?? {};

  // The consult runs AFTER the roll — its prompt may quote the draw — and
  // BEFORE the table, which may test its answer.
  let llm: LlmConsultResult | undefined;
  if (definition.llm) {
    const prompt = renderTemplate(definition.llm.prompt, { value, roll: raw, dice: diceBreakdown, params, metadata, state });
    llm = await resolveLlmConsult(definition.name, definition.llm, prompt, overrides?.llmInvoke);
  }

  const subjects: OutcomeSubjects = { value, roll: raw, params, metadata, state, ...(llm ? { llm } : {}) };
  const outcomeIndex = definition.outcomes.findIndex((o) => matchesWhen(o.when, subjects, definition.name));
  if (outcomeIndex < 0) {
    // The schema's mandatory trailing catch-all makes this unreachable.
    throw new CustomToolRunError(`${definition.name}: no outcome matched ${formatValue(value)}`);
  }
  const outcome = definition.outcomes[outcomeIndex];

  const message = renderTemplate(outcome.message, { value, roll: raw, dice: diceBreakdown, params, metadata, llm, state });
  const metadataTested = collectMetadataTested(outcome.when, metadata);

  const visibility: Visibility =
    overrides?.private === true
      ? 'whisper'
      : overrides?.private === false
        ? 'public'
        : (definition.defaultVisibility ?? 'public');

  return {
    tool: definition.name,
    params,
    rollForm,
    notation,
    raw,
    diceRolls,
    value,
    state: outcome.state,
    outcomeIndex,
    message,
    diceBreakdown,
    visibility,
    ...(metadataTested ? { metadataTested } : {}),
    ...(llm ? { llm } : {}),
  };
}

/** The Workbench audit: per-outcome hit counts over many simulated draws. */
export interface CustomToolAuditResult {
  runs: number;
  outcomes: Array<{ index: number; hits: number; share: number }>;
  valueMin: number;
  valueMax: number;
  valueMean: number;
}

/**
 * Deal many hands and count where they land — the proving bench's table audit.
 *
 * Same draw, same transform, same {@link matchesWhen} evaluation as
 * {@link executeCustomTool}, run `runs` times with one param resolution up
 * front. `renderTemplate` is deliberately skipped: it is the expensive step and
 * contributes nothing to hit rates.
 *
 * The result is one sample of a wider space — hit rates generally depend on the
 * supplied `params` and `metadata`, so a zero-hit row here may simply need a
 * different caller, not a different table.
 */
export function simulateOutcomes(
  definition: QtapCustomTool,
  suppliedParams: Record<string, unknown> | null | undefined,
  runs: number,
  metadata?: Record<string, unknown>,
  /**
   * A pretend consult, held fixed across every draw — the audit never spends a
   * real LLM call, let alone ten thousand of them. Hit rates for a table that
   * branches on the answer are therefore conditional on this one answer; the
   * bench says so beside the field.
   */
  llm?: LlmSubject,
  /** Mock merged state for `$state` refs. Default `{}` — every ref falls back. */
  state: CustomToolState = {}
): CustomToolAuditResult {
  const params = resolveParams(definition, suppliedParams, state);

  let parsedDice: DiceNotation | null = null;
  let rangeRoll: RollRange = {};
  if (typeof definition.roll === 'string') {
    parsedDice = parseDiceNotation(definition.roll);
    if (!parsedDice) {
      throw new CustomToolRunError(`${definition.name}: "${definition.roll}" is not dice notation this build can roll`);
    }
  } else {
    rangeRoll = definition.roll ?? {};
  }

  const hits = new Array<number>(definition.outcomes.length).fill(0);
  let valueMin = Infinity;
  let valueMax = -Infinity;
  let valueSum = 0;

  for (let i = 0; i < runs; i++) {
    let raw: number;
    let value: number;

    if (parsedDice) {
      const rolled = rollNotation(parsedDice);
      raw = rolled.total;
      value = rolled.total;
    } else {
      const drawn = rollRange(definition, rangeRoll, params, state);
      raw = drawn.raw;
      value = drawn.value;
    }

    const subjects: OutcomeSubjects = { value, roll: raw, params, metadata: metadata ?? {}, state, ...(llm ? { llm } : {}) };
    const outcomeIndex = definition.outcomes.findIndex((o) => matchesWhen(o.when, subjects, definition.name));
    if (outcomeIndex < 0) {
      // The schema's mandatory trailing catch-all makes this unreachable.
      throw new CustomToolRunError(`${definition.name}: no outcome matched ${formatValue(value)}`);
    }
    hits[outcomeIndex] += 1;

    if (value < valueMin) valueMin = value;
    if (value > valueMax) valueMax = value;
    valueSum += value;
  }

  return {
    runs,
    outcomes: hits.map((count, index) => ({ index, hits: count, share: runs > 0 ? count / runs : 0 })),
    valueMin: runs > 0 ? valueMin : 0,
    valueMax: runs > 0 ? valueMax : 0,
    valueMean: runs > 0 ? valueSum / runs : 0,
  };
}
