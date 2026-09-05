/**
 * Custom Tools — the definition schema for Pascal's table.
 *
 * A custom tool is a single JSON document (`Tools/*.tool.json` at the root of
 * any document store) describing a named action with parameters, a random roll,
 * and an ordered table of outcomes mapping the roll to a message and a semantic
 * state. This module is the single source of truth for that format: the Zod
 * schema here validates every definition at load time, and the published
 * JSON Schema at `public/schemas/qtap-custom-tool.schema.json` mirrors it for
 * editor completion.
 *
 * Design constraint that shapes everything below: outcome tests are
 * AND-composed comparator objects, and indirection is limited to two closed
 * forms — a `{ "$param": "name" }` reference and a
 * `{ "$state": "path", "fallback": <literal> }` reference. The **one** place a
 * string grammar exists is an effect's `value`, evaluated by the closed,
 * eval-free parser in `lib/pascal/expressions.ts`: arithmetic, string
 * concatenation, parentheses, literals, and `{{ref}}` substitution. There are
 * no identifiers, no function calls, and no member access — the only names
 * that grammar admits are the same `{{...}}` reference families
 * `renderTemplate` already substitutes, so there is still nothing callable and
 * nothing reachable beyond the run's own subjects.
 */

import { z } from 'zod';
import { MAX_DIE_SIDES, MIN_DIE_SIDES, parseDiceNotation } from './dice-notation';
import { parsePath } from '@/lib/state/state-paths';
import { MAX_EFFECT_EXPRESSION_LENGTH, parseExpression } from './expressions';

export { MAX_EFFECT_EXPRESSION_LENGTH };

// The `{{placeholder}}` classifier lives in its own dependency-free module so
// `expressions.ts` can use it without importing the schema; it is re-exported
// here because this is where readers of the format look for it.
export {
  PLACEHOLDER_PATTERN,
  classifyPlaceholder,
  scanPlaceholders,
  type PlaceholderRef,
  type ScannedPlaceholder,
} from './placeholders';

/** Well-known folder, at a store's root, holding custom-tool definitions. */
export const TOOLS_FOLDER = 'Tools';

/** Filename suffix that marks a document as a custom-tool definition. */
export const TOOL_FILE_SUFFIX = '.tool.json';

/** Cap on parameters per tool. */
export const MAX_PARAMETERS = 8;

/** Cap on outcomes per tool. */
export const MAX_OUTCOMES = 32;

/** Cap on tools in a single resolved roster. */
export const MAX_ROSTER_SIZE = 64;

/** Cap on an outcome message, in characters. */
export const MAX_MESSAGE_LENGTH = 1000;

/** Cap on a tool description, in characters. */
export const MAX_DESCRIPTION_LENGTH = 500;

/** Cap on a tool's display title, in characters. */
export const MAX_TITLE_LENGTH = 80;

/**
 * Cap on a `chipLabel` TEMPLATE's text, in characters. The rendered result is
 * uncapped here — the UI truncates it via CSS, which is where display concerns
 * belong.
 */
export const MAX_CHIP_LABEL_LENGTH = 160;

/** Cap on effects per tool. */
export const MAX_EFFECTS = 16;

/** Cap on an effect's `target` string, in characters. */
export const MAX_EFFECT_TARGET_LENGTH = 200;

/** Cap on an LLM consult prompt, in characters (measured before templating). */
export const MAX_LLM_PROMPT_LENGTH = 4000;

/**
 * Default cap on the answer an LLM consult may contribute, in characters. The
 * model's reply is trimmed and truncated before it is tested or rendered.
 * A definition that wants a longer (or shorter) leash sets `llm.maxOutput`;
 * this is only what applies when it doesn't say.
 */
export const MAX_LLM_OUTPUT_LENGTH = 8000;

/**
 * Hard ceiling on `llm.maxOutput`. Generous on purpose — a consult may well BE
 * the deliverable (a generated document, a deep outline) — but still bounded:
 * the answer lands in `pascalMeta` on a chat_messages row, and rows must not
 * become arbitrarily large because one oracle would not stop talking.
 */
export const MAX_LLM_OUTPUT_CEILING = 100_000;

/**
 * Identifier rules shared by tool names and parameter names: lowercase, starts
 * with a letter, 1–64 characters.
 */
export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

const IdentifierSchema = z
  .string()
  .regex(IDENTIFIER_PATTERN, 'must be lowercase, start with a letter, and be 1–64 characters');

/**
 * A reference to a declared numeric parameter, usable anywhere a roll takes a
 * number. One of the two forms of indirection in the format (the other is
 * {@link StateRefSchema}).
 */
export const ParamRefSchema = z.strictObject({
  $param: IdentifierSchema.describe('Name of a declared numeric parameter.'),
});

export type ParamRef = z.infer<typeof ParamRefSchema>;

/**
 * A reference into the merged persistent state (chat → project → group →
 * general), usable anywhere a `$param` reference is. Its `fallback` is required
 * and load-bearing: it types the reference at load time (a numeric fallback
 * makes it a number, a string fallback a string, and so on) and guarantees that
 * run-time resolution can never fail — an absent path or a value of the wrong
 * type simply resolves to the fallback. A run is therefore always dealable.
 */
export const StateRefSchema = z.strictObject({
  $state: z
    .string()
    .min(1)
    .describe('Dot/bracket path into merged state, e.g. "player.health" or "inventory[0].name".'),
  fallback: z
    .union([z.number().finite(), z.string(), z.boolean()])
    .describe('Required. Used whenever the path is absent or holds a value of a different type.'),
});

export type StateRef = z.infer<typeof StateRefSchema>;

/** A roll field: a literal number, a `$param`, or a `$state` reference. */
const NumberOrParamRefSchema = z.union([z.number().finite(), ParamRefSchema, StateRefSchema]);

export type NumberOrParamRef = z.infer<typeof NumberOrParamRefSchema>;

/** True when a roll field is a `$param` reference rather than a literal. */
export function isParamRef(value: unknown): value is ParamRef {
  return typeof value === 'object' && value !== null && '$param' in value;
}

/** True when a value is a `$state` reference rather than a literal or `$param`. */
export function isStateRef(value: unknown): value is StateRef {
  return typeof value === 'object' && value !== null && '$state' in value;
}

