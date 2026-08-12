/**
 * Unified diff helpers for Scriptorium document editing.
 *
 * Keeps autosave notifications and other document-mode change summaries
 * consistent across the app.
 *
 * The diff is a real, minimal, git-style unified diff: a Myers shortest-edit
 * script over lines, grouped into hunks with surrounding context, so the output
 * reads the way a `diff` is expected to read (matched lines stay put, only the
 * genuinely changed lines get `-`/`+` markers, and nearby edits coalesce into a
 * single hunk).
 */

import { diffLines, type LineOp } from './line-diff'

/** Lines of unchanged context kept on each side of a change, matching git's default. */
const CONTEXT_LINES = 3

/**
 * Guard against pathological inputs: the Myers trace is O(D · (N+M)) memory,
 * which is tiny for the common "lightly edited document" case (small D) but can
 * blow up when two very large, wholly-dissimilar files are compared. Past this
 * combined line count we fall back to a coarse whole-file replacement hunk,
 * which is still a valid diff — just not minimal.
 */
const MAX_DIFFABLE_LINES = 10000

/** Format one side of a hunk header (`start,count`), matching git's conventions. */
function formatRange(start: number, count: number): string {
  if (count === 0) {
    // Empty range: git points at the line *before* the change position.
    return `${start - 1},0`
  }
  if (count === 1) {
    return `${start}`
  }
  return `${start},${count}`
}

type EnrichedOp = LineOp & { oldNo: number; newNo: number }

/**
 * Group an edit script into unified-diff hunks, each carrying up to
 * CONTEXT_LINES of unchanged context on either side, coalescing changes that
 * fall within one context window of each other.
 */
function buildHunks(ops: LineOp[]): string[] {
  if (!ops.some((op) => op.type !== 'equal')) {
    return []
  }

  // Annotate each op with the 1-based line number it starts at on each side.
  const enriched: EnrichedOp[] = []
  let oldNo = 1
  let newNo = 1
  for (const op of ops) {
    enriched.push({ ...op, oldNo, newNo })
    if (op.type === 'equal') {
      oldNo++
      newNo++
    } else if (op.type === 'del') {
      oldNo++
    } else {
      newNo++
    }
  }

  // Locate maximal runs of changed ops, expand each by context, then merge runs
  // whose expanded ranges touch.
  const merged: Array<{ start: number; end: number }> = []
  let i = 0
  while (i < enriched.length) {
    if (enriched[i].type === 'equal') {
      i++
      continue
    }
    let changeStart = i
    while (i < enriched.length && enriched[i].type !== 'equal') {
      i++
    }
    const changeEnd = i - 1
    const start = Math.max(0, changeStart - CONTEXT_LINES)
    const end = Math.min(enriched.length - 1, changeEnd + CONTEXT_LINES)

    const last = merged[merged.length - 1]
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end)
    } else {
      merged.push({ start, end })
    }
  }

  const hunks: string[] = []
  for (const group of merged) {
    const slice = enriched.slice(group.start, group.end + 1)
    const oldStart = slice[0].oldNo
    const newStart = slice[0].newNo
    let oldCount = 0
    let newCount = 0
    const body: string[] = []
    for (const op of slice) {
      if (op.type === 'equal') {
        oldCount++
        newCount++
        body.push(` ${op.line}`)
      } else if (op.type === 'del') {
        oldCount++
        body.push(`-${op.line}`)
      } else {
        newCount++
        body.push(`+${op.line}`)
      }
    }
    hunks.push(`@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`)
    hunks.push(...body)
  }

  return hunks
}

/** Coarse fallback for oversized inputs: replace the whole file in one hunk. */
function wholeFileHunk(oldLines: string[], newLines: string[]): string[] {
  if (oldLines.length === 0 && newLines.length === 0) return []
  const hunks: string[] = [
    `@@ -${formatRange(1, oldLines.length)} +${formatRange(1, newLines.length)} @@`,
  ]
  for (const line of oldLines) hunks.push(`-${line}`)
  for (const line of newLines) hunks.push(`+${line}`)
  return hunks
}

/**
 * Generate a unified diff between two strings.
 * Produces git-style output with `@@` hunk headers and surrounding context.
 * Returns an empty string when the two inputs are identical.
 */
export function generateUnifiedDiff(oldText: string, newText: string, filename: string): string {
  if (oldText === newText) {
    return ''
  }

  // Treat truly-empty content as zero lines (git's 0-byte-file semantics) rather
  // than as `['']`, so creating/emptying a file doesn't churn a phantom blank line.
  const oldLines = oldText === '' ? [] : oldText.split('\n')
  const newLines = newText === '' ? [] : newText.split('\n')

  const hunks =
    oldLines.length + newLines.length > MAX_DIFFABLE_LINES
      ? wholeFileHunk(oldLines, newLines)
      : buildHunks(diffLines(oldLines, newLines))

  if (hunks.length === 0) {
    return ''
  }

  return `--- a/${filename}\n+++ b/${filename}\n${hunks.join('\n')}`
}

export function formatAutosaveNotification(oldText: string, newText: string, filename: string): string | null {
  const diff = generateUnifiedDiff(oldText, newText, filename)

  if (!diff) {
    return null
  }

  return `I've made changes to "${filename}":\n\n\`\`\`diff\n${diff}\n\`\`\``
}
