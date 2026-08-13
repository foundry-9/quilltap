/**
 * Template Type Definitions
 *
 * Contains schemas for roleplay templates and prompt templates
 * used for system prompts and character interactions.
 *
 * @module schemas/template.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';

// ============================================================================
// TEMPLATE DELIMITERS (for formatting toolbar buttons and delimiter configuration)
// ============================================================================

/**
 * Default token constraint for a `tagPrefix` delimiter: one-or-more characters,
 * none of which is a lowercase letter (`\p{Ll}`). This admits uppercase letters,
 * digits, spaces, and non-cased scripts (CJK, Hebrew, …) while rejecting any
 * lowercase. Compiled with the `u` flag everywhere it is used. Users may edit it.
 */
export const DEFAULT_TAG_TOKEN_PATTERN = '[^\\p{Ll}]+';

/**
 * Allowed keys for a delimiter's optional add-on font. The empty string means
 * "inherit" (no font override). The rest map to `.qt-rp-font-<key>` classes that
 * reference the active theme's font tokens with web-safe fallbacks.
 */
export const RP_FONT_KEYS = ['', 'sans', 'serif', 'mono', 'display', 'script'] as const;
export type RpFontKey = (typeof RP_FONT_KEYS)[number];

/**
 * Optional, layered text decorations applied ON TOP of a delimiter's base `style`
 * class. Each maps to a `.qt-rp-*` utility class composed into the rendering
 * pattern's className at generation time, so the renderers need no special-casing.
 *
 * `reverse` swaps the base class's foreground/background. `underline` and `border`
 * are small enums rather than booleans so the single/double and solid/dashed
 * variants stay mutually exclusive.
 */
export const DelimiterAddOnsSchema = z.object({
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  /** Swap the base style's foreground/background (e.g. black-on-white ⇄ white-on-black). */
  reverse: z.boolean().default(false),
  underline: z.enum(['none', 'single', 'double']).default('none'),
  border: z.enum(['none', 'solid', 'dashed']).default('none'),
  /** One of {@link RP_FONT_KEYS}; '' = inherit (no override). */
  font: z.enum(RP_FONT_KEYS).default(''),
});

export type DelimiterAddOns = z.infer<typeof DelimiterAddOnsSchema>;

/** Fields shared by every delimiter kind. */
const delimiterCommonFields = {
  /** Full name displayed in tooltip (e.g., "Narration", "Internal Monologue") */
  name: z.string().min(1).max(50),
  /** Abbreviated label displayed on toolbar button (e.g., "Nar", "Int", "OOC") */
  buttonName: z.string().min(1).max(10),
  /** CSS class name for styling matched text (e.g., "qt-chat-narration") */
  style: z.string().min(1).max(50),
  /**
   * When true, the renderer strips the delimiter/prefix from the displayed output
   * (e.g. `+narration+` renders as a styled `narration` with no `+`). The stored
   * text keeps the marks; hiding is purely a render-time concern. Optional/absent
   * on legacy and built-in entries — treated as `false`.
   */
  hideDelimiter: z.boolean().optional(),
  /**
   * Layered text decorations applied on top of `style`. Optional/absent on legacy
   * entries. When present, each sub-field is filled from its default on parse.
   */
  addOns: DelimiterAddOnsSchema.optional(),
};

/**
 * Wrap delimiter — `open…close` around an inline span (the original behavior).
 * `delimiters` is a single string (same open/close) or an `[open, close]` tuple.
 */
export const WrapDelimiterSchema = z.object({
  kind: z.literal('wrap'),
  ...delimiterCommonFields,
  delimiters: z.union([
    z.string(),
    z.tuple([z.string(), z.string()]),
  ]),
});

/**
 * Line-prefix delimiter — a marker at the START of a line styles the WHOLE line
 * (e.g. `// OOC comment`). The class is applied at the block level, not inline.
 */
export const LinePrefixDelimiterSchema = z.object({
  kind: z.literal('linePrefix'),
  ...delimiterCommonFields,
  /** Marker that must begin the line, e.g. "// " */
  marker: z.string().min(1),
});

/**
 * Tag-prefix delimiter — a bracketed token at the START of a line, whose inner
 * text must satisfy `tokenPattern`, styles the WHOLE line (e.g. `[CAPTAIN] …`).
 * This is a GENERAL, user-authored capability — NOT a hardcoded "rank" feature.
 */
export const TagPrefixDelimiterSchema = z.object({
  kind: z.literal('tagPrefix'),
  ...delimiterCommonFields,
  /** Opening bracket, user-chosen (e.g. "[") */
  open: z.string().min(1),
  /** Closing bracket, user-chosen (e.g. "]") */
  close: z.string().min(1),
  /**
   * The Unicode regex (no anchors) the inner token must satisfy, compiled with
   * the `u` flag. Empty/omitted = the {@link DEFAULT_TAG_TOKEN_PATTERN}. Rejected
   * at write time if it isn't a compilable Unicode regex (it would otherwise
   * throw in both renderers).
   */
  tokenPattern: z
    .string()
    .optional()
    .refine(
      (p) => {
        if (!p) return true;
        try {
          void new RegExp(p, 'u');
          return true;
        } catch {
          return false;
        }
      },
      { message: 'tokenPattern must be a valid Unicode regular expression' },
    ),
});