/** The four parameter types a definition may declare. */
export const ParameterTypeSchema = z.enum(['number', 'integer', 'string', 'boolean']);

export type ParameterType = z.infer<typeof ParameterTypeSchema>;

/**
 * A declared parameter. Every parameter requires a `default` so that a
 * zero-argument run is always possible — the model may reach for a tool without
 * supplying anything, and the table must still deal.
 */
export const CustomToolParameterSchema = z
  .object({
    type: ParameterTypeSchema.describe('Value type of this parameter.'),
    default: z
      .union([z.number(), z.string(), z.boolean(), StateRefSchema])
      .describe('Required. Used whenever a run omits this parameter. May be a $state reference whose fallback matches this type.'),
    description: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH)
      .optional()
      .describe('What this parameter means, in the fiction.'),
    min: z.number().finite().optional().describe('Numeric types only. Run-time values are clamped up to this.'),
    max: z.number().finite().optional().describe('Numeric types only. Run-time values are clamped down to this.'),
  })
  .superRefine((param, ctx) => {
    const numeric = param.type === 'number' || param.type === 'integer';

    // `min`/`max` are meaningless on a string or boolean; silently ignoring them
    // would let an author believe a bound is in force when it is not.
    if (!numeric && (param.min !== undefined || param.max !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: `min/max are only valid on number/integer parameters, not ${param.type}`,
      });
    }

    if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
      ctx.addIssue({ code: 'custom', message: 'min must not exceed max', path: ['min'] });
    }

    // The declared default must satisfy the parameter's own declared type. A
    // `$state` default is typed by its fallback (which run-time resolution is
    // guaranteed to fall back to), so the fallback is what must match the type.
    const defaultValue = isStateRef(param.default) ? param.default.fallback : param.default;
    const defaultType = typeof defaultValue;
    if (numeric && defaultType !== 'number') {
      ctx.addIssue({ code: 'custom', message: `default must be a number for type ${param.type}`, path: ['default'] });
    }
    if (param.type === 'integer' && defaultType === 'number' && !Number.isInteger(defaultValue)) {
      ctx.addIssue({ code: 'custom', message: 'default must be a whole number for type integer', path: ['default'] });
    }
    if (param.type === 'string' && defaultType !== 'string') {
      ctx.addIssue({ code: 'custom', message: 'default must be a string for type string', path: ['default'] });
    }
    if (param.type === 'boolean' && defaultType !== 'boolean') {
      ctx.addIssue({ code: 'custom', message: 'default must be a boolean for type boolean', path: ['default'] });
    }
  });

export type CustomToolParameter = z.infer<typeof CustomToolParameterSchema>;

/**
 * Form A — a uniform roll over a numeric range, with an optional transform.
 *
 * The transform runs in a fixed order: multiply, then offset, then round.
 */
export const RollRangeSchema = z.strictObject({
  min: NumberOrParamRefSchema.optional().describe('Low bound, inclusive. Default 0.'),
  max: NumberOrParamRefSchema.optional().describe('High bound, exclusive. Default 1.'),
  multiplier: NumberOrParamRefSchema.optional().describe('Raw value is multiplied by this. Default 1.'),
  offset: NumberOrParamRefSchema.optional().describe('Added after multiplication. Default 0.'),
  round: z.boolean().optional().describe('Round the final value to a whole number. Default false.'),
});

export type RollRange = z.infer<typeof RollRangeSchema>;

/**
 * Form B — dice notation, rolled by the shared dice module. Validated here so a
 * typo is a load-time rejection rather than a run-time surprise.
 *
 * `$param` references inside the notation string are a v2 idea; v1 dice are
 * literal.
 */
export const RollDiceSchema = z
  .string()
  .refine((notation) => parseDiceNotation(notation) !== null, {
    message: `must be dice notation like "3d6+2" or "1d20" (${MIN_DIE_SIDES}–${MAX_DIE_SIDES} sides, 1–100 dice)`,
  });

/** Either form of roll. */
export const RollSchema = z.union([RollDiceSchema, RollRangeSchema]);

export type Roll = z.infer<typeof RollSchema>;

/** The comparator keys, in the order tests are described to a reader. */
export const COMPARATOR_KEYS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains', 'ncontains'] as const;

/** One comparator key. */
export type ComparatorKey = (typeof COMPARATOR_KEYS)[number];

/** The four keys that order two values, and so demand numbers on both sides. */
export const ORDERING_KEYS: ReadonlySet<ComparatorKey> = new Set<ComparatorKey>(['gt', 'gte', 'lt', 'lte']);

/** The two keys that search one string inside another, and so demand strings. */
export const CONTAINMENT_KEYS: ReadonlySet<ComparatorKey> = new Set<ComparatorKey>(['contains', 'ncontains']);

/**
 * A comparator operand for an ordering test: a literal number, or a `$param`
 * reference. The reference form is what makes an opposed check expressible —
 * `{ "gte": { "$param": "difficulty" } }` tests against a number the caller
 * supplied rather than one the author fixed at authoring time.
 */
const NumberOperandSchema = z.union([z.number().finite(), ParamRefSchema, StateRefSchema]);

/**
 * A comparator operand for eq/neq, which may address a parameter of any
 * declared type — `{ "eq": "brass" }` is a legitimate test of a string — or a
 * `$state` reference typed by its fallback.
 */
const AnyOperandSchema = z.union([z.number().finite(), z.string(), z.boolean(), ParamRefSchema, StateRefSchema]);

/**
 * A comparator operand for contains/ncontains: the substring to look for — a
 * literal string, a `$param` reference to a declared string parameter, or a
 * `$state` reference whose fallback is a string. The literal must be non-empty
 * because every string contains "", which makes an empty needle a typo wearing
 * a comparator's clothes.
 */
const StringOperandSchema = z.union([
  z.string().min(1, 'the substring to look for must not be empty'),
  ParamRefSchema,
  StateRefSchema,
]);

