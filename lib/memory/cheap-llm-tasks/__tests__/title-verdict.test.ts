/**
 * Regression tests for bug 96 — a one-key typo in a cheap model's JSON must
 * not read as "this chat does not want a new title".
 *
 * Live provenance (Friday, chat 745e8a5e, 2026-08-23 22:18:10 UTC):
 * deepseek-v4-flash answered `needsNewTitle: true` and put the title under
 * `suggestTitle`. The canonical-key-only read yielded `undefined`, the caller
 * treated that as a decline, the checkpoint cursor advanced to 7, and the
 * story background — which queues only off a successful rename — never ran.
 */

import { parseTitleVerdict, MAX_TITLE_LENGTH } from '../title-verdict'

jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}))

const LABEL = 'consider-title-update'

describe('parseTitleVerdict', () => {
  it('reads the canonical key', () => {
    const verdict = parseTitleVerdict(
      JSON.stringify({ needsNewTitle: true, reason: 'generic', suggestedTitle: 'A Quiet Reckoning' }),
      LABEL,
    )
    expect(verdict).toEqual({
      needsNewTitle: true,
      reason: 'generic',
      suggestedTitle: 'A Quiet Reckoning',
    })
  })

  it('recovers the exact live payload that caused bug 96', () => {
    const verdict = parseTitleVerdict(
      JSON.stringify({
        needsNewTitle: true,
        reason: "The current title is generic and doesn't reflect the content.",
        suggestTitle: "The Beast's Hundred Gigajoules",
      }),
      LABEL,
    )
    expect(verdict.needsNewTitle).toBe(true)
    expect(verdict.suggestedTitle).toBe("The Beast's Hundred Gigajoules")
  })

  it.each([
    ['suggestTitle', 'suggestTitle'],
    ['newTitle', 'newTitle'],
    ['proposedTitle', 'proposedTitle'],
    ['title', 'title'],
    ['snake case', 'suggested_title'],
    ['kebab case', 'suggested-title'],
    ['pascal case', 'SuggestedTitle'],
    ['shouting', 'SUGGESTED_TITLE'],
  ])('accepts a title under %s', (_label, key) => {
    const verdict = parseTitleVerdict(
      JSON.stringify({ needsNewTitle: true, reason: 'r', [key]: 'Amber Lines Above the Table' }),
      LABEL,
    )
    expect(verdict.suggestedTitle).toBe('Amber Lines Above the Table')
  })

  it('prefers the canonical key when a model emits several', () => {
    const verdict = parseTitleVerdict(
      JSON.stringify({
        needsNewTitle: true,
        reason: 'r',
        title: 'Wrong One',
        suggestedTitle: 'Right One',
      }),
      LABEL,
    )
    expect(verdict.suggestedTitle).toBe('Right One')
  })

  it('honours a genuine decline even with a title present', () => {
    const verdict = parseTitleVerdict(
      JSON.stringify({ needsNewTitle: false, reason: 'already descriptive', suggestedTitle: 'Nope' }),
      LABEL,
    )
    expect(verdict.needsNewTitle).toBe(false)
  })

  it('strips code fences', () => {
    const verdict = parseTitleVerdict(
      '```json\n{"needsNewTitle": true, "reason": "r", "suggestedTitle": "Fenced"}\n```',
      LABEL,
    )
    expect(verdict.suggestedTitle).toBe('Fenced')
  })

  it('unwraps a quoted title', () => {
    const verdict = parseTitleVerdict(
      JSON.stringify({ needsNewTitle: true, reason: 'r', suggestedTitle: '"Quoted Title"' }),
      LABEL,
    )
    expect(verdict.suggestedTitle).toBe('Quoted Title')
  })

  it('truncates an overlong title to the cap', () => {
    const verdict = parseTitleVerdict(
      JSON.stringify({ needsNewTitle: true, reason: 'r', suggestedTitle: 'x'.repeat(200) }),
      LABEL,
    )
    expect(verdict.suggestedTitle).toHaveLength(MAX_TITLE_LENGTH)
    expect(verdict.suggestedTitle!.endsWith('...')).toBe(true)
  })

  it('treats a whitespace-only title as absent', () => {
    const verdict = parseTitleVerdict(
      JSON.stringify({ needsNewTitle: true, reason: 'r', suggestedTitle: '   ' }),
      LABEL,
    )
    expect(verdict.suggestedTitle).toBeNull()
  })

  it('declines rather than throwing on unparseable output', () => {
    const verdict = parseTitleVerdict('I think the title is fine, actually.', LABEL)
    expect(verdict).toEqual({
      needsNewTitle: false,
      reason: 'Failed to parse response',
      suggestedTitle: null,
    })
  })

  it('declines on JSON that is not an object', () => {
    expect(parseTitleVerdict('["a title"]', LABEL).needsNewTitle).toBe(false)
    expect(parseTitleVerdict('"a title"', LABEL).needsNewTitle).toBe(false)
  })

  it('ignores a non-string title value', () => {
    const verdict = parseTitleVerdict(
      JSON.stringify({ needsNewTitle: true, reason: 'r', suggestedTitle: 42 }),
      LABEL,
    )
    expect(verdict.suggestedTitle).toBeNull()
  })

  it('warns when a rename is requested with no readable title', () => {
    const { logger } = jest.requireMock('@/lib/logger')
    logger.warn.mockClear()

    parseTitleVerdict(
      JSON.stringify({ needsNewTitle: true, reason: 'r', headline: 'Under An Unknown Key' }),
      LABEL,
      'chat-1',
    )

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('supplied no usable title'),
      expect.objectContaining({ chatId: 'chat-1' }),
    )
  })

  it('warns when the title arrives under a non-canonical key', () => {
    const { logger } = jest.requireMock('@/lib/logger')
    logger.warn.mockClear()

    parseTitleVerdict(
      JSON.stringify({ needsNewTitle: true, reason: 'r', suggestTitle: 'Recovered' }),
      LABEL,
      'chat-2',
    )

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('non-canonical key'),
      expect.objectContaining({ actualKey: 'suggestTitle' }),
    )
  })

  it('does not warn on a clean canonical response', () => {
    const { logger } = jest.requireMock('@/lib/logger')
    logger.warn.mockClear()

    parseTitleVerdict(
      JSON.stringify({ needsNewTitle: true, reason: 'r', suggestedTitle: 'Clean' }),
      LABEL,
    )

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('defaults a missing reason', () => {
    const verdict = parseTitleVerdict(JSON.stringify({ needsNewTitle: false }), LABEL)
    expect(verdict.reason).toBe('No reason provided')
  })
})
