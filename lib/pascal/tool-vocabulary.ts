/**
 * Tool vocabulary — what a definition actually quotes.
 *
 * A custom tool's parameters are declared, so a form can be generated from
 * them. What the tool does with them is not: whether `visible_request` ever
 * reaches an outcome message, whether the table reads
 * `{{metadata.hasAnsibleAccess}}`, whether the roll's own value is even
 * mentioned. To the operator filling in the run dialog, all of that is
 * invisible — which is the confusion this module exists to remove.
 *
 * ## Quoted, not merely available
 *
 * Every field below reports an **occurrence**: a placeholder that appears in
 * some string Pascal renders (an outcome message, or the oracle prompt), or a
 * metadata key some `when` clause tests, or a `$state` reference the definition
 * carries. A tool that rolls dice but never writes `{{dice}}` does not quote it,
 * and the dialog does not offer it. The list is what this tool says, not what
 * the format permits.
 *
 * ## What this deliberately is, and is not
 *
 * It is a **vocabulary**: the names a tool quotes. It is emphatically **not the
 * odds** — no roll spec, no thresholds, no outcome table, nothing about which
 * value wins which row. The custom-tools roster endpoint withholds all of that
 * on purpose (see its file header), and this summary keeps that line: it says
 * "this tool reads `hasAnsibleAccess`", never "it succeeds when
 * `hasAnsibleAccess` is true".
 */

import { isStateRef, parseEffectTarget, type QtapCustomTool } from './custom-tool.types';

/** The placeholder families `renderTemplate` understands. */
const PLACEHOLDER_PATTERN = /\{\{([^}]+)\}\}/g;

const PARAMS_PREFIX = 'params.';
const METADATA_PREFIX = 'metadata.';
const STATE_PREFIX = 'state.';

/** What a definition quotes. Every field means "this tool actually says so". */
export interface ToolVocabulary {
  /** True when some rendered string quotes `{{value}}`. */
  value: boolean;
  /** True when some rendered string quotes `{{roll}}`. */
  roll: boolean;
  /** True when some rendered string quotes `{{dice}}`. */
  dice: boolean;
  /** True when some rendered string quotes `{{llm}}`. */
  llm: boolean;
  /**
   * Declared parameters quoted as `{{params.name}}`. Restricted to declared
   * names: a placeholder naming a parameter that does not exist renders as
   * written, and offering it here would advertise a hole as a feature.
   */
  params: string[];
  /**
   * Keys of the invoking character's `metadata.json` this tool reads — from
   * `when.metadata` tests, from its availability gate, and from
   * `{{metadata.key}}` placeholders. Sorted.
   */
  metadata: string[];
  /**
   * Paths into the merged persistent state this tool reads — from `$state`
   * references and from `{{state.path}}` placeholders. Sorted.
   */
  state: string[];
  /**
   * State paths this tool's effects may WRITE. A write is a different claim
   * than a read — "this tool consults the encounter count" and "this tool
   * changes it" deserve different sentences — so writes get their own list
   * rather than folding into `state`. Sorted.
   */
  stateWrites: string[];
  /** Metadata keys this tool's effects may WRITE on the rolling character. Sorted. */
  metadataWrites: string[];
}

/** True when a tool quotes nothing at all, and so has no vocabulary to show. */
export function isEmptyVocabulary(vocabulary: ToolVocabulary): boolean {
  return (
    !vocabulary.value &&
    !vocabulary.roll &&
    !vocabulary.dice &&
    !vocabulary.llm &&
    vocabulary.params.length === 0 &&
    vocabulary.metadata.length === 0 &&
    vocabulary.state.length === 0 &&
    vocabulary.stateWrites.length === 0 &&
    vocabulary.metadataWrites.length === 0
  );
}

/**
 * Collect everything a definition quotes. Pure and total: a definition that
 * quotes nothing yields `false`s and empty lists rather than absent keys, so a
 * caller never has to distinguish "none" from "not computed".
 */
