/**
 * Shared roleplay-rendering core.
 *
 * Single source of truth for turning a template's rendering patterns into styled
 * output. Both the client renderer (`components/chat/MessageContent.tsx`, which
 * emits React nodes) and the server renderer
 * (`lib/services/markdown-renderer.service.ts`, which emits an HTML string)
 * derive their behavior from this module, so they can no longer drift apart —
 * a new delimiter kind is implemented here exactly once.
 *
 * Framework-agnostic: no React, no DOM, no ESM-only deps — pure string work, so
 * it imports cleanly into both a `'use client'` component and a server service.
 *
 * @module lib/chat/roleplay-rendering
 */

import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

// ============================================================================
// SHARED DEFAULTS (single copy; both renderers import these)
// ============================================================================

/**
 * Default rendering patterns used when a template doesn't specify any.
 * Includes common patterns from both Standard and Quilltap-style formatting.
 */
export const DEFAULT_RENDERING_PATTERNS: RenderingPattern[] = [
  // OOC: ((comments)) - double parentheses
  { pattern: '\\(\\([^)]+\\)\\)', className: 'qt-chat-ooc' },
  // OOC: // comment - line prefix style
  { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm' },
  // Dialogue: "speech" - straight AND curly double quotes. The curly ones are
  // written as \u escapes on purpose (as the seeded Standard Roleplay template
  // does): this entry spent its whole life claiming curly support while holding
  // four copies of ASCII 0x22, because a literal U+201C in source is
  // indistinguishable from a straight quote at a glance (bug 62). Single quotes
  // are deliberately excluded - an apostrophe is a single quote far more often
  // than a quotation mark is (don't, writers', '80s).
  { pattern: '["\u201c][^"\u201d]+["\u201d]', className: 'qt-chat-dialogue' },
  // Narration: *actions* - single asterisks (not bold **)
  { pattern: '(?<!\\*)\\*[^*]+\\*(?!\\*)', className: 'qt-chat-narration' },
  // Narration: [actions] - square brackets (not links)
  { pattern: '\\[[^\\]]+\\](?!\\()', className: 'qt-chat-narration' },
  // Internal monologue: {thoughts} - excludes {{template}} variables
  { pattern: '(?<!\\{)\\{[^{}]+\\}(?!\\})', className: 'qt-chat-inner-monologue' },
]

/**
 * Default dialogue detection for paragraph-level styling.
 *
 * Straight and curly DOUBLE quotes only, the curly pair written as \u escapes
 * for the reason given on the dialogue pattern above (bug 62). Keep these in
 * step with that pattern — a paragraph the inline rule styles but this one
 * doesn't (or vice versa) is a visible split.
 */
export const DEFAULT_DIALOGUE_DETECTION: DialogueDetection = {
  openingChars: ['"', '\u201c'],
  closingChars: ['"', '\u201d'],
  className: 'qt-chat-dialogue',
}

// ============================================================================
// COMPILED RULES
// ============================================================================

/** A neutral run of text, optionally tagged with a CSS class. */
export interface Segment {
  text: string
  className?: string
}

/**
 * A compiled rendering rule.
 *
 * - `inline` rules wrap a matched span *within* a line (e.g. `*narration*`).
 * - `line` rules style the WHOLE block they match (e.g. a `// OOC` line or a
 *   `[CAPTAIN]` tag line). Line rules are applied at the block element by each
 *   adapter, never as an inline span — see {@link lineMatchFor}.
 */
export interface CompiledRule {
  regex: RegExp
  className: string
  scope: 'inline' | 'line'
  /**
   * When true, the delimiter/prefix is dropped from the output: inline rules emit
   * the `rpBody` capture group instead of the full match; line rules strip the
   * matched prefix from the block (see {@link lineMatchFor}).
   */
  hideDelimiters: boolean
}

/**
 * Compile stored {@link RenderingPattern}s into rules.
 *
 * Patterns are compiled WITHOUT the global flag: matching walks the string and
 * advances manually (see {@link tokenizeInline}), so a stateful `lastIndex`
 * would be a bug. Any stored `g` flag is stripped. `scope` falls back to
 * `inline` for legacy patterns that predate the field.
 */
export function compileRenderingPatterns(patterns: RenderingPattern[]): CompiledRule[] {
  return patterns.map((p) => ({
    regex: new RegExp(p.pattern, (p.flags || '').replace('g', '')),
    className: p.className,
    scope: p.scope === 'line' ? 'line' : 'inline',
    hideDelimiters: p.hideDelimiters ?? false,
  }))
}

// ============================================================================
// TOKENIZER (the single match-walk shared by both renderers)
// ============================================================================

/**
 * Walk `text` once, finding the earliest match among the INLINE rules, and emit
 * neutral segments. Unmatched runs become plain `{ text }` segments; matched
 * runs become `{ text, className }`. Line-scoped rules are ignored here — the
 * adapters apply those at the block level via {@link lineMatchFor}.
 *
 * Matching the earliest span and advancing past it (rather than running each
 * pattern's `replace` independently) is what prevents a later pattern from
 * matching text already claimed by an earlier one — e.g. dialogue `"…"` matching
 * the quoted `class="…"` attribute of a span an earlier pattern inserted.
 *
 * This is the single implementation of the walk that previously lived twice
 * (`processRoleplayText` in MessageContent and the inner loop of
 * `applyRoleplayPatterns` on the server).
 */
export function tokenizeInline(text: string, rules: CompiledRule[]): Segment[] {
  const inlineRules = rules.filter((r) => r.scope === 'inline')
  const segments: Segment[] = []
  let remaining = text

  while (remaining.length > 0) {
    // `advance` is always the FULL match length (delimiters consumed); `text` is
    // what we display — the inner `rpBody` group when the rule hides delimiters,
    // else the full match.
    let earliest: { index: number; advance: number; className: string; text: string } | null = null

    // Find the earliest match among all inline rules.
    for (const rule of inlineRules) {
      const match = remaining.match(rule.regex)
      if (match && match.index !== undefined) {
        if (!earliest || match.index < earliest.index) {
          const display =
            rule.hideDelimiters && match.groups?.rpBody !== undefined
              ? match.groups.rpBody
              : match[0]
          earliest = {
            index: match.index,
            advance: match[0].length,
            className: rule.className,
            text: display,
          }
        }
      }
    }

    if (earliest) {
      if (earliest.index > 0) {
        segments.push({ text: remaining.substring(0, earliest.index) })
      }
      segments.push({ text: earliest.text, className: earliest.className })
      remaining = remaining.substring(earliest.index + earliest.advance)
    } else {
      segments.push({ text: remaining })
      break
    }
  }

  return segments
}

// ============================================================================
// LINE-SCOPED CLASSES (whole-block styling)
// ============================================================================

/** A whole-block match against a LINE-scoped rule. */
export interface LineMatch {
  /** Class(es) to apply to the block element. */
  className: string
  /** Whether the matched prefix/marker should be stripped from the block. */
  hideDelimiters: boolean
  /** The literal leading delimiter/marker text (e.g. `"// "`, `"[CAPTAIN]"`). */
  prefix: string
  /** The kept body with the prefix removed. */
  body: string
}

/**
 * A whole-block match against an inline WRAP rule that hides its delimiters.
 *
 * Unlike {@link LineMatch}, the class lands on an inline `<span>` wrapping the
 * (delimiter-stripped) block content — the chat classes are `display: inline`,
 * so they must never be applied to the block element itself. Both `prefix`
 * (opening delimiter) and `suffix` (closing delimiter) are stripped from the
 * content so the styled span holds only the body, while any inline markdown the
 * markdown parser produced inside the body is preserved.
 */
export interface WrapBlockMatch {
  /** Class(es) for the inline span that wraps the block body. */
  className: string
  /** The literal opening delimiter to strip (e.g. `"+"`, `"(("`). */
  prefix: string
  /** The literal closing delimiter to strip (e.g. `"+"`, `"))"`). */
  suffix: string
}

/**
 * If the entire block of `text` is a single inline WRAP span whose rule hides its
 * delimiters, return the span class plus the opening/closing delimiters to strip.
 *
 * This is the counterpart to {@link lineMatchFor} for the *wrap* delimiter kind:
 * a paragraph that is wholly `+narration+` (delimiters hidden) gets styled at the
 * block level instead of via the inline tokenizer. The win is that the markdown
 * inside the wrap — `+a *b* c+` → `+a <em>b</em> c+` — has already been parsed
 * into real nodes by the time this runs, so styling the wrapper preserves it,
 * whereas the inline tokenizer (a pure string walk) can't span those nodes and
 * would leave the delimiters literal.
 *
 * Only fires for `hideDelimiters` rules with a non-empty `prefix` AND `suffix`:
 * shown-delimiter wraps keep going through the escape + inline-tokenize path, and
 * a missing side means it's really a line prefix, handled by {@link lineMatchFor}.
 */
export function wrapBlockMatchFor(text: string, rules: CompiledRule[]): WrapBlockMatch | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  for (const rule of rules) {
    if (rule.scope !== 'inline' || !rule.hideDelimiters) continue
    // Strip g/m so the match anchors to the WHOLE block, not a sub-span.
    const flags = rule.regex.flags.replace('g', '').replace('m', '')
    const anchored = new RegExp(rule.regex.source, flags)
    const m = trimmed.match(anchored)
    if (!m || m.index !== 0 || m[0].length !== trimmed.length) continue

    const body = m.groups?.rpBody
    if (typeof body !== 'string' || body.length === 0) continue

    // `body` is the non-delimiter interior, so it can't appear inside the
    // all-delimiter opening run — indexOf reliably locates it.
    const bodyStart = m[0].indexOf(body)
    if (bodyStart <= 0) continue
    const prefix = m[0].slice(0, bodyStart)
    const suffix = m[0].slice(bodyStart + body.length)
    if (!prefix || !suffix) continue

    return { className: rule.className, prefix, suffix }
  }
  return undefined
}

