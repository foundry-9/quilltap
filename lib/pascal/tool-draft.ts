/**
 * Pascal's Workbench — the editable draft model.
 *
 * The Builder never edits a definition object directly: it edits a `ToolDraft`,
 * a form-friendly mirror in which numbers are text (as inputs hold them),
 * conditions are flat chips, and unknown top-level keys ride in an opaque bag.
 * This module is the bijection between the two shapes:
 *
 * - {@link draftFromDefinition} — a schema-valid document into a draft.
 * - {@link serializeDraft} — a draft into the canonical document §6.2 emits:
 *   `$schema` first, known keys in declaration order, defaulted optionals
 *   omitted, unknown keys appended verbatim, 2-space indent, trailing newline.
 * - {@link validateDraft} — every blocking error and advisory warning the form
 *   can detect, so the UI renders states rather than re-deriving rules.
 *
 * CLIENT-SAFE: imports only the (equally client-safe) schema module and the
 * pure dice-notation grammar. The browser validates with the same code the
 * roster loader runs — that is the whole design.
 */

import type { z } from 'zod';
import {
  COMPARATOR_KEYS,
  CONTAINMENT_KEYS,
  IDENTIFIER_PATTERN,
  MAX_CHIP_LABEL_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_EFFECTS,
  MAX_LLM_OUTPUT_CEILING,
  MAX_LLM_PROMPT_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_OUTCOMES,
  MAX_PARAMETERS,
  MAX_TITLE_LENGTH,
  ORDERING_KEYS,
  QtapCustomToolSchema,
  collectUnknownKeys,
  isParamRef,
  isStateRef,
  parseEffectTarget,
  scanPlaceholders,
  valueTypeOf,
  type ComparatorKey,
  type CustomToolEffect,
  type CustomToolOutcome,
  type CustomToolParameter,
  type EffectWhen,
  type NumberOrParamRef,
  type OutcomeState,
  type ParamComparator,
  type ParameterType,
  type GateComparator,
  type QtapCustomTool,
  type StateRef,
  type ToolGate,
  type ValueType,
  type Visibility,
  type WhenObject,
} from './custom-tool.types';
import { parseDiceNotation } from './dice-notation';
import { parseExpression } from './expressions';
import { escapeRegex } from '@/lib/utils/regex';

export type { ComparatorKey };

/** The `$schema` value the Builder writes when a file carries none. */
export const DEFAULT_SCHEMA_VALUE = '/schemas/qtap-custom-tool.schema.json';

let draftIdCounter = 0;
/**
 * Stable-enough ids for React keys within one session. Opaque: `prefix` only
 * helps a human reading the DOM, and every draft shape (this module's and the
 * Workbench sections') draws from the one counter.
 */
export function nextDraftId(prefix: string): string {
  draftIdCounter += 1;
  return `${prefix}-${draftIdCounter}`;
}

// ---------------------------------------------------------------------------
// Draft shapes
// ---------------------------------------------------------------------------

export interface DraftParameter {
  id: string;
  name: string;
  type: ParameterType;
  /**
   * Loose form value: text for number/integer/string, boolean for boolean, or a
   * `$state` reference object carried verbatim (the visual builder does not
   * author `$state` defaults, but round-trips them without loss).
   */
  defaultValue: string | boolean | StateRef;
  description: string;
  /** Loose numeric text; '' means unset. Numeric types only. */
  min: string;
  max: string;
}

/**
 * A roll field or comparator operand: a literal (as text), a `$param` pick, or
 * a `$state` reference. The builder does not author the `state` kind, but
 * carries it verbatim so a hand-written `$state` roll field survives a round
 * trip; `fallback` is the numeric fallback as text.
 */
export type NumberOrParamValue =
  | { kind: 'literal'; text: string }
  | { kind: 'param'; name: string }
  | { kind: 'state'; path: string; fallback: string };

export interface DraftRollRange {
  min: NumberOrParamValue;
  max: NumberOrParamValue;
  multiplier: NumberOrParamValue;
  offset: NumberOrParamValue;
  round: boolean;
}

/** What a condition chip tests. */
export type ConditionSubject =
  | { kind: 'value' }
  | { kind: 'roll' }
  | { kind: 'param'; name: string }
  | { kind: 'metadata'; key: string }
  /** The LLM consult's answer. */
  | { kind: 'llm' }
  /** Whether the LLM consult succeeded — serializes to the comparator's `ok` key. */
  | { kind: 'llm-ok' };

/** A literal operand — the three kinds an author types straight into a chip. */
export type LiteralOperand =
  | { kind: 'number'; text: string }
  | { kind: 'string'; text: string }
  | { kind: 'boolean'; value: boolean };

/** A condition chip's right-hand side. */
export type ConditionOperand =
  | LiteralOperand
  | { kind: 'param'; name: string }
  /** A `$state` reference, carried verbatim (builder does not author it). */
  | { kind: 'state'; path: string; fallback: number | string | boolean };

export interface DraftCondition {
  id: string;
  subject: ConditionSubject;
  comparator: ComparatorKey;
  operand: ConditionOperand;
}

export interface DraftOutcome {
  id: string;
  /** True only for the pinned tail. Its conditions array stays empty. */
  catchAll: boolean;
  conditions: DraftCondition[];
  state: OutcomeState;
  message: string;
}

/**
 * How the availability gate is posed. `none` emits neither key — the tool is
 * offered to everyone, which is what every file written before the gate existed
 * says by saying nothing.
 */
export type GateMode = 'none' | 'available' | 'withheld';

/**
 * One test in the availability gate. Deliberately narrower than
 * {@link DraftCondition}: the subject is always a metadata key, and the operand
 * is always a literal, because a gate is answered before there are parameters
 * or state to reference.
 */
export interface DraftGateCondition {
  id: string;
  /** The metadata key this test reads. */
  key: string;
  comparator: ComparatorKey;
  operand: LiteralOperand;
}

/**
 * One side effect, form-shaped.
 *
 * The form authors only the common `when` shapes — Always, or "on a given
 * outcome state". A hand-written richer condition (comparators, metadata,
 * llm…) is carried VERBATIM with a read-only badge, the established
 * `$state`-default precedent: the builder round-trips what it cannot author.
 */
export interface DraftEffect {
  id: string;
  when:
    | { kind: 'always' }
    | { kind: 'outcome-state'; state: OutcomeState }
    | { kind: 'verbatim'; when: EffectWhen };
  /** The target verbatim: `state.…` or `metadata.…`. */
  target: string;
  /** How `value` serializes: a JSON number, a JSON boolean, or an expression string. */
  valueKind: 'literal-number' | 'literal-boolean' | 'expression';
  /** Loose form text ('true'/'false' for booleans, numeric text, or expression source). */
  value: string;
}

