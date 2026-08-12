import { describe, expect, it } from '@jest/globals'

import { diffLines, changedBlockIndices } from '@/lib/doc-edit/line-diff'

describe('diffLines', () => {
  it('reports no ops for identical input', () => {
    expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'equal', line: 'b' },
    ])
  })

  it('reports a single insertion, leaving shifted lines equal', () => {
    const ops = diffLines(['a', 'b', 'c'], ['a', 'NEW', 'b', 'c'])
    expect(ops).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'ins', line: 'NEW' },
      { type: 'equal', line: 'b' },
      { type: 'equal', line: 'c' },
    ])
  })

  it('reports a modification as a delete paired with an insert', () => {
    const ops = diffLines(['a', 'b', 'c'], ['a', 'B', 'c'])
    expect(ops.filter((o) => o.type === 'del')).toEqual([{ type: 'del', line: 'b' }])
    expect(ops.filter((o) => o.type === 'ins')).toEqual([{ type: 'ins', line: 'B' }])
    expect(ops.filter((o) => o.type === 'equal')).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'equal', line: 'c' },
    ])
  })
})

describe('changedBlockIndices', () => {
  it('marks nothing when the blocks are unchanged', () => {
    expect(changedBlockIndices(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual(new Set())
  })

  it('marks only the inserted block, not the ones that shifted down', () => {
    // The heart of the bug: inserting a block at the top must not flag every
    // block below it as changed.
    const baseline = ['intro', 'section one', 'body one']
    const current = ['intro', 'NEW SECTION', 'section one', 'body one']
    expect(changedBlockIndices(baseline, current)).toEqual(new Set([1]))
  })

  it('marks a modified block at its current index', () => {
    expect(changedBlockIndices(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual(new Set([1]))
  })

  it('marks nothing for a pure deletion (no current block to flag)', () => {
    // Deleting a block above leaves the survivors unchanged; a removed block has
    // no counterpart in the current document, matching a unified diff's `-` line.
    expect(changedBlockIndices(['a', 'b', 'c'], ['a', 'c'])).toEqual(new Set())
  })

  it('marks each block when all content is replaced', () => {
    expect(changedBlockIndices(['a', 'b'], ['x', 'y'])).toEqual(new Set([0, 1]))
  })

  it('handles insertion into an empty document', () => {
    expect(changedBlockIndices([], ['a', 'b'])).toEqual(new Set([0, 1]))
  })
})
