/**
 * Shared line-level diff primitive for Scriptorium document editing.
 *
 * A Myers O(ND) shortest-edit-script diff over arrays of strings. Used both by
 * the unified-diff generator (autosave notifications, `doc_*` edit summaries)
 * and by the in-editor change gutter, so a change is recognized the same way
 * everywhere: matched entries stay put, only genuinely different entries are
 * reported as removed/inserted, and content that merely shifted position is not
 * treated as churn.
 *
 * @module lib/doc-edit/line-diff
 */

export type LineOp = { type: 'equal' | 'del' | 'ins'; line: string }

/**
 * Myers O(ND) shortest-edit-script diff over two arrays of lines.
 * Returns the edit operations in forward order.
 */
export function diffLines(oldLines: string[], newLines: string[]): LineOp[] {
  const n = oldLines.length
  const m = newLines.length

  if (n === 0 && m === 0) return []
  if (n === 0) return newLines.map((line) => ({ type: 'ins', line }))
  if (m === 0) return oldLines.map((line) => ({ type: 'del', line }))

  const max = n + m
  const offset = max
  // v[k + offset] = furthest x reached along diagonal k for the current d.
  const v = new Array<number>(2 * max + 1).fill(0)
  const trace: number[][] = []

  let found = false
  for (let d = 0; d <= max; d++) {
    // Snapshot v as it stood before this d's expansion, for backtracking.
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      // Choose whether we arrived here by an insertion (down) or a deletion (right).
      let x: number
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset]
      } else {
        x = v[k - 1 + offset] + 1
      }
      let y = x - k
      // Follow the diagonal of matching lines (a "snake").
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x++
        y++
      }
      v[k + offset] = x
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
    if (found) break
  }

  // Backtrack from (n, m) to (0, 0), recovering the edit script in reverse.
  const ops: LineOp[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const vPrev = trace[d]
    const k = x - y
    let prevK: number
    if (k === -d || (k !== d && vPrev[k - 1 + offset] < vPrev[k + 1 + offset])) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }
    const prevX = vPrev[prevK + offset]
    const prevY = prevX - prevK

    // Diagonal moves are unchanged lines.
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', line: oldLines[x - 1] })
      x--
      y--
    }
    // The single non-diagonal move into this d (skip at d === 0, the origin).
    if (d > 0) {
      if (x === prevX) {
        ops.push({ type: 'ins', line: newLines[y - 1] })
      } else {
        ops.push({ type: 'del', line: oldLines[x - 1] })
      }
    }
    x = prevX
    y = prevY
  }

  ops.reverse()
  return ops
}

/**
 * Given a baseline and a current array of block texts, return the set of
 * *current* block indices that are genuinely new or modified — i.e. the blocks
 * a change gutter should mark.
 *
 * A modification manifests as a deletion of the old text paired with an
 * insertion of the new text, so the inserted (current) block is the one marked.
 * Pure deletions have no counterpart in the current document and therefore mark
 * nothing — matching how a unified diff shows a removed line as a `-` with no
 * `+`. Content that merely shifted position stays `equal` and is not marked.
 */
export function changedBlockIndices(baseline: string[], current: string[]): Set<number> {
  const changed = new Set<number>()
  let currentIndex = 0
  for (const op of diffLines(baseline, current)) {
    if (op.type === 'equal') {
      currentIndex++
    } else if (op.type === 'ins') {
      changed.add(currentIndex)
      currentIndex++
    }
    // 'del' consumes a baseline-only block; no current index to advance or mark.
  }
  return changed
}