export function collectToolVocabulary(
  definition: Pick<QtapCustomTool, 'outcomes'> & Partial<QtapCustomTool>
): ToolVocabulary {
  const declared = new Set(Object.keys(definition.parameters ?? {}));
  const found = {
    value: false,
    roll: false,
    dice: false,
    llm: false,
    params: new Set<string>(),
    metadata: new Set<string>(),
    state: new Set<string>(),
    stateWrites: new Set<string>(),
    metadataWrites: new Set<string>(),
  };

  for (const outcome of definition.outcomes ?? []) {
    // A catch-all tests nothing, so it names nothing — but it still carries a
    // message, and that message may well quote a fact sheet.
    if (outcome.when !== true) {
      for (const key of Object.keys(outcome.when.metadata ?? {})) found.metadata.add(key);
    }
    collectPlaceholders(outcome.message, declared, found);
  }

  // The availability gate reads the same fact sheet, and naming its keys stays
  // on the right side of the odds line: that a tool consults `toolAbilities` is
  // vocabulary; that it is withheld unless `toolAbilities` contains
  // "programmable" is not, and is not said here. A gated-out tool never reaches
  // a roster listing at all, so this only ever describes one the reader has.
  for (const gate of [definition.availableWhen, definition.withheldWhen]) {
    for (const key of Object.keys(gate?.metadata ?? {})) found.metadata.add(key);
  }

  if (definition.llm) collectPlaceholders(definition.llm.prompt, declared, found);

  // The chip label is a rendered string like any outcome message.
  if (definition.chipLabel) collectPlaceholders(definition.chipLabel, declared, found);

  // Effects: an expression's `{{ref}}`s are the outcome-message vocabulary
  // verbatim, so the one placeholder scanner reads them too; a condition's
  // metadata keys are reads like an outcome row's; and each target is a WRITE,
  // reported on its own lists because it is a different claim than a read.
  for (const effect of definition.effects ?? []) {
    if (typeof effect.value === 'string') collectPlaceholders(effect.value, declared, found);
    for (const key of Object.keys(effect.when?.metadata ?? {})) found.metadata.add(key);

    const target = parseEffectTarget(effect.target);
    if (!target.ok) continue; // load-rejected; nothing honest to report
    if (target.target.kind === 'state') {
      found.stateWrites.add(target.target.raw.slice(STATE_PREFIX.length));
    } else {
      found.metadataWrites.add(target.target.key);
    }
  }

  // Every `$state` reference, wherever it sits — a parameter default, a roll
  // field, a comparator operand. Walked rather than enumerated: the schema is
  // free to grow new sites, and a list of them here would silently fall behind.
  collectStateRefs(definition, found.state);

  return {
    value: found.value,
    roll: found.roll,
    dice: found.dice,
    llm: found.llm,
    params: sorted(found.params),
    metadata: sorted(found.metadata),
    state: sorted(found.state),
    stateWrites: sorted(found.stateWrites),
    metadataWrites: sorted(found.metadataWrites),
  };
}

function sorted(values: Set<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

/** Harvest every placeholder family out of one rendered string. */
function collectPlaceholders(
  text: string,
  declared: ReadonlySet<string>,
  found: {
    value: boolean;
    roll: boolean;
    dice: boolean;
    llm: boolean;
    params: Set<string>;
    metadata: Set<string>;
    state: Set<string>;
  }
): void {
  PLACEHOLDER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_PATTERN.exec(text)) !== null) {
    const key = match[1].trim();

    if (key === 'value') {
      found.value = true;
      continue;
    }
    if (key === 'roll') {
      found.roll = true;
      continue;
    }
    if (key === 'dice') {
      found.dice = true;
      continue;
    }
    if (key === 'llm') {
      found.llm = true;
      continue;
    }
    if (key.startsWith(PARAMS_PREFIX)) {
      const name = key.slice(PARAMS_PREFIX.length);
      if (declared.has(name)) found.params.add(name);
      continue;
    }
    if (key.startsWith(METADATA_PREFIX)) {
      const name = key.slice(METADATA_PREFIX.length);
      if (name !== '') found.metadata.add(name);
      continue;
    }
    if (key.startsWith(STATE_PREFIX)) {
      const path = key.slice(STATE_PREFIX.length);
      if (path !== '') found.state.add(path);
    }
  }
}

/** Depth-first walk for `{ "$state": "..." }` objects anywhere in the tree. */
function collectStateRefs(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectStateRefs(item, into);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  if (isStateRef(node)) {
    into.add(node.$state);
    return;
  }
  for (const value of Object.values(node)) collectStateRefs(value, into);
}
