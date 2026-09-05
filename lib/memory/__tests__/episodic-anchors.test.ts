/**
 * `resolveEpisodicAnchors` — the one when-phrase → occurredAt/narrativeTime
 * policy shared by the per-turn extractor and the fold-episode pass.
 */

import { resolveEpisodicAnchors } from '../episodic-anchors'

const ANCHOR = '2026-07-20T09:05:00.000Z' // a Monday
const WINDOW_START = '2026-07-19T18:00:00.000Z'

describe('resolveEpisodicAnchors', () => {
  it('falls back to fallbackIso when no phrase is given', () => {
    expect(
      resolveEpisodicAnchors({ when: null, referenceIso: ANCHOR, fallbackIso: ANCHOR, timelineMode: 'realtime' }),
    ).toEqual({ occurredAt: ANCHOR, narrativeTime: null })
  })

  it('resolves the phrase against referenceIso and keeps the fallback otherwise', () => {
    const resolved = resolveEpisodicAnchors({
      when: 'last Tuesday',
      referenceIso: ANCHOR,
      fallbackIso: WINDOW_START,
      timelineMode: 'realtime',
    })
    expect(resolved.occurredAt).not.toBeNull()
    expect(resolved.occurredAt!.slice(0, 10)).toBe('2026-07-14')
    expect(resolved.narrativeTime).toBeNull()

    expect(
      resolveEpisodicAnchors({
        when: 'when the moons align',
        referenceIso: ANCHOR,
        fallbackIso: WINDOW_START,
        timelineMode: 'realtime',
      }),
    ).toEqual({ occurredAt: WINDOW_START, narrativeTime: null })
  })

  it('never resolves without a reference (turn-extractor shape with no anchor)', () => {
    expect(
      resolveEpisodicAnchors({ when: 'yesterday', referenceIso: null, fallbackIso: null, timelineMode: 'realtime' }),
    ).toEqual({ occurredAt: null, narrativeTime: null })
  })

  it('preserves the raw phrase as narrativeTime on fictional timelines', () => {
    expect(
      resolveEpisodicAnchors({
        when: 'the third night of the siege',
        referenceIso: ANCHOR,
        fallbackIso: ANCHOR,
        timelineMode: 'narrative',
      }),
    ).toEqual({ occurredAt: ANCHOR, narrativeTime: 'the third night of the siege' })
  })

  it('lets an explicit narrativeTime outrank the phrase, and survive realtime mode', () => {
    expect(
      resolveEpisodicAnchors({
        when: 'yesterday',
        referenceIso: ANCHOR,
        fallbackIso: ANCHOR,
        timelineMode: 'narrative',
        narrativeTime: 'Midwinter Eve',
      }).narrativeTime,
    ).toBe('Midwinter Eve')
    expect(
      resolveEpisodicAnchors({
        when: 'yesterday',
        referenceIso: ANCHOR,
        fallbackIso: ANCHOR,
        timelineMode: 'realtime',
        narrativeTime: 'Midwinter Eve',
      }).narrativeTime,
    ).toBe('Midwinter Eve')
  })
})