/**
 * Configuration for a delimiter entry in a roleplay template — a discriminated
 * union over `kind`. Each entry defines a formatting type (narration, thoughts,
 * OOC, ranks, …) with its toolbar button and CSS style.
 *
 * Legacy rows stored before `kind` existed are read as `wrap` (see the
 * preprocess below), so old templates keep validating against this schema.
 */
const TemplateDelimiterUnionSchema = z.discriminatedUnion('kind', [
  WrapDelimiterSchema,
  LinePrefixDelimiterSchema,
  TagPrefixDelimiterSchema,
]);

export const TemplateDelimiterSchema = z.preprocess((val) => {
  // Backfill `kind: 'wrap'` for legacy entries that predate the discriminant so
  // they don't hard-fail the discriminated union before the migration runs.
  if (val && typeof val === 'object' && !Array.isArray(val) && !('kind' in val)) {
    return { ...(val as Record<string, unknown>), kind: 'wrap' };
  }
  return val;
}, TemplateDelimiterUnionSchema);

export type TemplateDelimiter = z.infer<typeof TemplateDelimiterUnionSchema>;

// Legacy type alias for backward compatibility during migration
export type AnnotationButton = {
  label: string;
  abbrev: string;
  prefix: string;
  suffix: string;
};

// ============================================================================
// RENDERING PATTERNS (for message content styling)
// ============================================================================

/**
 * Pattern for styling roleplay text in message content.
 * Defines how to match and style specific text patterns (narration, OOC, etc.)
 */
export const RenderingPatternSchema = z.object({
  /** Regex pattern as a string (converted to RegExp at runtime) */
  pattern: z.string().min(1),
  /** CSS class to apply to matched text (e.g., qt-chat-narration, qt-chat-ooc) */
  className: z.string().min(1),
  /** Optional regex flags (e.g., 'm' for multiline) */
  flags: z.string().optional(),
  /**
   * How the match is styled. `inline` (the default) wraps the matched span in a
   * `<span>` within its line; `line` styles the WHOLE block the match belongs to
   * (applied at the block element, not as an inline span — e.g. a `// OOC` line or
   * a `[TAG]` line). Absent on legacy patterns, which are treated as `inline`.
   */
  scope: z.enum(['inline', 'line']).optional(),
  /**
   * When true, the renderer hides the delimiter chars, emitting only the kept
   * content. The pattern wraps that content in capture group 1; the renderer
   * substitutes `match[1]` for `match[0]` (inline) or the matched block's body
   * (line). Absent on patterns whose delimiters stay visible.
   */
  hideDelimiters: z.boolean().optional(),
});

export type RenderingPattern = z.infer<typeof RenderingPatternSchema>;

/**
 * Configuration for detecting dialogue at the paragraph level.
 * When dialogue contains markdown formatting, inline patterns can't match.
 * This detects paragraphs that start/end with quote characters.
 */
export const DialogueDetectionSchema = z.object({
  /** Opening quote characters to detect (e.g., ['"', '\u201c']) */
  openingChars: z.array(z.string()),
  /** Closing quote characters to detect (e.g., ['"', '\u201d']) */
  closingChars: z.array(z.string()),
  /** CSS class to apply to dialogue paragraphs */
  className: z.string().min(1),
});

export type DialogueDetection = z.infer<typeof DialogueDetectionSchema>;

// ============================================================================
// NARRATION DELIMITERS
// ============================================================================

/**
 * Narration delimiters define how narration/action text is marked in roleplay output.
 * Required for all roleplay templates.
 *
 * - A single string means the same character is used for opening and closing (e.g., '*')
 * - A tuple of two strings means different opening and closing delimiters (e.g., ['[', ']'])
 */
export const NarrationDelimitersSchema = z.union([
  z.string().min(1),
  z.tuple([z.string().min(1), z.string().min(1)]),
]);

export type NarrationDelimiters = z.infer<typeof NarrationDelimitersSchema>;

// ============================================================================
// ROLEPLAY TEMPLATES
// ============================================================================

export const RoleplayTemplateSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema.nullable().optional(),  // null for built-in templates
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  systemPrompt: z.string().min(1),           // The template content
  isBuiltIn: z.boolean().default(false),     // Built-in templates are read-only
  tags: z.array(UUIDSchema).default([]),     // Optional categorization
  /** Delimiter entries for the formatting toolbar — each defines a formatting type with its button and style */
  delimiters: z.array(TemplateDelimiterSchema).default([]),
  /** Patterns for styling roleplay text in message content */
  renderingPatterns: z.array(RenderingPatternSchema).default([]),
  /** Optional dialogue detection for paragraph-level styling */
  dialogueDetection: DialogueDetectionSchema.nullable().optional(),
  /** Narration delimiters — required for new templates. Defaults to '*' for backward compatibility */
  narrationDelimiters: NarrationDelimitersSchema.default('*'),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type RoleplayTemplate = z.infer<typeof RoleplayTemplateSchema>;

// ============================================================================
// PROMPT TEMPLATES
// ============================================================================

// User-created prompt templates (stored in database) for reusable system prompts
export const PromptTemplateSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema.nullable().optional(),   // null for built-in sample prompts
  name: z.string().min(1).max(100),
  content: z.string().min(1),                 // The prompt content (markdown)
  description: z.string().max(500).nullable().optional(),
  isBuiltIn: z.boolean().default(false),      // True for sample prompts from prompts/ directory
  category: z.string().nullable().optional(), // e.g., "COMPANION", "ROMANTIC" from filename
  modelHint: z.string().nullable().optional(), // e.g., "CLAUDE", "GPT-4O" from filename
  tags: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;
