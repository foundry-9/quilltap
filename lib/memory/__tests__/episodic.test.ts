/**
 * Episodic-spine helper tests: anchor line, embedding text, when-phrase
 * resolution, event-clock reference. Pure module — no mocks.
 */

import {
  buildMemoryAnchorLine,
  buildMemoryEmbeddingText,
  resolveWhenPhrase,
  eventReferenceTimeMs,
} from '../episodic'

describe('buildMemoryAnchorLine', () => {
  it('renders when + place from anchors', () => {
    expect(
      buildMemoryAnchorLine({
        occurredAt: '2026-07-14T09:30:00.000Z',
        entities: ['Lighthouse Point'],
      }),
    ).toBe('(when: 2026-07-14 · place: Lighthouse Point)')
  })

  it('includes narrative time verbatim', () => {
    expect(
      buildMemoryAnchorLine({
        narrativeTime: 'the third night at sea',
        entities: ['Meridian'],
      }),
    ).toBe('(story time: the third night at sea · place: Meridian)')
  })

  it('returns empty string with no anchors', () => {
    expect(buildMemoryAnchorLine({})).toBe('')
    expect(buildMemoryAnchorLine({ occurredAt: null, entities: [] })).toBe('')
  })

  it('caps entities and skips blanks', () => {
    const line = buildMemoryAnchorLine({
      entities: ['A', ' ', 'B', 'C', 'D', 'E', 'F'],
    })
    expect(line).toBe('(place: A, B, C, D)')
  })
})

describe('buildMemoryEmbeddingText', () => {
  it('is byte-identical to the legacy form without anchors', () => {
    expect(buildMemoryEmbeddingText('sum', 'content')).toBe('sum\n\ncontent')
    expect(buildMemoryEmbeddingText('sum', 'content', {})).toBe('sum\n\ncontent')
  })

  it('appends the anchor line when anchors exist', () => {
    expect(
      buildMemoryEmbeddingText('sum', 'content', { occurredAt: '2026-07-14T00:00:00.000Z' }),
    ).toBe('sum\n\ncontent\n(when: 2026-07-14)')
  })
})

describe('resolveWhenPhrase', () => {
  // Tuesday 2026-07-21.
  const anchor = '2026-07-21T15:00:00.000Z'

  it('passes absolute ISO dates through (date-only → midnight UTC)', () => {
    expect(resolveWhenPhrase('2026-07-14', anchor)).toBe('2026-07-14T00:00:00.000Z')
  })

  it('preserves full ISO datetimes', () => {
    expect(resolveWhenPhrase('2026-07-14T09:30:00.000Z', anchor)).toBe('2026-07-14T09:30:00.000Z')
  })

  it('resolves named dates, defaulting to the anchor year', () => {
    expect(resolveWhenPhrase('July 14', anchor)).toBe('2026-07-14T00:00:00.000Z')
    expect(resolveWhenPhrase('July 14th, 2025', anchor)).toBe('2025-07-14T00:00:00.000Z')
    expect(resolveWhenPhrase('14 July', anchor)).toBe('2026-07-14T00:00:00.000Z')
  })

  it('rolls a yearless future date back a year', () => {
    // December 25 hasn't happened yet on 2026-07-21.
    expect(resolveWhenPhrase('December 25', anchor)).toBe('2025-12-25T00:00:00.000Z')
  })

  it('resolves relative phrases against the anchor', () => {
    expect(resolveWhenPhrase('yesterday', anchor)).toBe('2026-07-20T00:00:00.000Z')
    expect(resolveWhenPhrase('3 days ago', anchor)).toBe('2026-07-18T00:00:00.000Z')
    expect(resolveWhenPhrase('last week', anchor)).toBe('2026-07-14T00:00:00.000Z')
    expect(resolveWhenPhrase('two weeks ago', anchor)).toBe('2026-07-07T00:00:00.000Z')
    expect(resolveWhenPhrase('a couple of days ago', anchor)).toBe('2026-07-19T00:00:00.000Z')
  })

  it('resolves "last <weekday>" to the most recent strictly-past occurrence', () => {
    // Anchor is a Tuesday; last Friday = 2026-07-17.
    expect(resolveWhenPhrase('last Friday', anchor)).toBe('2026-07-17T00:00:00.000Z')
    // last Tuesday must NOT be the anchor day itself.
    expect(resolveWhenPhrase('last Tuesday', anchor)).toBe('2026-07-14T00:00:00.000Z')
  })

  it('maps the anchor moment phrases to the anchor', () => {
    expect(resolveWhenPhrase('today', anchor)).toBe(anchor)
    expect(resolveWhenPhrase('this morning', anchor)).toBe(anchor)
  })

  it('returns null for unresolvable or in-story phrases', () => {
    expect(resolveWhenPhrase('the third night at sea', anchor)).toBeNull()
    expect(resolveWhenPhrase('someday soon', anchor)).toBeNull()
    expect(resolveWhenPhrase('', anchor)).toBeNull()
    expect(resolveWhenPhrase(null, anchor)).toBeNull()
  })

  it('returns null when the anchor itself is unparsable', () => {
    expect(resolveWhenPhrase('yesterday', 'not-a-date')).toBeNull()
  })
})

describe('eventReferenceTimeMs', () => {
  it('prefers occurredAt over the write clock', () => {
    const writeMs = Date.parse('2026-07-21T00:00:00.000Z')
    expect(eventReferenceTimeMs('2026-07-14T00:00:00.000Z', writeMs)).toBe(
      Date.parse('2026-07-14T00:00:00.000Z'),
    )
  })

  it('falls back to the write clock when occurredAt is absent or garbled', () => {
    const writeMs = Date.parse('2026-07-21T00:00:00.000Z')
    expect(eventReferenceTimeMs(null, writeMs)).toBe(writeMs)
    expect(eventReferenceTimeMs('garbage', writeMs)).toBe(writeMs)
  })
})