/** Shape shared by every comparator. Ordering keys are numeric on both sides. */
const NUMERIC_COMPARATOR_SHAPE = {
  gt: NumberOperandSchema.optional(),
  gte: NumberOperandSchema.optional(),
  lt: NumberOperandSchema.optional(),
  lte: NumberOperandSchema.optional(),
  eq: NumberOperandSchema.optional(),
  neq: NumberOperandSchema.optional(),
};

/** True when a comparator object actually tests something. */
const hasComparator = (c: Record<string, unknown>): boolean =>
  COMPARATOR_KEYS.some((key) => c[key] !== undefined);

const AT_LEAST_ONE = { message: 'must specify at least one comparator (gt, gte, lt, lte, eq, neq)' };

const AT_LEAST_ONE_WIDE = {
  message: 'must specify at least one comparator (gt, gte, lt, lte, eq, neq, contains, ncontains)',
};

/**
 * A comparator against a number — the rolled value, or the raw draw. Keys AND
 * together: `>= 0.3 && <= 0.6` is `{ gte: 0.3, lte: 0.6 }`. Deliberately
 * carries no contains/ncontains: the subject is always a number, and a number
 * holds no substrings.
 */
export const NumericComparatorSchema = z.strictObject(NUMERIC_COMPARATOR_SHAPE).refine(hasComparator, AT_LEAST_ONE);

export type NumericComparator = z.infer<typeof NumericComparatorSchema>;

/**
 * A comparator against a declared parameter. Identical to the numeric form
 * except that eq/neq widen to strings and booleans, since a parameter need not
 * be a number — and contains/ncontains appear, testing whether a string
 * parameter holds (or lacks) a substring. The substring is a literal or a
 * `$param` reference, so a table can ask whether one input appears inside
 * another.
 */
export const ParamComparatorSchema = z
  .strictObject({
    ...NUMERIC_COMPARATOR_SHAPE,
    eq: AnyOperandSchema.optional(),
    neq: AnyOperandSchema.optional(),
    contains: StringOperandSchema.optional(),
    ncontains: StringOperandSchema.optional(),
  })
  .refine(hasComparator, AT_LEAST_ONE_WIDE);

export type ParamComparator = z.infer<typeof ParamComparatorSchema>;

/**
 * A comparator against one key of the invoking character's metadata sheet.
 * Shape-identical to {@link ParamComparatorSchema} — the same keys, the same
 * widened eq/neq, the same contains/ncontains, the same `$param` operands.
 *
 * It is a separate schema because the two differ entirely in what can be known
 * at load time. A `params` test names something the file itself declares, so a
 * misspelling is a rejection. A `metadata` test names a key on a character the
 * file has never met: nothing here can be checked beyond the comparator's own
 * shape, and the run-time rule (a key that is absent, non-primitive, or of the
 * wrong type simply fails to match) closes the gap. See `matchesWhen`.
 */
export const MetadataComparatorSchema = ParamComparatorSchema;

export type MetadataComparator = z.infer<typeof MetadataComparatorSchema>;

/**
 * A comparator against the LLM consult's result. The comparator keys test the
 * answer string (see below for how types are reconciled at run time); `ok` is
 * an extra, non-comparator key testing whether the consult succeeded at all.
 *
 * Like `metadata`, the subject's run-time type is unknowable at load time — the
 * answer is whatever the model says — so type rules are enforced fail-soft at
 * run time: an ordering comparator against an answer that does not parse as a
 * number simply declines the row. eq/neq compare numerically when both sides
 * are numbers, and otherwise case-insensitively as trimmed strings, because an
 * author who asked for "YES" should not lose to a model that said "yes".
 * contains/ncontains search the answer for a substring under the same
 * case-insensitive reconciliation — the natural test of prose, where equality
 * would demand the whole sentence verbatim.
 */
export const LlmComparatorSchema = z
  .strictObject({
    ...NUMERIC_COMPARATOR_SHAPE,
    eq: AnyOperandSchema.optional(),
    neq: AnyOperandSchema.optional(),
    contains: StringOperandSchema.optional(),
    ncontains: StringOperandSchema.optional(),
    ok: z
      .boolean()
      .optional()
      .describe('true: this row only applies when the consult succeeded. false: only when it failed.'),
  })
  .refine((c) => hasComparator(c) || c.ok !== undefined, {
    message: 'must test something: a comparator on the answer, or `ok`',
  });

export type LlmComparator = z.infer<typeof LlmComparatorSchema>;

/**
 * Metadata keys are the USER's vocabulary, not an identifier we get to shape:
 * `metadata.json` is hand-authored and `hasAnsibleAccess` is a perfectly
 * ordinary key. So unlike `params`, whose keys must match a declared
 * `IdentifierSchema` name, these are any non-empty string.
 */
const MetadataKeySchema = z.string().min(1);

/**
 * A comparator in an availability gate. The same eight keys as everywhere else,
 * but every operand is a LITERAL.
 *
 * A gate is evaluated before a run exists: there are no resolved parameters to
 * point a `$param` at, and no run whose state cascade a `$state` reference could
 * be resolved against. Rejecting those forms at load time is the honest move —
 * silently tolerating one would leave an author with a gate that reads as though
 * it consults the caller's input when nothing of the sort can have happened yet.
 */
export const GateComparatorSchema = z
  .strictObject({
    gt: z.number().finite().optional(),
    gte: z.number().finite().optional(),
    lt: z.number().finite().optional(),
    lte: z.number().finite().optional(),
    eq: z.union([z.number().finite(), z.string(), z.boolean()]).optional(),
    neq: z.union([z.number().finite(), z.string(), z.boolean()]).optional(),
    contains: z.string().min(1, 'the substring to look for must not be empty').optional(),
    ncontains: z.string().min(1, 'the substring to look for must not be empty').optional(),
  })
  .refine(hasComparator, AT_LEAST_ONE_WIDE);

export type GateComparator = z.infer<typeof GateComparatorSchema>;

/**
 * An availability gate: whether this invoker is offered the tool at all.
 *
 * Keyed by metadata key, AND-composed, and fail-soft in exactly the way an
 * outcome's `metadata` test is — a key the character lacks does not match. The
 * subject is `metadata` and only `metadata` because a gate is answered BEFORE
 * the deal: there is no roll to test, no parameters (nobody has called
 * anything), and no consult. `metadata` is what a character carries into the
 * room, so it is the one thing that can be asked about before they sit down.
 *
 * The subject lives under its own key rather than at the top of the object so a
 * later build can add a second one without re-shaping every file already
 * written.
 */
