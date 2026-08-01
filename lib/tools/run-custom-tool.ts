/**
 * Run Custom Tool Definition
 *
 * A single tool through which a model runs any of the user-authored pseudo-tools
 * on Pascal's roster (`Tools/*.tool.json` documents in the chat's document
 * stores). One tool rather than one per definition: the tool list stays stable
 * for prompt caching, the snapshot doesn't churn as users write new files, and
 * the Zod chokepoint stays honest. The roster rides in the description, rebuilt
 * on every tool build.
 *
 * The roll happens server-side and the outcome is persisted as a message the
 * model did not author, so a failure cannot be talked into a success and
 * regenerating a reply does not re-roll.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import type { DiscoveredCustomTool } from '@/lib/pascal/custom-tools';
import {
  isParamRef,
  type LlmComparator,
  type NumericComparator,
  type ParamComparator,
  type QtapCustomTool,
} from '@/lib/pascal/custom-tool.types';

/**
 * Zod schema for the run_custom tool's input. The single source of truth for
 * both runtime validation and the derived OpenAI-format `parameters` JSON Schema.
 */
export const runCustomToolInputSchema = z.object({
  tool: z
    .string()
    .describe(
      'Name of the custom tool to run, exactly as listed in this tool\'s description (e.g. "unlock").'
    ),
  parameters: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe(
      'Arguments for the tool, keyed by parameter name. Omit entirely to accept every default. Only parameters the tool declares are accepted.'
    ),
  private: z
    .boolean()
    .optional()
    .describe(
      'Roll privately: the outcome is whispered to you alone and other characters never see it. Defaults to the tool\'s own setting.'
    ),
});

/**
 * Input parameters for the run_custom tool
 */
export type RunCustomToolInput = z.infer<typeof runCustomToolInputSchema>;

/**
 * Output from the run_custom tool — the compact result handed back to the model.
 */
export interface RunCustomToolOutput {
  success: boolean;
  tool?: string;
  /** Final post-transform value the outcome table tested. */
  value?: number;
  /** Semantic state of the outcome that matched. */
  state?: 'success' | 'partial' | 'failure' | 'info';
  /** The rendered outcome message. */
  message?: string;
  /** Whether the outcome was whispered rather than posted publicly. */
  whispered?: boolean;
  error?: string;
}

/**
 * Fixed preamble; the roster is appended per build.
 *
 * The metadata sentence says only that outcome tables MAY consult the sheet —
 * never which keys exist or what they hold. Those are per-character and often
 * the point of the table (a `revealOdds: false` lock that opens for whoever
 * carries the key); enumerating them here would leak every character's secrets
 * into every participant's tool block on every call.
 */
const RUN_CUSTOM_PREAMBLE = [
  'Run one of this scene\'s custom tools — user-authored actions with a random outcome.',
  'The roll happens server-side and its result is posted as a permanent message by Pascal the Croupier, so you cannot choose the outcome: run the tool and then narrate whatever it returns, including failure.',
  'Do not describe the result before calling, and do not re-run a tool to get a better answer.',
  'An outcome table may also consult your own character\'s metadata, so the same tool can deal differently to different characters.',
  'Some tools additionally pose a question to a separate model mid-run and let its answer steer the outcome; that consult happens server-side too, and you never speak for it.',
  'Some tools record side effects when they run — adjusting the scene\'s persistent state or the rolling character\'s own records, server-side, as part of the roll.',
  '',
  'Available tools:',
].join('\n');

/** Render a roll spec compactly for the roster listing. */
function describeRoll(roll: QtapCustomTool['roll']): string {
  if (roll === undefined) return 'random value from 0 to 1';
  if (typeof roll === 'string') return `dice ${roll}`;

  const part = (label: string, v: unknown, fallback: string): string =>
    v === undefined ? fallback : isParamRef(v) ? `${label} ${v.$param}` : `${label} ${v}`;

  const bits = [
    `random value from ${part('', roll.min, '0').trim()} to ${part('', roll.max, '1').trim()}`,
  ];
  if (roll.multiplier !== undefined) bits.push(`× ${isParamRef(roll.multiplier) ? roll.multiplier.$param : roll.multiplier}`);
  if (roll.offset !== undefined) bits.push(`+ ${isParamRef(roll.offset) ? roll.offset.$param : roll.offset}`);
  if (roll.round) bits.push('rounded');
  return bits.join(' ');
}

/** The comparator keys, paired with the operator a reader expects to see. */
const COMPARATOR_SYMBOLS: Array<[keyof ParamComparator, string]> = [
  ['gt', '>'],
  ['gte', '>='],
  ['lt', '<'],
  ['lte', '<='],
  ['eq', '='],
  ['neq', '!='],
  ['contains', 'contains'],
  ['ncontains', 'does not contain'],
];

/** Render a comparator operand: a literal, or the parameter it points at. */
function describeOperand(operand: unknown): string {
  if (isParamRef(operand)) return operand.$param;
  return typeof operand === 'string' ? JSON.stringify(operand) : String(operand);
}