export interface ToolDraft {
  name: string;
  title: string;
  /** Templated chip/heading label. '' = omitted — the title labels the chip. */
  chipLabel: string;
  description: string;
  disabled: boolean;
  /** Which availability clause the tool declares, if any. */
  gateMode: GateMode;
  /** The gate's tests. Kept while `gateMode` is 'none', like the roll fields. */
  gateConditions: DraftGateCondition[];
  revealOdds: boolean;
  defaultVisibility: Visibility;
  parameters: DraftParameter[];
  rollForm: 'range' | 'dice';
  /** Dice-notation text. Kept even while `rollForm` is 'range' (§4.3). */
  rollDice: string;
  /** Range fields. Kept even while `rollForm` is 'dice' (§4.3). */
  rollRange: DraftRollRange;
  /** Whether the tool consults an LLM. Off = no `llm` key is emitted. */
  llmEnabled: boolean;
  /** The consult's prompt template. Kept even while disabled, like the roll fields. */
  llmPrompt: string;
  /** The author's own words for a failed consult. Kept even while disabled. */
  llmErrorMessage: string;
  /** Loose numeric text for `llm.maxOutput`; '' means the default cap. */
  llmMaxOutput: string;
  /** Side effects, in application order. Empty = no `effects` key emitted. */
  effects: DraftEffect[];
  /** Ordered; the last entry is always the catch-all. */
  outcomes: DraftOutcome[];
  /** The `$schema` value to re-emit. */
  schemaValue: string;
  /** Unknown top-level keys, verbatim and in original order (§6.3). */
  unknownKeys: Array<[string, unknown]>;
}

// ---------------------------------------------------------------------------
// New-draft defaults (§8)
// ---------------------------------------------------------------------------

export function defaultRollRange(): DraftRollRange {
  return {
    min: { kind: 'literal', text: '' },
    max: { kind: 'literal', text: '' },
    multiplier: { kind: 'literal', text: '' },
    offset: { kind: 'literal', text: '' },
    round: false,
  };
}

/**
 * A fresh draft: range roll at its defaults (no `roll` key emitted), no
 * parameters, odds revealed, public — plus one empty non-catch-all row (in
 * error state, so the author is led to write a real outcome) above the
 * mandatory catch-all.
 */
export function newDraft(): ToolDraft {
  return {
    name: '',
    title: '',
    chipLabel: '',
    description: '',
    disabled: false,
    gateMode: 'none',
    gateConditions: [],
    revealOdds: true,
    defaultVisibility: 'public',
    parameters: [],
    rollForm: 'range',
    rollDice: '',
    rollRange: defaultRollRange(),
    llmEnabled: false,
    llmPrompt: '',
    llmErrorMessage: '',
    llmMaxOutput: '',
    effects: [],
    outcomes: [
      { id: nextDraftId('outcome'), catchAll: false, conditions: [], state: 'success', message: '' },
      {
        id: nextDraftId('outcome'),
        catchAll: true,
        conditions: [],
        state: 'info',
        message: 'The wheel gives {{value}}.',
      },
    ],
    schemaValue: DEFAULT_SCHEMA_VALUE,
    unknownKeys: [],
  };
}

// ---------------------------------------------------------------------------
// Definition → draft
// ---------------------------------------------------------------------------

/** Format a number the way an input holds it. */
function numberText(value: number): string {
  return String(value);
}

function rollFieldToValue(field: NumberOrParamRef | undefined): NumberOrParamValue {
  if (field === undefined) return { kind: 'literal', text: '' };
  if (isParamRef(field)) return { kind: 'param', name: field.$param };
  if (isStateRef(field)) return { kind: 'state', path: field.$state, fallback: String(field.fallback) };
  return { kind: 'literal', text: numberText(field) };
}

function operandToDraft(operand: number | string | boolean | { $param: string } | StateRef): ConditionOperand {
  if (isStateRef(operand)) return { kind: 'state', path: operand.$state, fallback: operand.fallback };
  if (isParamRef(operand)) return { kind: 'param', name: operand.$param };
  if (typeof operand === 'number') return { kind: 'number', text: numberText(operand) };
  if (typeof operand === 'boolean') return { kind: 'boolean', value: operand };
  return { kind: 'string', text: operand };
}

function comparatorToConditions(subject: ConditionSubject, comparator: ParamComparator): DraftCondition[] {
  const conditions: DraftCondition[] = [];
  for (const key of COMPARATOR_KEYS) {
    const operand = (comparator as Record<string, unknown>)[key];
    if (operand === undefined) continue;
    conditions.push({
      id: nextDraftId('cond'),
      subject,
      comparator: key,
      operand: operandToDraft(operand as number | string | boolean | { $param: string } | StateRef),
    });
  }
  return conditions;
}

/**
 * Flatten a `when` object into chips. Key order inside one comparator follows
 * {@link COMPARATOR_KEYS}; subjects follow the object's own order (value first,
 * then roll, params, metadata — the schema's declaration order).
 */
export function conditionsFromWhen(when: WhenObject): DraftCondition[] {
  const conditions: DraftCondition[] = [];

  conditions.push(...comparatorToConditions({ kind: 'value' }, when as ParamComparator));

  if (when.roll !== undefined) {
    conditions.push(...comparatorToConditions({ kind: 'roll' }, when.roll as ParamComparator));
  }

  for (const [name, comparator] of Object.entries(when.params ?? {})) {
    conditions.push(...comparatorToConditions({ kind: 'param', name }, comparator));
  }

  for (const [key, comparator] of Object.entries(when.metadata ?? {})) {
    conditions.push(...comparatorToConditions({ kind: 'metadata', key }, comparator));
  }

  if (when.llm !== undefined) {
    // `ok` is not a comparator key, so it gets its own chip kind; the loop
    // below only walks COMPARATOR_KEYS and never sees it.
    if (when.llm.ok !== undefined) {
      conditions.push({
        id: nextDraftId('cond'),
        subject: { kind: 'llm-ok' },
        comparator: 'eq',
        operand: { kind: 'boolean', value: when.llm.ok },
      });
    }
    conditions.push(...comparatorToConditions({ kind: 'llm' }, when.llm as ParamComparator));
  }

  return conditions;
}

/**
 * Flatten an availability gate into chips. Key order inside one comparator
 * follows {@link COMPARATOR_KEYS}; metadata keys follow the object's own order.
 */
export function gateConditionsFromGate(gate: ToolGate): DraftGateCondition[] {
  const conditions: DraftGateCondition[] = [];

  for (const [key, comparator] of Object.entries(gate.metadata)) {
    for (const comparatorKey of COMPARATOR_KEYS) {
      const operand = (comparator as Record<string, unknown>)[comparatorKey];
      if (operand === undefined) continue;
      conditions.push({
        id: nextDraftId('gate'),
        key,
        comparator: comparatorKey,
        operand:
          typeof operand === 'number'
            ? { kind: 'number', text: numberText(operand) }
            : typeof operand === 'boolean'
              ? { kind: 'boolean', value: operand }
              : { kind: 'string', text: String(operand) },
      });
    }
  }

  return conditions;
}

/**
 * Reassemble gate chips into a `ToolGate` — the inverse of
 * {@link gateConditionsFromGate}. Chips on the same key merge into one
 * comparator object; incomplete chips (blank key, unparseable number) are
 * skipped, which is safe because {@link validateDraft} blocks save while any
 * exist.
 */
export function gateFromConditions(conditions: DraftGateCondition[]): ToolGate | undefined {
  const metadata: Record<string, Record<string, unknown>> = {};

  for (const condition of conditions) {
    const key = condition.key.trim();
    if (!key) continue;

    let operand: number | string | boolean;
    if (condition.operand.kind === 'number') {
      const n = parseNumberText(condition.operand.text);
      if (!Number.isFinite(n)) continue;
      operand = n;
    } else if (condition.operand.kind === 'boolean') {
      operand = condition.operand.value;
    } else {
      if (condition.operand.text === '' && CONTAINMENT_KEYS.has(condition.comparator)) continue;
      operand = condition.operand.text;
    }

    metadata[key] = metadata[key] ?? {};
    metadata[key][condition.comparator] = operand;
  }

  return Object.keys(metadata).length > 0 ? ({ metadata } as ToolGate) : undefined;
}