export const ToolGateSchema = z.strictObject({
  metadata: z
    .record(MetadataKeySchema, GateComparatorSchema)
    .refine((tests) => Object.keys(tests).length > 0, { message: 'must test at least one metadata key' })
    .describe("Test the invoking character's metadata.json, keyed by metadata key. All tests must hold."),
});

export type ToolGate = z.infer<typeof ToolGateSchema>;

/**
 * The subjects an outcome row and an effect condition share — bare comparators
 * on the value, plus `roll`, `params`, `metadata`, and `llm`. One shape, spread
 * into both schemas, so the two can never disagree about a subject's type or
 * its description.
 */
const WHEN_SUBJECTS_SHAPE = {
  ...NUMERIC_COMPARATOR_SHAPE,
  roll: NumericComparatorSchema.optional().describe('Test the raw pre-transform draw rather than the final value.'),
  params: z
    .record(IdentifierSchema, ParamComparatorSchema)
    .optional()
    .describe('Test the resolved parameters, keyed by parameter name.'),
  metadata: z
    .record(MetadataKeySchema, MetadataComparatorSchema)
    .optional()
    .describe("Test the invoking character's metadata.json, keyed by metadata key. A key the character lacks does not match."),
  llm: LlmComparatorSchema.optional().describe(
    "Test the LLM consult's answer (or, via `ok`, whether it succeeded). Only valid on a tool that declares an `llm` block."
  ),
};

