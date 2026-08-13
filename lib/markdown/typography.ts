/**
 * Shared smart-typography configuration for markdown pipelines.
 *
 * Layer 1.6, Part A. The sibling of `lib/markdown/math.ts`, and it exists for
 * exactly the same reason: v4 has **two** remark pipelines — the client
 * (`components/chat/MessageContent.tsx`, via react-markdown, used while a
 * message streams) and the server (`lib/services/markdown-renderer.service.ts`,
 * via unified, used for persisted messages) — and they are duplicated by
 * convention, not shared. If they disagree, a message visibly changes
 * appearance the moment it stops streaming. Everything either side needs beyond
 * the `remark-smartypants` plugin itself lives here so the two cannot drift.
 *
 * ## Why quotes render and dashes do not
 *
 * A `"` might be a quotation mark, an inch mark, a roleplay delimiter, or a
 * straight quote the writer wants left exactly as typed. Curling it is a
 * typesetting opinion, and opinions belong in the rendering layer: the stored
 * message keeps its straight quotes, so the model, the embeddings and every
 * export see precisely what was typed, and one toggle un-does the whole thing
 * across all of history. That also demotes smartypants' well-known apostrophe
 * failures (`'tis`, `'80s`) from data corruption to a cosmetic wrong guess.
 *
 * Dashes are the opposite case and are handled at the keystroke instead, by
 * `lib/smart-typography/engine.ts`. See {@link SMARTYPANTS_OPTIONS} for why
 * `dashes` must stay off here permanently.
 *
 * ## Why a remark plugin, and not a string transform
 *
 * The raw-string pre-parse chain (`normalizeMathDelimiters` →
 * `escapeMarkdownInBrackets` → `linkifyBareQtapUris`) is the wrong place and
 * would mangle things: a typographer running there eats `\text{"x"}`, prime
 * marks, and hyphens inside TeX. As a remark plugin over the parsed mdast,
 * `code`, `inlineCode`, `math` and `inlineMath` are distinct node types and a
 * link target is a `url` property rather than a text node — so code, math and
 * URLs are excluded *structurally*, with no hand-written bail conditions to get
 * right forever.
 *
 * @module lib/markdown/typography
 */

import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types';

/**
 * Options passed to `remark-smartypants` on both client and server. Quotes
 * only.
 *
 * Verified against `retext-smartypants` v6's own `Options` type, which is what
 * `remark-smartypants` v3 re-exports: the four keys below are the real names,
 * and an unrecognised key would be silently ignored — which is the one failure
 * mode this file most wants to avoid, because it would leave `dashes` on.
 *
 * - `quotes` — the entire point of Part A.
 * - `ellipses` — off. Part B owns `...`, at type time, where it becomes a real
 *   character in the writer's text.
 * - `dashes` — **off, permanently. This is not a tuning question.** Technical
 *   prose is full of long-option flags written without code formatting, and a
 *   render-time dash rule turns `run it with --verbose` into
 *   `run it with –verbose` invisibly: the source is right, the display is
 *   wrong, and the writer cannot tell why. Part B's type-time rule has no such
 *   problem, because a writer typing `--verbose` sees the dash appear at once
 *   and hits Backspace.
 * - `backticks` — off. It converts ``` `` ``` into a curly double quote, which
 *   is catastrophic in a markdown application.
 */
export const SMARTYPANTS_OPTIONS = {
  quotes: true,
  ellipses: false,
  dashes: false,
  backticks: false,
} as const;

/** Straight quote characters whose curled forms the typographer would emit. */
const STRAIGHT_QUOTES = ['"', "'"] as const;

/** The curly counterparts `remark-smartypants` produces for each straight quote. */
const CURLY_FORMS: Record<string, readonly string[]> = {
  '"': ['“', '”'],
  "'": ['‘', '’'],
};

/**
 * True if a pattern's regex source carries the generated `(?<rpBody>…)` group —
 * i.e. it was built from a template's declared *wrap delimiter* rather than
 * being one of the legacy built-ins. Mirrors the private discriminator of the
 * same name in `lib/chat/roleplay-rendering.ts`, which
 * `escapeMarkdownInBrackets` uses to pick out the same set of patterns.
 */
function hasRpBodyGroup(pattern: RenderingPattern): boolean {
  return pattern.pattern.includes('(?<rpBody>');
}

/**
 * Whether the typographer must stand down for this render.
 *
 * The roleplay layer runs *after* parsing — on the HTML string on the server,
 * on React children on the client — so a remark plugin runs before it and the
 * roleplay layer sees already-curled text. That ordering is load-bearing, and it
 * means anything downstream that matches on a literal straight quote silently
 * stops matching the moment Part A is switched on. Bug 62 was exactly this
 * failure in the shipped defaults; this guard is what keeps a *user's* template
 * from reproducing it.
 *
 * Two ways a template can be quote-sensitive, both checked:
 *
 * 1. **A declared wrap delimiter.** A user can name `"` or `'` as a delimiter in
 *    the roleplay-template editor, which compiles to an `rpBody` wrap pattern.
 *    Such a template also has `escapeMarkdownInBrackets` running over the *raw*
 *    string while `tokenizeInline` runs over curled text, so its escape pass and
 *    its match pass would disagree.
 * 2. **Straight-only dialogue detection.** A `openingChars`/`closingChars` set
 *    naming a straight quote without its curly counterpart stops matching the
 *    instant paragraphs start arriving curled — the bug-62 shape, arriving via a
 *    custom template instead of via the fallback.
 *
 * The shipped defaults trip neither: the built-in dialogue pattern carries no
 * `rpBody` group, and `DEFAULT_DIALOGUE_DETECTION` lists both the straight and
 * the curly double quote.
 */
export function isQuoteSensitiveRoleplayConfig(
  renderingPatterns: readonly RenderingPattern[],
  dialogueDetection: DialogueDetection | null | undefined
): boolean {
  for (const pattern of renderingPatterns) {
    if (!hasRpBodyGroup(pattern)) continue;
    for (const quote of STRAIGHT_QUOTES) {
      if (pattern.pattern.includes(quote)) return true;
    }
  }

  if (dialogueDetection) {
    const declared = [
      ...(dialogueDetection.openingChars ?? []),
      ...(dialogueDetection.closingChars ?? []),
    ];
    for (const quote of STRAIGHT_QUOTES) {
      if (!declared.includes(quote)) continue;
      // A straight quote is only safe when its curly forms are declared too.
      const curly = CURLY_FORMS[quote];
      if (!curly.some((c) => declared.includes(c))) return true;
    }
  }

  return false;
}

/**
 * The single decision both pipelines make about whether to curl quotes for a
 * given render: the user's setting, minus any template that would be broken by
 * it.
 */
export function shouldCurlQuotes(args: {
  /** `smartTypographySettings.displayQuotes`. */
  displayQuotes: boolean | undefined;
  renderingPatterns: readonly RenderingPattern[];
  dialogueDetection: DialogueDetection | null | undefined;
}): boolean {
  if (!args.displayQuotes) return false;
  return !isQuoteSensitiveRoleplayConfig(args.renderingPatterns, args.dialogueDetection);
}
