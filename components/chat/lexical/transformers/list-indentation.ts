/**
 * List indentation normalisation for the Markdown ⇄ Lexical bridge.
 *
 * Lexical's markdown package hard-codes a four-space indentation unit
 * (`LIST_INDENT_SIZE = 4`) and, on import, resolves a list item's depth with
 * `Math.floor(spaces / 4)`. Real-world Markdown — Prettier's output, most LLM
 * output, and most hand-written documents — nests bullets with **two** spaces.
 * Under Lexical's arithmetic every such child collapses to depth 0, so opening
 * a document in the editor silently flattens its sub-lists, and the next save
 * writes the flattened version back to disk.
 *
 * This module fixes both directions of the bridge:
 *
 * - {@link normalizeListIndentForLexical} rewrites list indentation to the
 *   four-space grid Lexical expects, resolving depth from the *structure* of
 *   the document (a stack of open levels) rather than from a fixed divisor. Any
 *   consistent indentation — two spaces, three, four, tabs — survives import.
 * - {@link applyListIndentUnit} does the reverse on export, re-indenting to a
 *   chosen unit so a document written with two-space nesting is saved back with
 *   two-space nesting instead of churning the whole file to four.
 * - {@link detectListIndentUnit} reads that unit off the document as loaded, and
 *   {@link setListIndentUnit} / {@link getListIndentUnit} remember it per editor
 *   instance so every export path agrees.
 *
 * Child indentation is never emitted narrower than the parent's marker, so
 * `1. ` parents nest their children at three columns even when the document's
 * unit is two — otherwise the result would not re-parse as a sub-list.
 *
 * @module components/chat/lexical/transformers/list-indentation
 */

import type { LexicalEditor } from 'lexical'

/**
 * A list item line: leading whitespace, a bullet (`-`, `*`, `+`) or ordered
 * marker (`1.`, `1)`), then either whitespace + content or nothing but
 * whitespace. Requiring whitespace before content is what keeps `---` (a
 * thematic break) and `*emphasis*` from being mistaken for list markers.
 */
const LIST_ITEM_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+\S.*|[ \t]*)$/

/** Opening or closing fence of a fenced code block. */
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/

/** Lexical's own indentation unit — what its importer counts in. */
export const LEXICAL_LIST_INDENT_SIZE = 4

/** Unit used when a document has no nested list to learn from. */
export const DEFAULT_LIST_INDENT_UNIT = 2

/** Columns a tab advances when measuring indentation. */
const TAB_WIDTH = 4

/** Bounds on a detected unit, so a malformed document can't produce nonsense. */
const MIN_UNIT = 1
const MAX_UNIT = 8

/**
 * Per-editor indentation unit, learned from the document that was loaded into
 * that editor. Keyed weakly so a disposed editor takes its entry with it.
 */
const editorIndentUnits = new WeakMap<LexicalEditor, number>()

/** Remember the indentation unit to export with for this editor. */
export function setListIndentUnit(editor: LexicalEditor, unit: number): void {
  editorIndentUnits.set(editor, clampUnit(unit))
}

/** The unit remembered for this editor, or {@link DEFAULT_LIST_INDENT_UNIT}. */
export function getListIndentUnit(editor: LexicalEditor): number {
  return editorIndentUnits.get(editor) ?? DEFAULT_LIST_INDENT_UNIT
}

function clampUnit(unit: number): number {
  if (!Number.isFinite(unit)) return DEFAULT_LIST_INDENT_UNIT
  return Math.min(MAX_UNIT, Math.max(MIN_UNIT, Math.round(unit)))
}

/** Column width of a run of leading whitespace, with tabs expanded. */
function indentWidth(whitespace: string): number {
  let width = 0
  for (const char of whitespace) {
    width = char === '\t' ? width + TAB_WIDTH - (width % TAB_WIDTH) : width + 1
  }
  return width
}

/** True for `1.` / `1)` style markers, which are wider than a bullet. */
function isOrderedMarker(marker: string): boolean {
  return /\d/.test(marker)
}

/** Columns a marker occupies including the single space after it. */
function markerWidth(marker: string): number {
  return marker.length + 1
}

/** A list item line, with its depth resolved from the surrounding document. */
interface ListLineInfo {
  /** 0-based nesting depth. */
  depth: number
  /** Column width of the line's original leading whitespace. */
  width: number
  /** The marker itself, e.g. `-` or `1.`. */
  marker: string
  /** Everything after the marker, including the space that follows it. */
  remainder: string
  /** The parent item's marker, or null at depth 0. */
  parentMarker: string | null
  /** The parent item's original indent width, or null at depth 0. */
  parentWidth: number | null
}

/**
 * Walk `markdown` line by line, resolving each list item's nesting depth from a
 * stack of open levels, and let `map` rewrite the line (returning null keeps it
 * as-is). Fenced code blocks and a leading YAML frontmatter block are copied
 * through untouched.
 */
