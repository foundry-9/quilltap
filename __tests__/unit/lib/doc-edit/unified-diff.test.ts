import { describe, expect, it } from '@jest/globals'

import { generateUnifiedDiff, formatAutosaveNotification } from '@/lib/doc-edit/unified-diff'

/** Split a generated diff into the lines that follow the two file headers. */
function bodyLines(diff: string): string[] {
  const lines = diff.split('\n')
  return lines.slice(2) // drop `--- a/...` and `+++ b/...`
}

describe('generateUnifiedDiff', () => {
  it('returns an empty string when the content is unchanged', () => {
    expect(generateUnifiedDiff('same\ntext', 'same\ntext', 'draft.md')).toBe('')
  })

  it('returns an empty string when both sides are empty', () => {
    expect(generateUnifiedDiff('', '', 'draft.md')).toBe('')
  })

  it('includes unified diff headers and changed lines for insertions', () => {
    const diff = generateUnifiedDiff('alpha\nbeta\n', 'alpha\ngamma\nbeta\n', 'draft.md')

    expect(diff).toContain('--- a/draft.md')
    expect(diff).toContain('+++ b/draft.md')
    expect(diff).toContain('+gamma')
  })

  it('includes removed lines for deletions', () => {
    const diff = generateUnifiedDiff('alpha\nbeta\ngamma\n', 'alpha\ngamma\n', 'draft.md')

    expect(diff).toContain('-beta')
  })

  it('emits a minimal hunk: unchanged lines become context, not churn', () => {
    // Only the middle line changes; the surrounding lines must survive as
    // ` context`, never as paired `-`/`+` rewrites.
    const oldText = 'one\ntwo\nthree\nfour\nfive'
    const newText = 'one\ntwo\nTHREE\nfour\nfive'
    const body = bodyLines(generateUnifiedDiff(oldText, newText, 'draft.md'))

    expect(body).toEqual([
      '@@ -1,5 +1,5 @@',
      ' one',
      ' two',
      '-three',
      '+THREE',
      ' four',
      ' five',
    ])
  })

  it('caps context to three lines around a change', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line${i + 1}`)
    const oldText = lines.join('\n')
    const changed = [...lines]
    changed[6] = 'CHANGED'
    const newText = changed.join('\n')

    const body = bodyLines(generateUnifiedDiff(oldText, newText, 'draft.md'))

    // Change is on line 7 (index 6); expect 3 lines of context on each side.
    expect(body).toEqual([
      '@@ -4,7 +4,7 @@',
      ' line4',
      ' line5',
      ' line6',
      '-line7',
      '+CHANGED',
      ' line8',
      ' line9',
      ' line10',
    ])
  })

  it('splits distant changes into separate hunks', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`)
    const oldText = lines.join('\n')
    const changed = [...lines]
    changed[1] = 'TOP'
    changed[18] = 'BOTTOM'
    const newText = changed.join('\n')

    const diff = generateUnifiedDiff(oldText, newText, 'draft.md')
    const hunkHeaders = diff.split('\n').filter((l) => l.startsWith('@@'))

    expect(hunkHeaders).toHaveLength(2)
    expect(diff).toContain('-line2')
    expect(diff).toContain('+TOP')
    expect(diff).toContain('-line19')
    expect(diff).toContain('+BOTTOM')
  })

  it('coalesces nearby changes into a single hunk', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`)
    const oldText = lines.join('\n')
    const changed = [...lines]
    changed[3] = 'A'
    changed[5] = 'B' // only one unchanged line between the two edits
    const newText = changed.join('\n')

    const hunkHeaders = generateUnifiedDiff(oldText, newText, 'draft.md')
      .split('\n')
      .filter((l) => l.startsWith('@@'))

    expect(hunkHeaders).toHaveLength(1)
  })

  it('does not rewrite lines that merely moved past an inserted block', () => {
    // Inserting a line should add exactly one `+` and no `-` churn on the
    // lines that shifted down.
    const oldText = 'a\nb\nc'
    const newText = 'a\nNEW\nb\nc'
    const body = bodyLines(generateUnifiedDiff(oldText, newText, 'draft.md'))

    expect(body.filter((l) => l.startsWith('+'))).toEqual(['+NEW'])
    expect(body.filter((l) => l.startsWith('-'))).toEqual([])
  })

  it('represents a pure insertion into an empty file with a zero-length old range', () => {
    const diff = generateUnifiedDiff('', 'hello\nworld', 'draft.md')
    expect(diff).toContain('@@ -0,0 +1,2 @@')
    expect(diff).toContain('+hello')
    expect(diff).toContain('+world')
  })
})

describe('formatAutosaveNotification', () => {
  it('returns null when there is no meaningful diff', () => {
    expect(formatAutosaveNotification('same', 'same', 'draft.md')).toBeNull()
  })

  it('wraps the diff in the autosave notification message', () => {
    const message = formatAutosaveNotification('old line', 'new line', 'draft.md')

    expect(message).toContain('I\'ve made changes to "draft.md"')
    expect(message).toContain('```diff')
    expect(message).toContain('--- a/draft.md')
  })
})