/**
 * True when an effect's condition is exactly "the winning outcome IS this
 * state" — the one shape (besides Always) the form authors directly. Anything
 * richer rides verbatim.
 */
function isPlainOutcomeEq(when: EffectWhen): when is EffectWhen & { outcome: { eq: OutcomeState } } {
  const keys = Object.keys(when).filter((key) => (when as Record<string, unknown>)[key] !== undefined);
  return (
    keys.length === 1 &&
    keys[0] === 'outcome' &&
    when.outcome?.eq !== undefined &&
    when.outcome.neq === undefined
  );
}

function effectToDraft(effect: CustomToolEffect): DraftEffect {
  let when: DraftEffect['when'];
  if (effect.when === undefined) {
    when = { kind: 'always' };
  } else if (isPlainOutcomeEq(effect.when)) {
    when = { kind: 'outcome-state', state: effect.when.outcome.eq };
  } else {
    // Carried verbatim with a read-only badge — the $state-default precedent.
    when = { kind: 'verbatim', when: effect.when };
  }

  return {
    id: nextDraftId('effect'),
    when,
    target: effect.target,
    valueKind:
      typeof effect.value === 'number'
        ? 'literal-number'
        : typeof effect.value === 'boolean'
          ? 'literal-boolean'
          : 'expression',
    value: String(effect.value),
  };
}

/** The `effects` entry a draft effect emits — the inverse of {@link effectToDraft}. */
function effectFromDraft(effect: DraftEffect): CustomToolEffect {
  let when: EffectWhen | undefined;
  if (effect.when.kind === 'outcome-state') {
    when = { outcome: { eq: effect.when.state } } as EffectWhen;
  } else if (effect.when.kind === 'verbatim') {
    when = effect.when.when;
  }

  let value: number | boolean | string;
  if (effect.valueKind === 'literal-number') {
    value = parseNumberText(effect.value);
  } else if (effect.valueKind === 'literal-boolean') {
    value = effect.value === 'true';
  } else {
    value = effect.value;
  }

  return {
    ...(when !== undefined ? { when } : {}),
    target: effect.target,
    value,
  } as CustomToolEffect;
}

function outcomeToDraft(outcome: CustomToolOutcome): DraftOutcome {
  return {
    id: nextDraftId('outcome'),
    catchAll: outcome.when === true,
    conditions: outcome.when === true ? [] : conditionsFromWhen(outcome.when),
    state: outcome.state,
    message: outcome.message,
  };
}

function parameterToDraft(name: string, spec: CustomToolParameter): DraftParameter {
  return {
    id: nextDraftId('param'),
    name,
    type: spec.type,
    // A `$state` default is carried verbatim; otherwise it is loose form text.
    defaultValue: isStateRef(spec.default)
      ? spec.default
      : spec.type === 'boolean'
        ? Boolean(spec.default)
        : String(spec.default),
    description: spec.description ?? '',
    min: spec.min === undefined ? '' : numberText(spec.min),
    max: spec.max === undefined ? '' : numberText(spec.max),
  };
}

/** The two ways a definition's text can fail, and what it is when it doesn't. */
export type ParsedDefinitionText =
  | { ok: true; raw: unknown; definition: QtapCustomTool }
  /** Not JSON at all; `reason` is the parser's own message. */
  | { ok: false; stage: 'json'; reason: string }
  /** JSON, but not a definition; `raw` is kept so unknown keys can still be read off it. */
  | { ok: false; stage: 'schema'; raw: unknown; error: z.ZodError };

/**
 * Parse-then-validate a definition's text — the one place the editor turns
 * bytes into a checked document, so JSON mode, repair mode, the form switch,
 * and the save path cannot disagree about what "valid" means.
 */
export function parseDefinitionText(text: string): ParsedDefinitionText {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, stage: 'json', reason: error instanceof Error ? error.message : String(error) };
  }
  const validated = QtapCustomToolSchema.safeParse(raw);
  if (!validated.success) return { ok: false, stage: 'schema', raw, error: validated.error };
  return { ok: true, raw, definition: validated.data };
}

/**
 * Build a draft from a raw parsed JSON document. Returns null unless the
 * document passes `QtapCustomToolSchema` — an invalid file belongs in JSON
 * repair mode, never in the form.
 */
export function draftFromDefinition(raw: unknown): ToolDraft | null {
  const parsed = QtapCustomToolSchema.safeParse(raw);
  if (!parsed.success) return null;
  const definition = parsed.data;

  const rawRecord = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  // The loader's own notion of "unknown" (which already excludes `$schema`),
  // kept as [key, value] pairs in the file's order so they re-emit verbatim.
  const unknown = new Set(collectUnknownKeys(raw));
  const unknownKeys: Array<[string, unknown]> = Object.entries(rawRecord).filter(([key]) => unknown.has(key));

  const isDice = typeof definition.roll === 'string';
  const range = typeof definition.roll === 'object' && definition.roll !== null ? definition.roll : undefined;

  // At most one clause can be present — the schema rejects a file carrying both
  // — so the mode is simply whichever one is.
  const gate = definition.availableWhen ?? definition.withheldWhen;

  return {
    name: definition.name,
    title: definition.title ?? '',
    chipLabel: definition.chipLabel ?? '',
    description: definition.description,
    disabled: definition.disabled ?? false,
    gateMode: definition.availableWhen ? 'available' : definition.withheldWhen ? 'withheld' : 'none',
    gateConditions: gate ? gateConditionsFromGate(gate) : [],
    revealOdds: definition.revealOdds ?? true,
    defaultVisibility: definition.defaultVisibility ?? 'public',
    parameters: Object.entries(definition.parameters ?? {}).map(([name, spec]) => parameterToDraft(name, spec)),
    rollForm: isDice ? 'dice' : 'range',
    rollDice: isDice ? (definition.roll as string) : '',
    rollRange: range
      ? {
          min: rollFieldToValue(range.min),
          max: rollFieldToValue(range.max),
          multiplier: rollFieldToValue(range.multiplier),
          offset: rollFieldToValue(range.offset),
          round: range.round ?? false,
        }
      : defaultRollRange(),
    llmEnabled: definition.llm !== undefined,
    llmPrompt: definition.llm?.prompt ?? '',
    llmErrorMessage: definition.llm?.errorMessage ?? '',
    llmMaxOutput: definition.llm?.maxOutput === undefined ? '' : numberText(definition.llm.maxOutput),
    effects: (definition.effects ?? []).map(effectToDraft),
    outcomes: definition.outcomes.map(outcomeToDraft),
    schemaValue:
      typeof rawRecord.$schema === 'string' && rawRecord.$schema.length > 0
        ? rawRecord.$schema
        : DEFAULT_SCHEMA_VALUE,
    unknownKeys,
  };
}

// ---------------------------------------------------------------------------
// Draft → definition (canonical serialization, §6.2)
// ---------------------------------------------------------------------------

/** Parse loose numeric text. NaN for blank or unparseable. */
export function parseNumberText(text: string): number {
  if (text.trim() === '') return NaN;
  return Number(text);
}

function valueToRollField(value: NumberOrParamValue): NumberOrParamRef | undefined {
  if (value.kind === 'param') return value.name ? { $param: value.name } : undefined;
  if (value.kind === 'state') {
    const fallback = parseNumberText(value.fallback);
    return Number.isFinite(fallback) ? { $state: value.path, fallback } : undefined;
  }
  const n = parseNumberText(value.text);
  return Number.isFinite(n) ? n : undefined;
}