function mapListLines(
  markdown: string,
  map: (info: ListLineInfo) => string | null,
): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  /** One entry per currently open nesting level; index === depth. */
  const stack: { width: number; marker: string }[] = []
  let fence: string | null = null
  let index = 0

  // Copy a leading `---` frontmatter block verbatim: its YAML sequences look
  // exactly like bullet lists and must not be re-indented.
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
    if (close > 0) {
      for (; index <= close; index++) out.push(lines[index])
    }
  }

  for (; index < lines.length; index++) {
    const line = lines[index]
    const fenceMatch = FENCE_RE.exec(line)

    if (fence !== null) {
      out.push(line)
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null
      }
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      out.push(line)
      continue
    }

    const match = LIST_ITEM_RE.exec(line)
    if (!match) {
      // A non-blank line at column 0 that isn't a list item closes the list.
      // Blank lines don't (a list may have blank lines between its items), and
      // neither do indented lines (they continue the current item).
      if (line.trim() !== '' && !/^[ \t]/.test(line)) stack.length = 0
      out.push(line)
      continue
    }

    const [, whitespace, marker, remainder] = match
    const width = indentWidth(whitespace)

    while (stack.length > 0 && width < stack[stack.length - 1].width) stack.pop()
    if (stack.length === 0 || width > stack[stack.length - 1].width) {
      stack.push({ width, marker })
    } else {
      // Same level as the item above: inherit its slot, but record this
      // marker so children of *this* item measure against the right width.
      stack[stack.length - 1] = { width, marker }
    }

    const depth = stack.length - 1
    const parent = depth > 0 ? stack[depth - 1] : null
    const rewritten = map({
      depth,
      width,
      marker,
      remainder,
      parentMarker: parent?.marker ?? null,
      parentWidth: parent?.width ?? null,
    })
    out.push(rewritten ?? line)
  }

  return out.join('\n')
}

/**
 * Rewrite list indentation onto Lexical's four-space grid so
 * `$convertFromMarkdownString` resolves the nesting the author actually wrote.
 * Depth comes from document structure, so two-space, three-space, four-space
 * and tab-indented documents all import identically.
 */
export function normalizeListIndentForLexical(markdown: string): string {
  return mapListLines(markdown, (info) => {
    const width = info.depth * LEXICAL_LIST_INDENT_SIZE
    return ' '.repeat(width) + info.marker + info.remainder
  })
}

/**
 * Re-indent list items to `unit` columns per level. A child is never indented
 * less than its parent's marker is wide, so ordered parents keep their children
 * at (at least) three columns and the result re-parses as the same tree.
 */
export function applyListIndentUnit(markdown: string, unit: number): string {
  const step = clampUnit(unit)
  /** Emitted indent width per depth, so children measure against the new text. */
  const emitted: number[] = []

  return mapListLines(markdown, (info) => {
    let width = 0
    if (info.depth > 0) {
      const parentWidth = emitted[info.depth - 1] ?? 0
      const parentMarker = info.parentMarker ?? '-'
      width = parentWidth + Math.max(step, markerWidth(parentMarker))
    }
    emitted.length = info.depth + 1
    emitted[info.depth] = width
    return ' '.repeat(width) + info.marker + info.remainder
  })
}

/** A textarea selection, as the source-mode formatting helpers see it. */
export interface SourceSelection {
  value: string
  start: number
  end: number
}

/** The rewritten text plus where the caret should land. */
export interface SourceEdit {
  value: string
  cursor: number
}

/**
 * Add or remove one level of indentation on every list-item line touched by the
 * selection, for the raw-Markdown (source) editing mode. Lines that aren't list
 * items are left alone, mirroring the rich-text buttons — Markdown has nowhere
 * to put an indented paragraph.
 */
function shiftSourceListLines(
  { value, start, end }: SourceSelection,
  unit: number,
  direction: 1 | -1,
): SourceEdit {
  const step = clampUnit(unit)
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEnd = value.indexOf('\n', end)
  const blockEnd = lineEnd === -1 ? value.length : lineEnd

  const shifted = value
    .slice(lineStart, blockEnd)
    .split('\n')
    .map((line) => {
      const match = LIST_ITEM_RE.exec(line)
      if (!match) return line
      if (direction === 1) return ' '.repeat(step) + line
      const [, whitespace] = match
      if (whitespace === '') return line
      // Drop one tab, or up to `step` spaces — whichever the line actually uses.
      const trimmed = whitespace.startsWith('\t')
        ? whitespace.slice(1)
        : whitespace.replace(new RegExp(`^ {1,${step}}`), '')
      return trimmed + line.slice(whitespace.length)
    })
    .join('\n')

  return {
    value: value.slice(0, lineStart) + shifted + value.slice(blockEnd),
    cursor: lineStart + shifted.length,
  }
}

/** Nest the selected source lines one level deeper. */
export function indentSourceLines(state: SourceSelection, unit: number): SourceEdit {
  return shiftSourceListLines(state, unit, 1)
}

/** Lift the selected source lines out one nesting level. */
export function outdentSourceLines(state: SourceSelection, unit: number): SourceEdit {
  return shiftSourceListLines(state, unit, -1)
}

/**
 * Read a document's own nesting unit so exports can preserve it.
 *
 * Bullet-parented nesting is the honest signal — an ordered parent forces at
 * least three columns regardless of the author's preference, so a three-column
 * step under `1. ` is read as the conventional two-space style.
 */
export function detectListIndentUnit(markdown: string): number {
  const bulletSteps: number[] = []
  const orderedSteps: number[] = []

  mapListLines(markdown, (info) => {
    if (info.parentWidth === null || info.parentMarker === null) return null
    const step = info.width - info.parentWidth
    if (step <= 0) return null
    if (isOrderedMarker(info.parentMarker)) {
      orderedSteps.push(step)
    } else {
      bulletSteps.push(step)
    }
    return null
  })

  if (bulletSteps.length > 0) return clampUnit(Math.min(...bulletSteps))
  if (orderedSteps.length > 0) {
    const step = Math.min(...orderedSteps)
    return clampUnit(step === 3 ? DEFAULT_LIST_INDENT_UNIT : step)
  }
  return DEFAULT_LIST_INDENT_UNIT
}