/**
 * If the whole block of `text` is a single line matching a LINE-scoped rule,
 * return the match details. Mirrors how dialogue detection tags a `<p>` from its
 * plain text: the class lands on the block element, not an inline span.
 *
 * The rule's regex is matched against the trimmed block with any multiline flag
 * removed, so it only matches when the ENTIRE block is one matching line. A
 * mixed-content paragraph is left to inline styling / unstyled — authors put a
 * line-prefixed or tag-prefixed line on its own line. Returns `undefined` if
 * nothing matches.
 *
 * `prefix`/`body` are derived from the `rpBody` capture group (which sits at the
 * end of every generated line pattern): the prefix is everything before it.
 * Adapters that hide delimiters strip `prefix` from the block's leading text so
 * inline formatting in the body survives.
 */
export function lineMatchFor(text: string, rules: CompiledRule[]): LineMatch | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  for (const rule of rules) {
    if (rule.scope !== 'line') continue
    // Strip the multiline flag so `^…$` anchor to the whole block, not a sub-line.
    const flags = rule.regex.flags.replace('m', '').replace('g', '')
    const anchored = new RegExp(rule.regex.source, flags)
    const m = trimmed.match(anchored)
    if (m && m.index === 0 && m[0].length === trimmed.length) {
      const body = m.groups?.rpBody ?? trimmed
      const prefix = m[0].length >= body.length ? m[0].slice(0, m[0].length - body.length) : ''
      return { className: rule.className, hideDelimiters: rule.hideDelimiters, prefix, body }
    }
  }
  return undefined
}