/** True when a `when` object tests at least one of the shared subjects. */
function testsSomething(when: {
  roll?: unknown;
  llm?: unknown;
  params?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): boolean {
  return (
    hasComparator(when as Record<string, unknown>) ||
    when.roll !== undefined ||
    when.llm !== undefined ||
    (when.params !== undefined && Object.keys(when.params).length > 0) ||
    (when.metadata !== undefined && Object.keys(when.metadata).length > 0)
  );
}

/**
 * An outcome test. Either the literal `true` (catch-all) or an object naming
 * one or more subjects, ALL of which must hold.
 *
 * Bare comparator keys test the final value, so the common case stays as short
 * as it ever was and every definition written before this key existed still
 * means what it meant. `roll` tests the raw pre-transform draw; `params` tests
 * what the caller supplied, keyed by parameter name; `metadata` tests the
 * invoking character's own fact sheet (`metadata.json`), keyed by whatever the
 * user called it:
 *
 * ```json
 * { "gt": 1, "roll": { "gte": 15 }, "params": { "scale": { "gt": 12 } },
 *   "metadata": { "hasAnsibleAccess": { "eq": true } } }
 * ```
 *
 * A `metadata` key that this character simply doesn't have is not an error —
 * the comparator is false and the table falls through to its catch-all. That is
 * the whole point: a lockpicking table branches on the key its author invented,
 * and must still deal sensibly to the character who's never heard of it.
 *
 * There is still no OR and no nesting: ordered, first-match-wins outcomes make
 * OR unnecessary, and a flat AND of comparators keeps the evaluator eval-free.
 */
export const WhenObjectSchema = z
  .strictObject(WHEN_SUBJECTS_SHAPE)
  .refine(testsSomething, {
    message: 'must test something: a comparator on the value, `roll`, `llm`, a non-empty `params`, or a non-empty `metadata`',
  });

export type WhenObject = z.infer<typeof WhenObjectSchema>;

export const WhenSchema = z.union([z.literal(true), WhenObjectSchema]);

export type When = z.infer<typeof WhenSchema>;

/** The semantic states an outcome may carry. Maps to qt classes at render. */
export const OutcomeStateSchema = z.enum(['success', 'partial', 'failure', 'info']);

export type OutcomeState = z.infer<typeof OutcomeStateSchema>;

export const CustomToolOutcomeSchema = z.strictObject({
  when: WhenSchema.describe(
    '`true` for a catch-all, or comparators on the value, `roll`, `params`, and `metadata` that AND together.'
  ),
  message: z
    .string()
    .min(1)
    .max(MAX_MESSAGE_LENGTH)
    .describe('Narrative result. Supports {{value}}, {{roll}}, {{dice}}, {{params.name}}, and {{metadata.key}}.'),
  state: OutcomeStateSchema.describe('Semantic state, used to accent the result bubble.'),
});

export type CustomToolOutcome = z.infer<typeof CustomToolOutcomeSchema>;

/**
 * An effect's condition. The outcome-row `when` comparator language plus ONE
 * new subject — `outcome`, the winning row's semantic state — because an effect
 * is evaluated after the table has dealt, when there finally IS a winning
 * outcome to test.
 *
 * A separate schema rather than a widened {@link WhenObjectSchema} on purpose:
 * an `outcome` subject inside an outcome row would be a self-referential dead
 * branch (the row cannot test a verdict it has not yet won), and keeping the
 * shapes separate leaves `matchesWhen` untouched.
 */
export const EffectWhenSchema = z
  .strictObject({
    ...WHEN_SUBJECTS_SHAPE,
    outcome: z
      .strictObject({
        eq: OutcomeStateSchema.optional().describe('The winning outcome carries this state.'),
        neq: OutcomeStateSchema.optional().describe('The winning outcome does not carry this state.'),
      })
      .refine((test) => test.eq !== undefined || test.neq !== undefined, {
        message: 'must test something: `eq` or `neq` against an outcome state',
      })
      .optional()
      .describe("Test the WINNING outcome's semantic state — e.g. { \"eq\": \"success\" }."),
  })
  .refine((when) => testsSomething(when) || when.outcome !== undefined, {
    message:
      'must test something: a comparator on the value, `roll`, `llm`, `outcome`, a non-empty `params`, or a non-empty `metadata`',
  });

export type EffectWhen = z.infer<typeof EffectWhenSchema>;

/**
 * One side effect: a write the run records after the table has dealt.
 *
 * `value` discrimination is the one ergonomic trap in the format: a JSON number
 * or boolean is a literal, stored as-is, but a JSON **string is always an
 * expression** — so literal prose must be quoted INSIDE the expression
 * (`"value": "'broken pick'"`, not `"value": "broken pick"`; the bare form is a
 * load-time parse error, and a loud one).
 */
export const CustomToolEffectSchema = z.strictObject({
  when: EffectWhenSchema.optional().describe('Condition for this effect. Omitted = fires on every run.'),
  target: z
    .string()
    .min(1)
    .max(MAX_EFFECT_TARGET_LENGTH)
    .describe(
      'Where to write: "state.<path>" (tiered persistent state, written at the tier where the key already lives) ' +
        'or "metadata.<key>" (the rolling character\'s fact sheet).'
    ),
  value: z
    .union([
      z.number().finite(),
      z.boolean(),
      z.string().min(1).max(MAX_EFFECT_EXPRESSION_LENGTH),
    ])
    .describe(
      'What to write. A JSON number or boolean is a literal. A JSON string is ALWAYS an expression — quote literal ' +
        "prose inside it (\"'broken pick'\"). Expressions take arithmetic, +-concatenation, parentheses, and {{ref}} " +
        'substitution ({{value}}, {{roll}}, {{dice}}, {{llm}}, {{params.x}}, {{metadata.key}}, {{state.path}}).'
    ),
});

export type CustomToolEffect = z.infer<typeof CustomToolEffectSchema>;

/** A parsed effect target, with the raw text kept for records and messages. */
export type EffectTarget =
  | { kind: 'state'; path: Array<string | number>; raw: string }
  | { kind: 'metadata'; key: string; raw: string };

/**
 * Parse an effect's `target`. The single parser for the syntax — validation,
 * the applier, and the Workbench all come through here, so "what counts as a
 * writable target" is decided exactly once.
 *
 * - `state.<path>` — the remainder is a state path (`parsePath` dot/bracket
 *   syntax). An empty path is rejected, and so is a first segment starting with
 *   `_`: those keys are the user's own (the `state` tool's underscore guard),
 *   and no AI-adjacent path may write them.
 * - `metadata.<key>` — the remainder is taken WHOLE as the key. Metadata keys
 *   are the user's vocabulary, so dots inside the key are fine precisely
 *   because it is not path-parsed.
 */
export function parseEffectTarget(
  target: string
): { ok: true; target: EffectTarget } | { ok: false; reason: string } {
  if (target.startsWith('state.')) {
    const rest = target.slice('state.'.length);
    const path = parsePath(rest);
    if (path.length === 0) {
      return { ok: false, reason: 'names no state path after "state."' };
    }
    const first = path[0];
    if (typeof first === 'string' && first.startsWith('_')) {
      return {
        ok: false,
        reason: `writes "${rest}" — state keys starting with an underscore are user-only, and no tool may write them`,
      };
    }
    return { ok: true, target: { kind: 'state', path, raw: target } };
  }

  if (target.startsWith('metadata.')) {
    const key = target.slice('metadata.'.length);
    if (key.length === 0) {
      return { ok: false, reason: 'names no metadata key after "metadata."' };
    }
    return { ok: true, target: { kind: 'metadata', key, raw: target } };
  }

  return { ok: false, reason: 'must start with "state." or "metadata."' };
}

/** Default visibility for a tool's result. */
export const VisibilitySchema = z.enum(['public', 'whisper']);

export type Visibility = z.infer<typeof VisibilitySchema>;

/**
 * The LLM consult block. When present, every run renders `prompt` (the same
 * placeholder families an outcome message takes, minus `{{llm}}` itself) and
 * poses it to the instance's cheap utility model AFTER the roll and BEFORE the
 * outcome table is evaluated. The result is a pair `{ ok, output }`:
 *
 * - success → `ok: true`, `output` is the model's trimmed answer;
 * - failure (provider error, timeout, empty answer, no model configured) →
 *   `ok: false`, `output` is this block's `errorMessage` — the AUTHOR's words,
 *   never the provider's stack trace, because whatever lands in the fiction is
 *   the author's to write.
 *
 * Either way the pair is testable in `when` (the `llm` subject) and renderable
 * in messages (`{{llm}}`), so a failed consult is an outcome the table can deal
 * with rather than an error bubble: the run itself never fails because the
 * oracle went quiet.
 */
export const CustomToolLlmSchema = z.strictObject({
  prompt: z
    .string()
    .min(1)
    .max(MAX_LLM_PROMPT_LENGTH)
    .describe(
      'What to ask. Supports {{value}}, {{roll}}, {{dice}}, {{params.name}}, {{metadata.key}}, and {{state.path}} — but not {{llm}}. ' +
        'Ask for the answer shape you intend to test: a bare word, a number, a sentence.'
    ),
  errorMessage: z
    .string()
    .min(1)
    .max(MAX_MESSAGE_LENGTH)
    .describe(
      "The consult's output when the call fails, in the author's own words. Never the technical reason — " +
        'that goes to the roll record and the logs.'
    ),
  maxOutput: z
    .number()
    .int()
    .min(1)
    .max(MAX_LLM_OUTPUT_CEILING)
    .optional()
    .describe(
      `Cap on the answer, in characters. Default ${MAX_LLM_OUTPUT_LENGTH}. Set it low for a verdict, ` +
        'high for a consult whose answer IS the deliverable. The token budget of the call scales with it. ' +
        'Applies to the model\'s answer only, never to errorMessage.'
    ),
});

export type CustomToolLlm = z.infer<typeof CustomToolLlmSchema>;

/**
 * The custom-tool definition.
 *
 * Unknown TOP-LEVEL keys are tolerated, which reserves room for future keys
 * (as it once did for `effects`, which shipped under that tolerance) without
 * breaking older builds. `collectUnknownKeys` surfaces them for a debug log.
 *
 * That tolerance stops at the top level: every nested object below is strict.
 * The forward-compatibility argument does not reach them, and inside a `when`
 * an unrecognised key is overwhelmingly a misspelled comparator — which, if
 * tolerated, silently drops the test and leaves a row of the outcome table
 * looking like a dead branch. It is also what the published JSON Schema has
 * always claimed (`additionalProperties: false`), so an author's editor and
 * the loader now agree.
 */
export const QtapCustomToolSchema = z
  .object({
    $schema: z.string().optional().describe('Editor hint; ignored at runtime.'),
    name: IdentifierSchema.describe("The tool's identity. Not the filename."),
    title: z
      .string()
      .min(1)
      .max(MAX_TITLE_LENGTH)
      .optional()
      .describe('Human-readable name for display. Defaults to a title-cased `name`.'),
    chipLabel: z
      .string()
      .min(1)
      .max(MAX_CHIP_LABEL_LENGTH)
      .optional()
      .describe(
        'Templated label for the outcome chip and the announcement header. Same placeholders as an outcome message. ' +
          'Rendered after the outcome is chosen. Blank/absent = the title labels the chip.'
      ),
    description: z
      .string()
      .min(1)
      .max(MAX_DESCRIPTION_LENGTH)
      .describe('What the tool does IN THE FICTION — how the model decides to reach for it.'),
    disabled: z.boolean().optional().describe('true suppresses this name at this tier and below.'),
    availableWhen: ToolGateSchema.optional().describe(
      'Offer this tool ONLY to an invoker whose metadata satisfies every test here. At most one of availableWhen/withheldWhen.'
    ),
    withheldWhen: ToolGateSchema.optional().describe(
      'Withhold this tool from an invoker whose metadata satisfies every test here. At most one of availableWhen/withheldWhen.'
    ),
    revealOdds: z
      .boolean()
      .optional()
      .describe('false hides the roll spec and outcome table from the model. Default true.'),
    defaultVisibility: VisibilitySchema.optional().describe('Default result visibility. Default "public".'),
    parameters: z
      .record(IdentifierSchema, CustomToolParameterSchema)
      .refine((params) => Object.keys(params).length <= MAX_PARAMETERS, {
        message: `at most ${MAX_PARAMETERS} parameters`,
      })
      .optional(),
    roll: RollSchema.optional().describe('Numeric range object, or dice notation. Default: 0–1 uniform.'),
    llm: CustomToolLlmSchema.optional().describe(
      'Ask an LLM for a generated result after the roll; outcomes may then test it and messages may render it.'
    ),
    effects: z
      .array(CustomToolEffectSchema)
      .max(MAX_EFFECTS, `at most ${MAX_EFFECTS} effects`)
      .optional()
      .describe(
        'Side effects applied after the run: writes into tiered persistent state or the rolling character\'s metadata.'
      ),
    outcomes: z
      .array(CustomToolOutcomeSchema)
      .min(1, 'at least one outcome is required')
      .max(MAX_OUTCOMES, `at most ${MAX_OUTCOMES} outcomes`)
      .describe('Ordered; first match wins. The last entry must be a `true` catch-all.'),
  })
  .superRefine((tool, ctx) => {
    validateOutcomeOrdering(tool.outcomes, ctx);
    validateReferences(tool, ctx);
    validateGates(tool, ctx);
    validateEffects(tool, ctx);
  });

export type QtapCustomTool = z.infer<typeof QtapCustomToolSchema>;

/**
 * The name to show a human — the author's `title`, or one derived from `name`.
 *
 * The single source of the display string: the announcement, the composer
 * popup, and the roster listing all come through here, so `scan_hawking_radiation`
 * reads as "Scan Hawking Radiation" in every one of them without three
 * implementations agreeing by luck. The model never sees this — it calls tools
 * by `name`, and a second string for one tool would only invite it to pass the
 * wrong one.
 */
export function displayTitle(definition: Pick<QtapCustomTool, 'name' | 'title'>): string {
  const authored = definition.title?.trim();
  if (authored) return authored;

  return definition.name
    .split(/[_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Rule: the final outcome must be the literal `true`, and no earlier outcome
 * may be.
 *
 * The trailing catch-all makes a coverage gap structurally impossible — there
 * is always exactly one outcome to land on. An earlier catch-all would make
 * everything below it dead, which is a typo rather than an intent.
 */
function validateOutcomeOrdering(outcomes: CustomToolOutcome[], ctx: z.RefinementCtx): void {
  if (outcomes.length === 0) return;

  outcomes.forEach((outcome, i) => {
    const isCatchAll = outcome.when === true;
    const isLast = i === outcomes.length - 1;

    if (isCatchAll && !isLast) {
      ctx.addIssue({
        code: 'custom',
        message: `outcome ${i} is a catch-all (when: true), so every outcome after it is unreachable`,
        path: ['outcomes', i, 'when'],
      });
    }

    if (isLast && !isCatchAll) {
      ctx.addIssue({
        code: 'custom',
        message: 'the final outcome must be a catch-all (when: true) so every roll lands somewhere',
        path: ['outcomes', i, 'when'],
      });
    }
  });
}

/**
 * Rule: a definition gates one way or the other, never both.
 *
 * The two clauses are not complements — `withheldWhen` and a negated
 * `availableWhen` differ precisely on the character who lacks the key, which is
 * the whole reason both exist — so a file carrying both is asking two questions
 * whose interaction its author almost certainly has not thought through. It is
 * also the shape the Workbench's single "who may reach for it" control cannot
 * represent, and a form that silently drops half a file is worse than a
 * rejection that says which half.
 */
function validateGates(
  tool: { availableWhen?: ToolGate; withheldWhen?: ToolGate },
  ctx: z.RefinementCtx
): void {
  if (tool.availableWhen && tool.withheldWhen) {
    ctx.addIssue({
      code: 'custom',
      message:
        'declares both availableWhen and withheldWhen — a definition gates one way or the other. ' +
        'Fold the second test into the first, remembering that a key the character lacks never matches.',
      path: ['withheldWhen'],
    });
  }
}

/** The value types a subject or an operand can carry, with `integer` folded in. */
export type ValueType = 'number' | 'string' | 'boolean';

/** Fold a declared parameter type down to the type its values actually have. */
export function valueTypeOf(type: ParameterType): ValueType {
  return type === 'integer' ? 'number' : type;
}

/**
 * Rule: every `$param` reference — in a roll field or in a comparator — must
 * name a declared parameter, and the comparison it takes part in must be one
 * that can hold at run time.
 *
 * All of this is authoring error caught at load: a misspelled parameter, an
 * ordering test against a string, `{ "eq": "brass" }` posed to a number. Left
 * to run time these are silent — a test that simply never fires reads as a dead
 * branch in the outcome table rather than the typo it is.
 */
function validateReferences(
  tool: {
    parameters?: Record<string, CustomToolParameter>;
    roll?: Roll;
    llm?: CustomToolLlm;
    outcomes: CustomToolOutcome[];
  },
  ctx: z.RefinementCtx
): void {
  const declared = tool.parameters ?? {};

  validateRollRefs(declared, tool.roll, ctx);

  tool.outcomes.forEach((outcome, i) => {
    if (outcome.when === true) return;
    validateWhenSubjects(declared, outcome.when, Boolean(tool.llm), ctx, ['outcomes', i, 'when']);
  });
}

/**
 * The shared walk over one `when` object's subjects — outcome rows and effect
 * conditions carry the same comparator language, so they are checked by the
 * same code rather than two copies that drift.
 */
function validateWhenSubjects(
  declared: Record<string, CustomToolParameter>,
  when: WhenObject | EffectWhen,
  hasLlmBlock: boolean,
  ctx: z.RefinementCtx,
  path: Array<string | number>
): void {
  // Bare comparator keys, and `roll`, both address a number.
  validateComparator(declared, when, 'number', 'the rolled value', ctx, path);
  if (when.roll !== undefined) {
    validateComparator(declared, when.roll, 'number', 'the raw roll', ctx, [...path, 'roll']);
  }

  for (const [name, comparator] of Object.entries(when.params ?? {})) {
    const target = declared[name];
    if (!target) {
      ctx.addIssue({
        code: 'custom',
        message: `tests undeclared parameter "${name}"`,
        path: [...path, 'params', name],
      });
      continue;
    }
    validateComparator(declared, comparator, valueTypeOf(target.type), `parameter "${name}"`, ctx, [
      ...path,
      'params',
      name,
    ]);
  }

  // An `llm` test on a tool with no `llm` block could never fire — there is
  // no consult whose answer it might match. That is a typo, not an intent,
  // and left alone it reads as a dead branch in the outcome table.
  if (when.llm !== undefined) {
    if (!hasLlmBlock) {
      ctx.addIssue({
        code: 'custom',
        message: 'tests the LLM consult, but the tool declares no `llm` block',
        path: [...path, 'llm'],
      });
    }
    // The answer's run-time type is the model's business (see the schema
    // comment), so — exactly as with `metadata` — only the `$param` operands
    // are checkable here.
    validateMetadataOperands(declared, when.llm, ctx, [...path, 'llm']);
  }

  // `metadata` gets a shallower check, and there is no way around it: the
  // keys live on a character the file has never seen, so neither the key's
  // existence nor its stored type is knowable here. What IS checkable is the
  // operand — a `$param` reference must still resolve to a declared
  // parameter, exactly as anywhere else. The rest (absent key, wrong type,
  // non-primitive value) is caught fail-soft at run time by `matchesWhen`,
  // where the character is finally in the room.
  for (const [key, comparator] of Object.entries(when.metadata ?? {})) {
    validateMetadataOperands(declared, comparator, ctx, [...path, 'metadata', key]);
  }
}

/**
 * Rule: every effect must be applicable. The target parses (including the
 * underscore guard), a string `value` parses as an expression, every
 * `params.x` reference names a declared parameter, and an `{{llm}}` reference
 * or an `llm` `when`-subject requires an `llm` block — the same rule outcome
 * rows follow.
 *
 * Parse failure here is the dice-notation doctrine: syntax errors are typos,
 * caught in the Workbench and at discovery, never at the table.
 */
function validateEffects(
  tool: {
    parameters?: Record<string, CustomToolParameter>;
    llm?: CustomToolLlm;
    effects?: CustomToolEffect[];
  },
  ctx: z.RefinementCtx
): void {
  const declared = tool.parameters ?? {};

  (tool.effects ?? []).forEach((effect, i) => {
    const base = ['effects', i];

    const target = parseEffectTarget(effect.target);
    if (!target.ok) {
      ctx.addIssue({ code: 'custom', message: `target ${target.reason}`, path: [...base, 'target'] });
    }

    // A JSON string value is ALWAYS an expression — the quoting trap. The bare
    // prose an author meant as a literal fails to parse right here, loudly.
    if (typeof effect.value === 'string') {
      const parsed = parseExpression(effect.value);
      if (!parsed.ok) {
        ctx.addIssue({
          code: 'custom',
          message: `value is not a valid expression: ${parsed.reason}`,
          path: [...base, 'value'],
        });
      } else {
        for (const ref of parsed.expr.refs) {
          if (ref.startsWith('params.')) {
            const name = ref.slice('params.'.length);
            if (!declared[name]) {
              ctx.addIssue({
                code: 'custom',
                message: `value references undeclared parameter "${name}"`,
                path: [...base, 'value'],
              });
            }
          } else if (ref === 'llm' && !tool.llm) {
            ctx.addIssue({
              code: 'custom',
              message: 'value references {{llm}}, but the tool declares no `llm` block',
              path: [...base, 'value'],
            });
          }
        }
      }
    }

    if (effect.when !== undefined) {
      validateWhenSubjects(declared, effect.when, Boolean(tool.llm), ctx, [...base, 'when']);
    }
  });
}

/**
 * Check only what a metadata comparator can be checked on at load: that every
 * `$param` operand names a declared parameter. Deliberately silent about the
 * subject's type — see the caller.
 */
function validateMetadataOperands(
  declared: Record<string, CustomToolParameter>,
  comparator: MetadataComparator,
  ctx: z.RefinementCtx,
  path: Array<string | number>
): void {
  for (const key of COMPARATOR_KEYS) {
    const operand = (comparator as Record<string, unknown>)[key];
    if (operand === undefined) continue;
    resolveOperandType(declared, operand, ctx, [...path, key]);
  }
}

/**
 * Roll fields are numeric, so every reference in one must resolve to a number:
 * a `$param` must name a numeric parameter, and a `$state` ref must carry a
 * numeric fallback (the only thing knowable about it at load time).
 */
function validateRollRefs(
  declared: Record<string, CustomToolParameter>,
  roll: Roll | undefined,
  ctx: z.RefinementCtx
): void {
  if (!roll || typeof roll === 'string') return;

  for (const [field, value] of Object.entries(roll)) {
    if (isStateRef(value)) {
      if (typeof value.fallback !== 'number') {
        ctx.addIssue({
          code: 'custom',
          message: `roll.${field} uses a $state reference whose fallback is ${typeof value.fallback} rather than a number`,
          path: ['roll', field],
        });
      }
      continue;
    }

    if (!isParamRef(value)) continue;

    const target = declared[value.$param];
    if (!target) {
      ctx.addIssue({
        code: 'custom',
        message: `roll.${field} references undeclared parameter "${value.$param}"`,
        path: ['roll', field],
      });
      continue;
    }

    if (target.type !== 'number' && target.type !== 'integer') {
      ctx.addIssue({
        code: 'custom',
        message: `roll.${field} references parameter "${value.$param}", which is ${target.type} rather than numeric`,
        path: ['roll', field],
      });
    }
  }
}

/**
 * Check one comparator against the type of what it tests: every operand must
 * resolve, and the comparison must be one the two types can sustain.
 */
function validateComparator(
  declared: Record<string, CustomToolParameter>,
  comparator: NumericComparator | ParamComparator,
  subjectType: ValueType,
  subjectLabel: string,
  ctx: z.RefinementCtx,
  path: Array<string | number>
): void {
  for (const key of COMPARATOR_KEYS) {
    const operand = (comparator as Record<string, unknown>)[key];
    if (operand === undefined) continue;

    const operandType = resolveOperandType(declared, operand, ctx, [...path, key]);
    if (operandType === null) continue;

    if (ORDERING_KEYS.has(key)) {
      if (subjectType !== 'number' || operandType !== 'number') {
        ctx.addIssue({
          code: 'custom',
          message: `${key} orders ${subjectLabel} against a ${operandType}, and only numbers can be ordered`,
          path: [...path, key],
        });
      }
      continue;
    }

    if (CONTAINMENT_KEYS.has(key)) {
      if (subjectType !== 'string') {
        ctx.addIssue({
          code: 'custom',
          message: `${key} searches ${subjectLabel}, which is a ${subjectType} — only a string can contain a substring`,
          path: [...path, key],
        });
      } else if (operandType !== 'string') {
        ctx.addIssue({
          code: 'custom',
          message: `${key} looks for a ${operandType} inside ${subjectLabel}, and a substring must be a string`,
          path: [...path, key],
        });
      }
      continue;
    }

    if (subjectType !== operandType) {
      ctx.addIssue({
        code: 'custom',
        message: `${key} compares ${subjectLabel}, which is a ${subjectType}, with a ${operandType} — this can never hold`,
        path: [...path, key],
      });
    }
  }
}

/**
 * The type an operand carries: a literal's own, or that of the parameter it
 * references. null means the operand is broken and has already been reported.
 */
function resolveOperandType(
  declared: Record<string, CustomToolParameter>,
  operand: unknown,
  ctx: z.RefinementCtx,
  path: Array<string | number>
): ValueType | null {
  if (isParamRef(operand)) {
    const target = declared[operand.$param];
    if (!target) {
      ctx.addIssue({
        code: 'custom',
        message: `references undeclared parameter "${operand.$param}"`,
        path,
      });
      return null;
    }
    return valueTypeOf(target.type);
  }

  // A `$state` operand carries the type of its (required) fallback — that is
  // what run-time resolution is guaranteed to produce when the path misses.
  if (isStateRef(operand)) {
    const fallbackType = typeof operand.fallback;
    if (fallbackType === 'number' || fallbackType === 'string' || fallbackType === 'boolean') {
      return fallbackType;
    }
    // Unreachable: the schema types the fallback before this runs.
    return null;
  }

  const literal = typeof operand;
  if (literal === 'number' || literal === 'string' || literal === 'boolean') return literal;

  // Unreachable: the schema types operands before this runs.
  return null;
}

/**
 * Render a rejection as the sentence an author reads on the load-error badge.
 *
 * Exists because of unions. `when` is `true | object` and `roll` is
 * `string | object`, and when both branches fail Zod reports a bare "Invalid
 * input" at the union and buries the actual complaint — the misspelled
 * comparator, the malformed dice notation — one level down in `issue.errors`.
 * A rejection nobody can read is barely better than no rejection at all, so
 * every branch's message is surfaced, joined by "or" since either would have
 * satisfied the schema.
 */
export function formatDefinitionIssues(error: z.ZodError): string {
  return flattenIssues(error.issues).join('; ');
}

function flattenIssues(issues: readonly z.core.$ZodIssue[], prefix: Array<string | number> = []): string[] {
  return issues.map((issue) => {
    const path = [...prefix, ...issue.path];
    const located = (message: string) => (path.length ? `${path.join('.')}: ${message}` : message);

    if (issue.code === 'invalid_union') {
      // Sub-issue paths are relative to the union, so carry the prefix down.
      const branches = issue.errors
        .map((branch) => flattenIssues(branch).join('; '))
        .filter((branch) => branch.length > 0);
      if (branches.length > 0) return located(branches.join(' — or — '));
    }

    return located(issue.message);
  });
}

/**
 * Top-level keys the v1 format knows about, in the schema's declaration order
 * (`$schema` first). Read off the schema itself so a new key can never be
 * known to the loader and unknown to the Workbench. Anything else is reserved
 * for v2.
 */
export const KNOWN_TOP_LEVEL_KEYS: readonly string[] = Object.keys(QtapCustomToolSchema.shape);

const KNOWN_TOP_LEVEL_KEY_SET: ReadonlySet<string> = new Set(KNOWN_TOP_LEVEL_KEYS);

/**
 * Report top-level keys this build doesn't understand, so discovery can log
 * them. They are tolerated, not rejected: `persist` is a planned v2 key, and an
 * older build must not choke on a newer file.
 */
export function collectUnknownKeys(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null) return [];
  return Object.keys(raw as Record<string, unknown>).filter((k) => !KNOWN_TOP_LEVEL_KEY_SET.has(k));
}