function operandFromDraft(operand: ConditionOperand): number | string | boolean | { $param: string } | StateRef | undefined {
  switch (operand.kind) {
    case 'param':
      return operand.name ? { $param: operand.name } : undefined;
    case 'state':
      return { $state: operand.path, fallback: operand.fallback };
    case 'number': {
      const n = parseNumberText(operand.text);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean':
      return operand.value;
    case 'string':
      return operand.text;
  }
}

/**
 * Reassemble chips into a `when` object — the exact inverse of
 * {@link conditionsFromWhen}. Conditions on the same subject merge into one
 * comparator object; incomplete chips (blank operand, blank metadata key) are
 * skipped, which is safe because {@link validateDraft} blocks save while any
 * exist.
 */
export function whenFromConditions(conditions: DraftCondition[]): WhenObject | undefined {
  const when: Record<string, unknown> = {};
  const roll: Record<string, unknown> = {};
  const params: Record<string, Record<string, unknown>> = {};
  const metadata: Record<string, Record<string, unknown>> = {};
  const llm: Record<string, unknown> = {};

  for (const condition of conditions) {
    const operand = operandFromDraft(condition.operand);
    if (operand === undefined) continue;

    switch (condition.subject.kind) {
      case 'value':
        when[condition.comparator] = operand;
        break;
      case 'roll':
        roll[condition.comparator] = operand;
        break;
      case 'llm':
        llm[condition.comparator] = operand;
        break;
      case 'llm-ok':
        // The chip is "succeeded = <bool>" (or ≠, its complement); either way
        // it serializes to the comparator's single boolean `ok` key.
        if (typeof operand === 'boolean') {
          llm.ok = condition.comparator === 'neq' ? !operand : operand;
        }
        break;
      case 'param': {
        const name = condition.subject.name;
        if (!name) continue;
        params[name] = params[name] ?? {};
        params[name][condition.comparator] = operand;
        break;
      }
      case 'metadata': {
        const key = condition.subject.key;
        if (!key) continue;
        metadata[key] = metadata[key] ?? {};
        metadata[key][condition.comparator] = operand;
        break;
      }
    }
  }

  if (Object.keys(roll).length > 0) when.roll = roll;
  if (Object.keys(params).length > 0) when.params = params;
  if (Object.keys(metadata).length > 0) when.metadata = metadata;
  if (Object.keys(llm).length > 0) when.llm = llm;

  return Object.keys(when).length > 0 ? (when as WhenObject) : undefined;
}

function parameterFromDraft(param: DraftParameter): CustomToolParameter {
  const numeric = param.type === 'number' || param.type === 'integer';

  let defaultValue: number | string | boolean | StateRef;
  if (isStateRef(param.defaultValue)) {
    // Carried verbatim — the builder never authored it, and must not lose it.
    defaultValue = param.defaultValue;
  } else if (param.type === 'boolean') {
    defaultValue = Boolean(param.defaultValue);
  } else if (numeric) {
    defaultValue = parseNumberText(String(param.defaultValue));
  } else {
    defaultValue = String(param.defaultValue);
  }

  const spec: CustomToolParameter = { type: param.type, default: defaultValue };
  if (param.description.trim() !== '') spec.description = param.description;
  if (numeric) {
    const min = parseNumberText(param.min);
    const max = parseNumberText(param.max);
    if (Number.isFinite(min)) spec.min = min;
    if (Number.isFinite(max)) spec.max = max;
  }
  return spec;
}

/** The `roll` value a draft emits, or undefined when wholly default (§6.2). */
function rollFromDraft(draft: ToolDraft): QtapCustomTool['roll'] | undefined {
  if (draft.rollForm === 'dice') {
    return draft.rollDice.trim() === '' ? undefined : draft.rollDice.trim();
  }

  const range: Record<string, unknown> = {};
  const min = valueToRollField(draft.rollRange.min);
  const max = valueToRollField(draft.rollRange.max);
  const multiplier = valueToRollField(draft.rollRange.multiplier);
  const offset = valueToRollField(draft.rollRange.offset);

  // Omit fields at their defaults so a re-saved minimal file stays minimal.
  if (min !== undefined && !(min === 0)) range.min = min;
  if (max !== undefined && !(max === 1)) range.max = max;
  if (multiplier !== undefined && !(multiplier === 1)) range.multiplier = multiplier;
  if (offset !== undefined && !(offset === 0)) range.offset = offset;
  if (draft.rollRange.round) range.round = true;

  return Object.keys(range).length > 0 ? (range as QtapCustomTool['roll']) : undefined;
}

/**
 * Serialize a draft to the plain object Save writes. Canonical: known keys in
 * declaration order, defaulted optionals omitted, unknown keys appended in
 * their original order, `$schema` first.
 */
export function definitionFromDraft(draft: ToolDraft): Record<string, unknown> {
  const doc: Record<string, unknown> = {};

  doc.$schema = draft.schemaValue || DEFAULT_SCHEMA_VALUE;
  doc.name = draft.name;
  if (draft.title.trim() !== '') doc.title = draft.title;
  if (draft.chipLabel.trim() !== '') doc.chipLabel = draft.chipLabel;
  doc.description = draft.description;
  if (draft.disabled) doc.disabled = true;
  if (draft.gateMode !== 'none') {
    const gate = gateFromConditions(draft.gateConditions);
    if (gate) doc[draft.gateMode === 'available' ? 'availableWhen' : 'withheldWhen'] = gate;
  }
  if (!draft.revealOdds) doc.revealOdds = false;
  if (draft.defaultVisibility !== 'public') doc.defaultVisibility = draft.defaultVisibility;

  if (draft.parameters.length > 0) {
    const parameters: Record<string, CustomToolParameter> = {};
    for (const param of draft.parameters) {
      if (!param.name) continue;
      parameters[param.name] = parameterFromDraft(param);
    }
    if (Object.keys(parameters).length > 0) doc.parameters = parameters;
  }

  const roll = rollFromDraft(draft);
  if (roll !== undefined) doc.roll = roll;

  if (draft.llmEnabled) {
    const llm: Record<string, unknown> = { prompt: draft.llmPrompt, errorMessage: draft.llmErrorMessage };
    // Omitted while blank — the default cap is the runtime's, not the file's.
    const maxOutput = parseNumberText(draft.llmMaxOutput);
    if (Number.isFinite(maxOutput)) llm.maxOutput = maxOutput;
    doc.llm = llm;
  }

  if (draft.effects.length > 0) {
    doc.effects = draft.effects.map(effectFromDraft);
  }

  doc.outcomes = draft.outcomes.map((outcome) => {
    if (outcome.catchAll) {
      return { when: true, message: outcome.message, state: outcome.state };
    }
    return {
      when: whenFromConditions(outcome.conditions) ?? {},
      message: outcome.message,
      state: outcome.state,
    };
  });

  for (const [key, value] of draft.unknownKeys) {
    doc[key] = value;
  }

  return doc;
}

/** The exact bytes Save writes: 2-space indent, trailing newline. */
export function serializeDraft(draft: ToolDraft): string {
  return `${JSON.stringify(definitionFromDraft(draft), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Validation (§6.1 and the §8 checklist)
// ---------------------------------------------------------------------------

export interface DraftIssue {
  /** Blocking errors gate save; warnings are advisory underlines. */
  severity: 'error' | 'warning';
  /** Where in the form the issue lives, for anchoring UI state. */
  where:
    | { section: 'identity'; field: 'name' | 'title' | 'chipLabel' | 'description' }
    | { section: 'gate'; conditionId?: string }
    | { section: 'options' }
    | { section: 'parameter'; id: string; field: 'name' | 'default' | 'min' | 'max' }
    | { section: 'roll'; field?: 'dice' | 'min' | 'max' | 'multiplier' | 'offset' }
    | { section: 'llm'; field: 'prompt' | 'errorMessage' | 'maxOutput' }
    | { section: 'effect'; id: string }
    | { section: 'outcome'; id: string; conditionId?: string }
    | { section: 'message'; id: string };
  message: string;
}

const err = (where: DraftIssue['where'], message: string): DraftIssue => ({ severity: 'error', where, message });
const warn = (where: DraftIssue['where'], message: string): DraftIssue => ({ severity: 'warning', where, message });

/** Names of declared numeric parameters. */
export function numericParamNames(draft: ToolDraft): string[] {
  return draft.parameters
    .filter((p) => p.type === 'number' || p.type === 'integer')
    .map((p) => p.name)
    .filter((name) => name.length > 0);
}

function validateNumberOrParam(
  value: NumberOrParamValue,
  field: 'min' | 'max' | 'multiplier' | 'offset',
  draft: ToolDraft,
  issues: DraftIssue[]
): void {
  if (value.kind === 'param') {
    if (!value.name) {
      issues.push(err({ section: 'roll', field }, `${field} needs a parameter picked`));
    } else if (!numericParamNames(draft).includes(value.name)) {
      issues.push(err({ section: 'roll', field }, `${field} references "${value.name}", which is not a declared numeric parameter`));
    }
    return;
  }
  if (value.kind === 'state') {
    // A `$state` roll field is valid iff its fallback is a finite number — the
    // same load-time rule `validateRollRefs` enforces on the definition.
    if (!Number.isFinite(parseNumberText(value.fallback))) {
      issues.push(err({ section: 'roll', field }, `${field} $state fallback must be a number`));
    }
    return;
  }
  if (value.text.trim() !== '' && !Number.isFinite(parseNumberText(value.text))) {
    issues.push(err({ section: 'roll', field }, `${field} is not a number`));
  }
}

/**
 * How one templated field treats `{{llm}}`: legitimate whenever the oracle is
 * on (messages, the chip label), or never — the consult prompt cannot quote an
 * answer that does not exist yet.
 */
type LlmPlaceholderRule = 'warn-if-disabled' | 'forbid';

/**
 * The placeholder audit every templated field shares — outcome messages, the
 * chip label, and the consult prompt. Warnings only: an unknown placeholder
 * renders as written, per the runtime convention, and the load-time schema
 * imposes no reference rule on any of these strings.
 *
 * Metadata keys are undeclared by nature: every `{{metadata.<key>}}` is
 * presumptively legitimate, and an absent key rendering verbatim at run time
 * is the runtime's convention, not an authoring error (§4.4.2). `{{state.…}}`
 * is the same kind of thing, but only the chip label has ever admitted it
 * (`allowState`); the message and prompt audits still flag it as unknown.
 */
function auditPlaceholders(
  text: string,
  where: DraftIssue['where'],
  draft: ToolDraft,
  issues: DraftIssue[],
  rules: { llm: LlmPlaceholderRule; allowState: boolean }
): void {
  const declaredParams = new Set(draft.parameters.map((p) => p.name));
  for (const { key, ref } of scanPlaceholders(text)) {
    switch (ref.kind) {
      case 'value':
      case 'roll':
      case 'metadata':
        break;
      case 'dice':
        if (draft.rollForm !== 'dice') {
          issues.push(warn(where, '{{dice}} renders as an empty string outside the dice form'));
        }
        break;
      case 'llm':
        if (rules.llm === 'forbid') {
          issues.push(warn(where, '{{llm}} is not available here — the consult cannot quote its own answer'));
        } else if (!draft.llmEnabled) {
          issues.push(warn(where, '{{llm}} renders as written unless the LLM consult is enabled'));
        }
        break;
      case 'params':
        if (!declaredParams.has(ref.name)) {
          issues.push(warn(where, `{{${key}}} names no declared parameter — it will render as written`));
        }
        break;
      case 'state':
        if (!rules.allowState) {
          issues.push(warn(where, `{{${key}}} is not a placeholder this build knows — it will render as written`));
        }
        break;
      case 'unknown':
        issues.push(warn(where, `{{${key}}} is not a placeholder this build knows — it will render as written`));
        break;
    }
  }
}

function validateMessagePlaceholders(outcome: DraftOutcome, draft: ToolDraft, issues: DraftIssue[]): void {
  auditPlaceholders(outcome.message, { section: 'message', id: outcome.id }, draft, issues, {
    llm: 'warn-if-disabled',
    allowState: false,
  });
}

/**
 * The chip label's placeholder audit — the same families an outcome message
 * takes, `{{llm}}` included (the label renders after the consult, so quoting
 * the answer is legitimate iff the oracle is enabled).
 */
function validateChipLabelPlaceholders(draft: ToolDraft, issues: DraftIssue[]): void {
  auditPlaceholders(draft.chipLabel, { section: 'identity', field: 'chipLabel' }, draft, issues, {
    llm: 'warn-if-disabled',
    allowState: true,
  });
}

/**
 * The consult prompt's own placeholder audit — the same families an outcome
 * message takes, minus `{{llm}}`: the consult cannot quote an answer that
 * does not exist yet.
 */
function validateLlmPromptPlaceholders(draft: ToolDraft, issues: DraftIssue[]): void {
  auditPlaceholders(draft.llmPrompt, { section: 'llm', field: 'prompt' }, draft, issues, {
    llm: 'forbid',
    allowState: false,
  });
}

function validateCondition(
  condition: DraftCondition,
  outcome: DraftOutcome,
  draft: ToolDraft,
  issues: DraftIssue[]
): void {
  const where: DraftIssue['where'] = { section: 'outcome', id: outcome.id, conditionId: condition.id };
  const paramByName = new Map(draft.parameters.map((p) => [p.name, p] as const));

  // Subject completeness.
  if (condition.subject.kind === 'metadata' && condition.subject.key.trim() === '') {
    issues.push(err(where, 'a metadata condition needs a key'));
    return;
  }
  if ((condition.subject.kind === 'llm' || condition.subject.kind === 'llm-ok') && !draft.llmEnabled) {
    issues.push(err(where, 'tests the LLM consult, but the consult is not enabled'));
    return;
  }
  if (
    condition.subject.kind === 'llm-ok' &&
    (ORDERING_KEYS.has(condition.comparator) || CONTAINMENT_KEYS.has(condition.comparator))
  ) {
    issues.push(err(where, 'whether the consult succeeded can only be tested with = or ≠'));
    return;
  }
  if (condition.subject.kind === 'param') {
    const target = paramByName.get(condition.subject.name);
    if (!target) {
      issues.push(err(where, `tests "${condition.subject.name}", which is not a declared parameter`));
      return;
    }
    // Ordering a non-numeric parameter is a load-time rejection; the UI never
    // offers it, but a parameter's type may have changed under the chip.
    if (ORDERING_KEYS.has(condition.comparator) && valueTypeOf(target.type) !== 'number') {
      issues.push(err(where, `${condition.comparator} orders "${condition.subject.name}", which is not numeric`));
    }
  }

  // Containment gets its own complete audit — subject and operand must both be
  // text where their types are knowable — and then returns, so the eq/neq and
  // ordering rules below never double-report the same chip.
  if (CONTAINMENT_KEYS.has(condition.comparator)) {
    const subjectType = subjectValueType(condition.subject, paramByName);
    if (subjectType !== null && subjectType !== 'string') {
      issues.push(err(where, `${condition.comparator} searches a ${subjectType}, and only text can contain text`));
    }
    const operand = condition.operand;
    if (operand.kind === 'number' || operand.kind === 'boolean') {
      issues.push(err(where, `${condition.comparator} needs text to look for`));
    } else if (operand.kind === 'string' && operand.text === '') {
      issues.push(err(where, 'the substring to look for must not be empty'));
    } else if (operand.kind === 'param') {
      const target = paramByName.get(operand.name);
      if (!operand.name || !target) {
        issues.push(err(where, `compares against "${operand.name || '(no parameter)'}", which is not declared`));
      } else if (valueTypeOf(target.type) !== 'string') {
        issues.push(err(where, `${condition.comparator} needs text to look for; "${operand.name}" is ${target.type}`));
      }
    }
    return;
  }

  // Operand completeness and typing.
  const operand = condition.operand;
  if (operand.kind === 'number' && !Number.isFinite(parseNumberText(operand.text))) {
    issues.push(err(where, 'the comparison needs a number'));
  }
  if (operand.kind === 'param') {
    const target = paramByName.get(operand.name);
    if (!operand.name || !target) {
      issues.push(err(where, `compares against "${operand.name || '(no parameter)'}", which is not declared`));
    } else if (ORDERING_KEYS.has(condition.comparator) && valueTypeOf(target.type) !== 'number') {
      issues.push(err(where, `${condition.comparator} needs a numeric operand; "${operand.name}" is ${target.type}`));
    } else if (
      condition.subject.kind !== 'metadata' &&
      !ORDERING_KEYS.has(condition.comparator)
    ) {
      // eq/neq: subject and operand types must agree — except for metadata
      // subjects, whose stored type is unknowable at authoring time.
      const subjectType = subjectValueType(condition.subject, paramByName);
      if (subjectType !== null && valueTypeOf(target.type) !== subjectType) {
        issues.push(
          err(where, `${condition.comparator} compares a ${subjectType} with "${operand.name}", which is ${target.type}`)
        );
      }
    }
  }
  if (
    (operand.kind === 'string' || operand.kind === 'boolean') &&
    condition.subject.kind !== 'metadata'
  ) {
    const subjectType = subjectValueType(condition.subject, paramByName);
    if (ORDERING_KEYS.has(condition.comparator)) {
      issues.push(err(where, `${condition.comparator} can only order numbers`));
    } else if (subjectType !== null && subjectType !== operand.kind) {
      issues.push(err(where, `${condition.comparator} compares a ${subjectType} with a ${operand.kind} — this can never hold`));
    }
  }
  if (
    operand.kind === 'number' &&
    condition.subject.kind === 'param' &&
    !ORDERING_KEYS.has(condition.comparator)
  ) {
    const subjectType = subjectValueType(condition.subject, paramByName);
    if (subjectType !== null && subjectType !== 'number') {
      issues.push(err(where, `${condition.comparator} compares a ${subjectType} with a number — this can never hold`));
    }
  }
}

/**
 * The availability gate's own audit.
 *
 * Every rule here is one the loader would enforce anyway; what the form adds is
 * saying so beside the chip rather than in a rejection badge after the write.
 * Note what is deliberately NOT checked: whether a character anywhere actually
 * carries the key. Metadata keys are undeclared by nature, and a gate written
 * for a sheet the author has not filled in yet is an ordinary state of affairs.
 */
function validateGate(draft: ToolDraft, issues: DraftIssue[]): void {
  if (draft.gateMode === 'none') return;

  const usable = draft.gateConditions.filter((condition) => condition.key.trim() !== '');
  if (usable.length === 0) {
    issues.push(
      err(
        { section: 'gate' },
        'the gate must test something — add a condition, or set the tool back to “anyone may reach for it”'
      )
    );
  }

  const seenSlots = new Set<string>();
  for (const condition of draft.gateConditions) {
    const where: DraftIssue['where'] = { section: 'gate', conditionId: condition.id };

    if (condition.key.trim() === '') {
      issues.push(err(where, 'a gate condition needs a metadata key'));
      continue;
    }

    const slot = gateConditionSlotKey(condition);
    if (seenSlots.has(slot)) {
      issues.push(err(where, 'the gate can test this key with this comparator only once'));
    }
    seenSlots.add(slot);

    const operand = condition.operand;
    if (ORDERING_KEYS.has(condition.comparator) && operand.kind !== 'number') {
      issues.push(err(where, `${condition.comparator} can only order numbers`));
    } else if (CONTAINMENT_KEYS.has(condition.comparator)) {
      if (operand.kind !== 'string') {
        issues.push(err(where, `${condition.comparator} needs text to look for`));
      } else if (operand.text === '') {
        issues.push(err(where, 'the substring to look for must not be empty'));
      }
    } else if (operand.kind === 'number' && !Number.isFinite(parseNumberText(operand.text))) {
      issues.push(err(where, 'the comparison needs a number'));
    }
  }
}

/**
 * The side effects' audit — the same rules `validateEffects` enforces at load
 * time, said beside the row instead of on a rejection badge: the target
 * parses (underscore guard included), an expression parses and names only
 * declared parameters, and anything touching the oracle needs it enabled.
 */
function validateDraftEffects(draft: ToolDraft, issues: DraftIssue[]): void {
  if (draft.effects.length > MAX_EFFECTS) {
    issues.push(err({ section: 'options' }, `at most ${MAX_EFFECTS} effects`));
  }

  const declaredParams = new Set(draft.parameters.map((p) => p.name));

  for (const effect of draft.effects) {
    const where: DraftIssue['where'] = { section: 'effect', id: effect.id };

    if (effect.target.trim() === '') {
      issues.push(err(where, 'an effect needs a target — state.<path> or metadata.<key>'));
    } else {
      const target = parseEffectTarget(effect.target.trim());
      if (!target.ok) issues.push(err(where, `target ${target.reason}`));
    }

    if (effect.valueKind === 'literal-number') {
      if (!Number.isFinite(parseNumberText(effect.value))) {
        issues.push(err(where, 'the value must be a number'));
      }
    } else if (effect.valueKind === 'expression') {
      if (effect.value.trim() === '') {
        issues.push(err(where, "the value needs an expression — quote literal prose: 'broken pick'"));
      } else {
        const parsed = parseExpression(effect.value);
        if (!parsed.ok) {
          issues.push(err(where, `the expression does not parse: ${parsed.reason}`));
        } else {
          for (const ref of parsed.expr.refs) {
            if (ref.startsWith('params.') && !declaredParams.has(ref.slice('params.'.length))) {
              issues.push(err(where, `{{${ref}}} names no declared parameter`));
            } else if (ref === 'llm' && !draft.llmEnabled) {
              issues.push(err(where, '{{llm}} needs the LLM consult enabled'));
            } else if (ref === 'dice' && draft.rollForm !== 'dice') {
              issues.push(warn(where, '{{dice}} is an empty string outside the dice form'));
            }
          }
        }
      }
    }

    if (effect.when.kind === 'verbatim' && effect.when.when.llm !== undefined && !draft.llmEnabled) {
      issues.push(err(where, 'the condition tests the LLM consult, but the consult is not enabled'));
    }
  }
}

/**
 * The value type a subject carries, or null where it is unknowable at
 * authoring time — a metadata key's stored value, or whatever the consulted
 * model chooses to answer.
 */
export function subjectValueType(
  subject: ConditionSubject,
  paramByName: Map<string, DraftParameter>
): ValueType | null {
  switch (subject.kind) {
    case 'value':
    case 'roll':
      return 'number';
    case 'param': {
      const target = paramByName.get(subject.name);
      return target ? valueTypeOf(target.type) : null;
    }
    case 'metadata':
      return null;
    case 'llm':
      // The answer's type is the model's business — unknowable here, like a
      // metadata key's.
      return null;
    case 'llm-ok':
      return 'boolean';
  }
}

/**
 * Re-seat an operand in the widget a newly chosen comparator can actually use:
 * ordering takes a number (or a numeric-param reference) everywhere, and
 * containment looks for text (or a string-param reference) everywhere. Typed
 * text survives the move between number and text; a boolean starts blank.
 * References are left alone — their type is the parameter's business.
 */
export function reseatOperandForComparator<O extends ConditionOperand>(
  operand: O,
  comparator: ComparatorKey
): O | Extract<LiteralOperand, { kind: 'number' | 'string' }> {
  if (ORDERING_KEYS.has(comparator) && (operand.kind === 'string' || operand.kind === 'boolean')) {
    return { kind: 'number', text: operand.kind === 'string' ? operand.text : '' };
  }
  if (CONTAINMENT_KEYS.has(comparator) && (operand.kind === 'number' || operand.kind === 'boolean')) {
    return { kind: 'string', text: operand.kind === 'number' ? operand.text : '' };
  }
  return operand;
}

/** Identity of a gate chip for duplicate detection: metadata key + comparator. */
export function gateConditionSlotKey(condition: Pick<DraftGateCondition, 'key' | 'comparator'>): string {
  return `${condition.key}:${condition.comparator}`;
}

/** Identity of a chip for duplicate detection: subject (+key/name) + comparator. */
export function conditionSlotKey(condition: Pick<DraftCondition, 'subject' | 'comparator'>): string {
  const subject = condition.subject;
  switch (subject.kind) {
    case 'value':
      return `value:${condition.comparator}`;
    case 'roll':
      return `roll:${condition.comparator}`;
    case 'param':
      return `param:${subject.name}:${condition.comparator}`;
    case 'metadata':
      return `metadata:${subject.key}:${condition.comparator}`;
    case 'llm':
      return `llm:${condition.comparator}`;
    case 'llm-ok':
      // Comparator-free on purpose: "succeeded = true" and "succeeded ≠ false"
      // are the same test, so a row gets one such chip at most.
      return 'llm-ok';
  }
}

/**
 * Every issue the form can detect. Errors gate save; warnings render as
 * advisories. The serialized draft still passes through
 * `QtapCustomToolSchema.safeParse` before any save, belt-and-braces.
 */
export function validateDraft(draft: ToolDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];

  // Identity.
  if (!IDENTIFIER_PATTERN.test(draft.name)) {
    issues.push(err({ section: 'identity', field: 'name' }, 'name must be lowercase, start with a letter, and be 1–64 characters'));
  }
  if (draft.title.length > MAX_TITLE_LENGTH) {
    issues.push(err({ section: 'identity', field: 'title' }, `title is over ${MAX_TITLE_LENGTH} characters`));
  }
  if (draft.chipLabel.length > MAX_CHIP_LABEL_LENGTH) {
    issues.push(
      err({ section: 'identity', field: 'chipLabel' }, `chip label is over ${MAX_CHIP_LABEL_LENGTH} characters`)
    );
  }
  validateChipLabelPlaceholders(draft, issues);
  if (draft.description.trim() === '') {
    issues.push(err({ section: 'identity', field: 'description' }, 'description is required'));
  } else if (draft.description.length > MAX_DESCRIPTION_LENGTH) {
    issues.push(err({ section: 'identity', field: 'description' }, `description is over ${MAX_DESCRIPTION_LENGTH} characters`));
  }

  // Availability gate.
  validateGate(draft, issues);

  // Parameters.
  if (draft.parameters.length > MAX_PARAMETERS) {
    issues.push(err({ section: 'options' }, `at most ${MAX_PARAMETERS} parameters`));
  }
  const seenNames = new Set<string>();
  for (const param of draft.parameters) {
    if (!IDENTIFIER_PATTERN.test(param.name)) {
      issues.push(err({ section: 'parameter', id: param.id, field: 'name' }, 'parameter names are lowercase identifiers'));
    } else if (seenNames.has(param.name)) {
      issues.push(err({ section: 'parameter', id: param.id, field: 'name' }, `"${param.name}" is declared twice`));
    }
    seenNames.add(param.name);

    const numeric = param.type === 'number' || param.type === 'integer';
    if (numeric) {
      const defaultNumber = parseNumberText(String(param.defaultValue));
      if (!Number.isFinite(defaultNumber)) {
        issues.push(err({ section: 'parameter', id: param.id, field: 'default' }, 'default must be a number'));
      } else if (param.type === 'integer' && !Number.isInteger(defaultNumber)) {
        issues.push(err({ section: 'parameter', id: param.id, field: 'default' }, 'default must be a whole number'));
      }
      const min = param.min.trim() === '' ? undefined : parseNumberText(param.min);
      const max = param.max.trim() === '' ? undefined : parseNumberText(param.max);
      if (min !== undefined && !Number.isFinite(min)) {
        issues.push(err({ section: 'parameter', id: param.id, field: 'min' }, 'min must be a number'));
      }
      if (max !== undefined && !Number.isFinite(max)) {
        issues.push(err({ section: 'parameter', id: param.id, field: 'max' }, 'max must be a number'));
      }
      if (min !== undefined && max !== undefined && Number.isFinite(min) && Number.isFinite(max) && min > max) {
        issues.push(err({ section: 'parameter', id: param.id, field: 'min' }, 'min must not exceed max'));
      }
    }
  }

  // Roll.
  if (draft.rollForm === 'dice') {
    if (draft.rollDice.trim() === '' || parseDiceNotation(draft.rollDice.trim()) === null) {
      issues.push(err({ section: 'roll', field: 'dice' }, 'must be dice notation like "3d6+2" or "1d20"'));
    }
  } else {
    validateNumberOrParam(draft.rollRange.min, 'min', draft, issues);
    validateNumberOrParam(draft.rollRange.max, 'max', draft, issues);
    validateNumberOrParam(draft.rollRange.multiplier, 'multiplier', draft, issues);
    validateNumberOrParam(draft.rollRange.offset, 'offset', draft, issues);

    // min > max is only KNOWABLE when both are literal (§8) — with a $param on
    // either side it becomes a run-time concern the bench surfaces honestly.
    const min = draft.rollRange.min.kind === 'literal' ? parseNumberText(draft.rollRange.min.text) : NaN;
    const max = draft.rollRange.max.kind === 'literal' ? parseNumberText(draft.rollRange.max.text) : NaN;
    const effectiveMin = draft.rollRange.min.kind === 'literal' && draft.rollRange.min.text.trim() === '' ? 0 : min;
    const effectiveMax = draft.rollRange.max.kind === 'literal' && draft.rollRange.max.text.trim() === '' ? 1 : max;
    if (
      draft.rollRange.min.kind === 'literal' &&
      draft.rollRange.max.kind === 'literal' &&
      Number.isFinite(effectiveMin) &&
      Number.isFinite(effectiveMax) &&
      effectiveMin > effectiveMax
    ) {
      issues.push(err({ section: 'roll', field: 'min' }, 'the low bound is above the high bound'));
    }
  }

  // LLM consult.
  if (draft.llmEnabled) {
    if (draft.llmPrompt.trim() === '') {
      issues.push(err({ section: 'llm', field: 'prompt' }, 'the consult needs a prompt'));
    } else if (draft.llmPrompt.length > MAX_LLM_PROMPT_LENGTH) {
      issues.push(err({ section: 'llm', field: 'prompt' }, `the prompt is over ${MAX_LLM_PROMPT_LENGTH} characters`));
    }
    if (draft.llmErrorMessage.trim() === '') {
      issues.push(
        err(
          { section: 'llm', field: 'errorMessage' },
          "the consult needs an error message — the tool's own words for when the model cannot answer"
        )
      );
    } else if (draft.llmErrorMessage.length > MAX_MESSAGE_LENGTH) {
      issues.push(
        err({ section: 'llm', field: 'errorMessage' }, `the error message is over ${MAX_MESSAGE_LENGTH} characters`)
      );
    }
    if (draft.llmMaxOutput.trim() !== '') {
      const maxOutput = parseNumberText(draft.llmMaxOutput);
      if (!Number.isInteger(maxOutput) || maxOutput < 1) {
        issues.push(err({ section: 'llm', field: 'maxOutput' }, 'the answer cap must be a whole number of characters, at least 1'));
      } else if (maxOutput > MAX_LLM_OUTPUT_CEILING) {
        issues.push(
          err({ section: 'llm', field: 'maxOutput' }, `the answer cap tops out at ${MAX_LLM_OUTPUT_CEILING.toLocaleString()} characters`)
        );
      }
    }
    validateLlmPromptPlaceholders(draft, issues);
  }

  // Side effects.
  validateDraftEffects(draft, issues);

  // Outcomes.
  if (draft.outcomes.length > MAX_OUTCOMES) {
    issues.push(err({ section: 'options' }, `at most ${MAX_OUTCOMES} outcomes`));
  }
  const tail = draft.outcomes[draft.outcomes.length - 1];
  if (!tail || !tail.catchAll) {
    // Unreachable through the UI — the tail is pinned — but the gate must not
    // depend on the UI behaving.
    issues.push(err({ section: 'options' }, 'the final outcome must be the catch-all'));
  }

  for (const outcome of draft.outcomes) {
    if (!outcome.catchAll && outcome.conditions.length === 0) {
      issues.push(err({ section: 'outcome', id: outcome.id }, 'must test something — add a condition, or delete the row'));
    }
    if (outcome.catchAll && outcome !== tail) {
      issues.push(err({ section: 'outcome', id: outcome.id }, 'only the final outcome may be the catch-all'));
    }

    const seenSlots = new Set<string>();
    for (const condition of outcome.conditions) {
      const slot = conditionSlotKey(condition);
      if (seenSlots.has(slot)) {
        issues.push(
          err(
            { section: 'outcome', id: outcome.id, conditionId: condition.id },
            'a row can test this subject with this comparator only once'
          )
        );
      }
      seenSlots.add(slot);
      validateCondition(condition, outcome, draft, issues);
    }

    if (outcome.message.trim() === '') {
      issues.push(err({ section: 'message', id: outcome.id }, 'every outcome needs a message'));
    } else if (outcome.message.length > MAX_MESSAGE_LENGTH) {
      issues.push(err({ section: 'message', id: outcome.id }, `message is over ${MAX_MESSAGE_LENGTH} characters`));
    }
    validateMessagePlaceholders(outcome, draft, issues);
  }

  return issues;
}

/** True when nothing blocks a save. */
export function draftIsValid(draft: ToolDraft): boolean {
  if (validateDraft(draft).some((issue) => issue.severity === 'error')) return false;
  return QtapCustomToolSchema.safeParse(definitionFromDraft(draft)).success;
}

/**
 * Derive a slug from a typed title: `Force the Lock` → `force_the_lock` (§4.1).
 */
export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/g, '')
    .slice(0, 64);
}

/**
 * Rename a parameter everywhere it is referenced — roll fields, comparator
 * operands, `params` test subjects, and `{{params.x}}` placeholders — in one
 * atomic pass (§4.2: rename rewrites; deletion breaks loudly).
 */
export function renameParameterEverywhere(draft: ToolDraft, from: string, to: string): ToolDraft {
  const renameValue = (value: NumberOrParamValue): NumberOrParamValue =>
    value.kind === 'param' && value.name === from ? { kind: 'param', name: to } : value;

  const renameOperand = (operand: ConditionOperand): ConditionOperand =>
    operand.kind === 'param' && operand.name === from ? { kind: 'param', name: to } : operand;

  const renameSubject = (subject: ConditionSubject): ConditionSubject =>
    subject.kind === 'param' && subject.name === from ? { kind: 'param', name: to } : subject;

  const placeholder = paramPlaceholderPattern(from);

  return {
    ...draft,
    parameters: draft.parameters.map((p) => (p.name === from ? { ...p, name: to } : p)),
    llmPrompt: draft.llmPrompt.replace(placeholder, `{{params.${to}}}`),
    rollRange: {
      ...draft.rollRange,
      min: renameValue(draft.rollRange.min),
      max: renameValue(draft.rollRange.max),
      multiplier: renameValue(draft.rollRange.multiplier),
      offset: renameValue(draft.rollRange.offset),
    },
    outcomes: draft.outcomes.map((outcome) => ({
      ...outcome,
      message: outcome.message.replace(placeholder, `{{params.${to}}}`),
      conditions: outcome.conditions.map((condition) => ({
        ...condition,
        subject: renameSubject(condition.subject),
        operand: renameOperand(condition.operand),
      })),
    })),
  };
}

/** Every place a parameter is referenced, for the deletion confirm (§4.2). */
export function findParameterReferences(draft: ToolDraft, name: string): string[] {
  const sites: string[] = [];

  for (const [field, value] of Object.entries({
    min: draft.rollRange.min,
    max: draft.rollRange.max,
    multiplier: draft.rollRange.multiplier,
    offset: draft.rollRange.offset,
  })) {
    if (value.kind === 'param' && value.name === name) sites.push(`roll ${field}`);
  }

  if (paramPlaceholderPattern(name).test(draft.llmPrompt)) {
    sites.push('the consult prompt renders it');
  }

  draft.outcomes.forEach((outcome, index) => {
    const label = outcome.catchAll ? 'the catch-all' : `outcome ${index + 1}`;
    for (const condition of outcome.conditions) {
      if (condition.subject.kind === 'param' && condition.subject.name === name) {
        sites.push(`${label}: a condition tests it`);
      }
      if (condition.operand.kind === 'param' && condition.operand.name === name) {
        sites.push(`${label}: a condition compares against it`);
      }
    }
    if (paramPlaceholderPattern(name).test(outcome.message)) {
      sites.push(`${label}: the message renders it`);
    }
  });

  return sites;
}

/**
 * A fresh global regex matching every `{{params.<name>}}` occurrence (inner
 * whitespace tolerated, as the renderer trims it). Fresh per call so `test`
 * and `replace` never share `lastIndex`.
 */
function paramPlaceholderPattern(name: string): RegExp {
  return new RegExp(`\\{\\{\\s*params\\.${escapeRegex(name)}\\s*\\}\\}`, 'g');
}