// ============================================================================
// DIALOGUE DETECTION (shared predicate)
// ============================================================================

/**
 * Check whether text content represents dialogue based on configured detection:
 * it starts with an opening quote char and ends with a closing quote char.
 */
export function isDialogueParagraph(text: string, detection: DialogueDetection): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2) return false

  const firstChar = trimmed[0]
  const lastChar = trimmed[trimmed.length - 1]

  return detection.openingChars.includes(firstChar) && detection.closingChars.includes(lastChar)
}

// ============================================================================
// HTML EMIT (server adapter helper)
// ============================================================================

/**
 * Serialize segments to an HTML string. Matched segments are wrapped in
 * `<span class="…">`; the text is inserted as-is (the server feeds this
 * already-HTML-stringified text from between tags, so it is already escaped —
 * re-escaping here would double-encode entities).
 */
export function segmentsToHtml(segments: Segment[]): string {
  let out = ''
  for (const seg of segments) {
    out += seg.className ? `<span class="${seg.className}">${seg.text}</span>` : seg.text
  }
  return out
}

// ============================================================================
// MARKDOWN ESCAPING (shared verbatim by both renderers)
// ============================================================================

/** Characters that trigger markdown parsing and must be escaped inside spans. */
const MARKDOWN_CHARS = /([*_~`])/g

/** True if a pattern's regex source carries the generated `(?<rpBody>…)` group. */
function hasRpBodyGroup(pattern: RenderingPattern): boolean {
  return pattern.pattern.includes('(?<rpBody>')
}

/**
 * Escape the markdown characters inside the `rpBody` interior of every match of
 * `pattern` in `part`, leaving the delimiters themselves untouched. Works for ANY
 * wrap delimiter — `+…+`, `((…))`, `~…~` — because it reads the captured body
 * straight from the pattern's own regex rather than hard-coding delimiter shapes.
 */
function escapeRpBodyInterior(part: string, pattern: RenderingPattern): string {
  const baseFlags = (pattern.flags || '').replace('g', '')
  let re: RegExp
  try {
    re = new RegExp(pattern.pattern, `${baseFlags}g`)
  } catch {
    return part // A malformed stored pattern must never break rendering.
  }
  return part.replace(re, (match: string, ...rest: unknown[]) => {
    // With a named group, the last replace argument is the groups object.
    const groups = rest[rest.length - 1] as Record<string, string> | undefined
    const body = groups?.rpBody
    if (typeof body !== 'string' || body.length === 0) return match
    // `body` (non-delimiter interior) can't appear inside the all-delimiter
    // opening run, so indexOf splits delimiter / body / delimiter cleanly.
    const bodyStart = match.indexOf(body)
    if (bodyStart < 0) return match
    const open = match.slice(0, bodyStart)
    const close = match.slice(bodyStart + body.length)
    return `${open}${body.replace(MARKDOWN_CHARS, '\\$1')}${close}`
  })
}

/**
 * Escape markdown syntax characters inside roleplay delimiters to prevent the
 * markdown parser from breaking up a span before it can be styled — e.g.
 * `[narration with *emphasis* inside]` or `((ooc with *stars*))`.
 *
 * Three families are handled:
 *  1. Generated wrap patterns that expose `(?<rpBody>…)` AND show their
 *     delimiters: their interior is escaped generically, for any delimiter pair.
 *  2. Generated wrap patterns that HIDE their delimiters: intentionally left
 *     alone. A whole-block hidden wrap is restyled at the block level (see
 *     {@link wrapBlockMatchFor}) where its inner markdown is meant to render.
 *  3. Legacy built-in patterns that predate `rpBody` (`[…]`, `{…}`, `*…*`):
 *     recognised by their fixed regex shapes, as before.
 *
 * IMPORTANT: preserves fenced code blocks (``` ``` ```) unchanged to avoid
 * corrupting code content with escape sequences.
 */
export function escapeMarkdownInBrackets(content: string, patterns: RenderingPattern[]): string {
  const inlinePatterns = patterns.filter((p) => p.scope !== 'line')

  // (1) Shown-delimiter rpBody wraps → escape generically. (2) Hidden ones are
  // deliberately excluded so their inner markdown survives for block styling.
  const escapableRpBody = inlinePatterns.filter((p) => hasRpBodyGroup(p) && !p.hideDelimiters)

  // (3) Legacy no-rpBody built-ins recognised by fixed shape.
  const legacy = inlinePatterns.filter((p) => !hasRpBodyGroup(p))
  // Check if patterns include bracket-style narration [...]
  const hasBracketNarration = legacy.some((p) => p.pattern.includes('\\['))
  // Check if patterns include brace-style monologue {...}
  const hasBraceMonologue = legacy.some((p) => p.pattern.includes('\\{'))
  // Check if patterns include single-asterisk narration *...*. The className may
  // carry composed add-on classes (e.g. "qt-chat-narration qt-rp-bold"), so test
  // for the base class as a token rather than by exact equality.
  const hasAsteriskNarration = legacy.some(
    (p) => p.pattern.includes('\\*') && p.className.split(/\s+/).includes('qt-chat-narration'),
  )

  // If no relevant patterns, return content unchanged
  if (
    escapableRpBody.length === 0 &&
    !hasBracketNarration &&
    !hasBraceMonologue &&
    !hasAsteriskNarration
  ) {
    return content
  }

  // Split content by fenced code blocks to preserve them unchanged.
  // Match ``` optionally followed by language, then content, then closing ```
  const codeBlockRegex = /(```[\s\S]*?```)/g
  const parts = content.split(codeBlockRegex)

  // Process only non-code-block parts
  const processedParts = parts.map((part, index) => {
    // Odd indices are code blocks (captured groups from split)
    if (index % 2 === 1) {
      return part // Return code blocks unchanged
    }

    let result = part

    // Generic path: escape the interior of every shown-delimiter rpBody wrap.
    for (const pattern of escapableRpBody) {
      result = escapeRpBodyInterior(result, pattern)
    }

    // Escape inside [...] if bracket narration is in patterns
    if (hasBracketNarration) {
      result = result.replace(/\[([^\]]+)\](?!\()/g, (_match, inner) => {
        const escaped = inner.replace(MARKDOWN_CHARS, '\\$1')
        return `[${escaped}]`
      })
    }

    // Escape inside {...} if brace monologue is in patterns.
    // Excludes {{template}} variables using lookbehind/lookahead.
    if (hasBraceMonologue) {
      result = result.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, (_match, inner) => {
        const escaped = inner.replace(MARKDOWN_CHARS, '\\$1')
        return `{${escaped}}`
      })
    }

    // Escape inside *...* if single asterisks are used for narration.
    // Be careful not to double-escape or break bold **...**.
    if (hasAsteriskNarration) {
      result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_match, inner) => {
        const escaped = inner.replace(/([_~`])/g, '\\$1')
        return `*${escaped}*`
      })
    }

    return result
  })

  return processedParts.join('')
}