/** Render one comparator as a readable test of a named subject. */
function describeComparator(
  comparator: NumericComparator | ParamComparator,
  subject: string
): string[] {
  const wide = comparator as ParamComparator;
  return COMPARATOR_SYMBOLS.filter(([key]) => wide[key] !== undefined).map(
    ([key, symbol]) => `${subject} ${symbol} ${describeOperand(wide[key])}`
  );
}

/**
 * Render an outcome test. Every subject is named — the bare comparators are
 * about `value`, so saying so keeps them legible beside a `roll` or a parameter
 * test rather than leaving the model to infer which is which.
 */
function describeWhen(when: QtapCustomTool['outcomes'][number]['when']): string {
  if (when === true) return 'otherwise';

  const parts: string[] = [
    ...describeComparator(when, 'value'),
    ...(when.roll !== undefined ? describeComparator(when.roll, 'roll') : []),
    ...Object.entries(when.params ?? {}).flatMap(([name, comparator]) => describeComparator(comparator, name)),
    // Metadata clauses render like any other comparator — but ONLY here, inside
    // a table the author chose to reveal. `revealOdds: false` returns before
    // this is ever called, which is how an author keeps a metadata branch secret.
    ...Object.entries(when.metadata ?? {}).flatMap(([key, comparator]) =>
      describeComparator(comparator, `your ${key}`)
    ),
    ...(when.llm !== undefined ? describeLlmComparator(when.llm) : []),
  ];

  return parts.join(' and ');
}

/** Render an `llm` test: the ok flag reads as a sentence, the rest as comparators. */
function describeLlmComparator(comparator: LlmComparator): string[] {
  const parts: string[] = [];
  if (comparator.ok !== undefined) {
    parts.push(comparator.ok ? 'the consult succeeded' : 'the consult failed');
  }
  parts.push(...describeComparator(comparator, "the consulted answer"));
  return parts;
}

/**
 * Compose the tool description for a resolved roster.
 *
 * Called on EVERY tool build, so a definition added, edited, or deleted
 * mid-chat is reflected on the very next LLM call — and a brand-new chat gets
 * the full roster on turn one with no initialisation step.
 *
 * A tool with `revealOdds: false` contributes its name, description, and
 * parameters only: the model learns the tool exists and how to call it, but
 * never what the odds are.
 */
export function buildRunCustomDescription(roster: DiscoveredCustomTool[]): string {
  const lines: string[] = [RUN_CUSTOM_PREAMBLE];

  for (const { definition } of roster) {
    lines.push(`\n• ${definition.name} — ${definition.description}`);

    const params = Object.entries(definition.parameters ?? {});
    if (params.length > 0) {
      for (const [name, spec] of params) {
        const bounds =
          spec.min !== undefined || spec.max !== undefined
            ? `, ${[spec.min !== undefined ? `min ${spec.min}` : null, spec.max !== undefined ? `max ${spec.max}` : null]
                .filter(Boolean)
                .join(', ')}`
            : '';
        const detail = spec.description ? ` — ${spec.description}` : '';
        lines.push(`    - ${name} (${spec.type}, default ${JSON.stringify(spec.default)}${bounds})${detail}`);
      }
    }

    if (definition.revealOdds === false) {
      lines.push('    The odds are not disclosed.');
      continue;
    }

    lines.push(`    Roll: ${describeRoll(definition.roll)}`);
    if (definition.llm) {
      // The consult's existence is part of the odds; the prompt itself is not
      // rendered — it is instructions for a different model, and quoting it
      // here would invite this one to answer it.
      lines.push('    Consults a separate model; outcomes may test its answer.');
    }
    if (definition.effects && definition.effects.length > 0) {
      // Targets only — vocabulary, never values or conditions. Under
      // `revealOdds: false` this line is gone with the rest of the odds: the
      // consequences stay as hidden as the thresholds. (The human popup still
      // sees the targets via the vocabulary — the file is the user's own.)
      const targets = [...new Set(definition.effects.map((effect) => effect.target))];
      lines.push(`    Side effects: writes ${targets.join(', ')}`);
    }
    for (const outcome of definition.outcomes) {
      lines.push(`    ${describeWhen(outcome.when)} → ${outcome.state}`);
    }
  }

  return lines.join('\n');
}

/**
 * Tool definition compatible with OpenAI's tool_calls format.
 *
 * The description here is the empty-roster form. Real calls go through
 * `buildToolsForProvider`, which swaps in a description built from that call's
 * freshly resolved roster.
 */
export const runCustomToolDefinition = {
  type: 'function',
  function: {
    name: 'run_custom',
    description: RUN_CUSTOM_PREAMBLE,
    parameters: zodToOpenAISchema(runCustomToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateRunCustomInput(input: unknown): RunCustomToolInput | null {
  const parsed = runCustomToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
