/**
 * @jest-environment node
 */

/**
 * Unit tests for the deterministic day-reference resolver
 * (lib/memory/day-references.ts).
 *
 * TIMEZONE: this module's whole job is resolving calendar boundaries in the
 * SERVER-LOCAL zone, so the suite would ideally pin TZ. It can't: Jest hands
 * the test file a *copy* of `process.env`, so assigning `process.env.TZ` never
 * reaches V8's timezone cache, and the ambient zone leaks in either way.
 * Instead every expectation is computed through the same local-time API the
 * resolver uses, so the assertions hold in any zone — and the regression case
 * additionally proves the window is the LOCAL day rather than the UTC one
 * whenever the two differ. The live failure being pinned here: a user speaking
 * at 21:44 CDT on July 28 is already July 29 in UTC, and a UTC-day "today"
 * misses every memory from the day they are asking about.
 */

import { resolveDayReference } from '../day-references'

/** 2026-07-28 21:44 **local** — the wall-clock moment from the diagnosed chat. */
const NOW = new Date(2026, 6, 28, 21, 44, 0, 0)

/** Local midnight `offset` days from NOW's local day, as a UTC ISO string. */
function localMidnight(offset: number): string {
  return new Date(
    NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset, 0, 0, 0, 0,
  ).toISOString()
}

/** Local wall-clock hour on the day `offset` days from NOW, as a UTC ISO string. */
function localHour(offset: number, hour: number): string {
  return new Date(
    NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset, hour, 0, 0, 0,
  ).toISOString()
}

describe('resolveDayReference — the regression case', () => {
  it('resolves a late-evening "today" to the local day', () => {
    const r = resolveDayReference('No, no. I mean the mission today. I want to hear about it.', NOW)
    expect(r).not.toBeNull()
    expect(r!.matched).toBe('today')
    expect(r!.pastPointing).toBe(true)
    expect(r!.timeRange.from).toBe(localMidnight(0))
    expect(r!.timeRange.to).toBe(NOW.toISOString())
  })

  it('uses local calendar math, not UTC', () => {
    const r = resolveDayReference('the mission today', NOW)!
    // In any zone west of Greenwich, 21:44 local on the 28th is already the
    // 29th in UTC — the exact bias that made the live window miss the mission.
    // (Assertion is a no-op when the runner itself sits at UTC.)
    const utcMidnightOfNow = `${NOW.toISOString().slice(0, 10)}T00:00:00.000Z`
    if (NOW.getTimezoneOffset() > 0) {
      expect(r.timeRange.from).not.toBe(utcMidnightOfNow)
    }
    expect(r.timeRange.from).toBe(localMidnight(0))
  })

  it('covers an event that happened earlier the same local day', () => {
    const r = resolveDayReference('the mission today', NOW)!
    const middayEvent = new Date(2026, 6, 28, 12, 0, 0, 0).getTime()
    const lastNightEvent = new Date(2026, 6, 27, 23, 59, 0, 0).getTime()
    expect(Date.parse(r.timeRange.from)).toBeLessThanOrEqual(middayEvent)
    expect(Date.parse(r.timeRange.to)).toBeGreaterThanOrEqual(middayEvent)
    expect(Date.parse(r.timeRange.from)).toBeGreaterThan(lastNightEvent)
  })
})

describe('resolveDayReference — lexicon', () => {
  const cases: Array<{ text: string; matched: string; from: string; to: string }> = [
    { text: 'earlier today we talked', matched: 'earlier today', from: localMidnight(0), to: NOW.toISOString() },
    { text: 'how did it go this morning?', matched: 'this morning', from: localMidnight(0), to: NOW.toISOString() },
    { text: 'you seemed rattled this afternoon', matched: 'this afternoon', from: localMidnight(0), to: NOW.toISOString() },
    { text: 'that thing this evening', matched: 'this evening', from: localMidnight(0), to: NOW.toISOString() },
    { text: 'what a mess tonight', matched: 'tonight', from: localMidnight(0), to: NOW.toISOString() },
    { text: 'about yesterday', matched: 'yesterday', from: localMidnight(-1), to: localMidnight(0) },
    { text: 'the day before yesterday', matched: 'day before yesterday', from: localMidnight(-2), to: localMidnight(-1) },
    { text: 'we met 3 days ago', matched: '3 days ago', from: localMidnight(-3), to: localMidnight(-2) },
    { text: 'we met three days ago', matched: 'three days ago', from: localMidnight(-3), to: localMidnight(-2) },
    { text: 'that was 1 day ago', matched: '1 day ago', from: localMidnight(-1), to: localMidnight(0) },
    { text: 'fourteen days ago exactly', matched: 'fourteen days ago', from: localMidnight(-14), to: localMidnight(-13) },
  ]

  it.each(cases)('resolves "$matched" from "$text"', ({ text, matched, from, to }) => {
    const r = resolveDayReference(text, NOW)
    expect(r).not.toBeNull()
    expect(r!.matched).toBe(matched)
    expect(r!.pastPointing).toBe(true)
    expect(r!.timeRange).toEqual({ from, to })
  })

  it('spans "last night" from 18:00 the previous local evening to 06:00 this morning', () => {
    const r = resolveDayReference('you were quiet last night', NOW)!
    expect(r.timeRange.from).toBe(localHour(-1, 18))
    expect(r.timeRange.to).toBe(localHour(0, 6))
    expect(r.pastPointing).toBe(true)
  })

  it('resolves "this week" from the most recent local Monday to now', () => {
    // NOW is a Tuesday, so the week anchor is yesterday.
    expect(NOW.getDay()).toBe(2)
    const r = resolveDayReference('busy this week', NOW)!
    expect(r.timeRange.from).toBe(localMidnight(-1))
    expect(r.timeRange.to).toBe(NOW.toISOString())
  })

  it('resolves "last week" to the previous Monday–Sunday local week', () => {
    const r = resolveDayReference('what you said last week', NOW)!
    expect(r.timeRange.from).toBe(localMidnight(-8))
    expect(r.timeRange.to).toBe(localMidnight(-1))
  })

  it('leaves an out-of-range "N days ago" to the LLM', () => {
    expect(resolveDayReference('that was 97 days ago', NOW)).toBeNull()
    expect(resolveDayReference('that was 15 days ago', NOW)).toBeNull()
  })
})

describe('resolveDayReference — future references', () => {
  it('marks "tomorrow" as future-pointing', () => {
    const r = resolveDayReference("let's do it tomorrow", NOW)!
    expect(r.matched).toBe('tomorrow')
    expect(r.pastPointing).toBe(false)
  })

  it('marks "next week" as future-pointing', () => {
    const r = resolveDayReference('we can start next week', NOW)!
    expect(r.matched).toBe('next week')
    expect(r.pastPointing).toBe(false)
  })

  it('lets a later future reference suppress an earlier past one', () => {
    const r = resolveDayReference('we said yesterday that we would start tomorrow', NOW)!
    expect(r.matched).toBe('tomorrow')
    expect(r.pastPointing).toBe(false)
  })
})

describe('resolveDayReference — precedence and safety', () => {
  it('lets the latest match in the text win', () => {
    const r = resolveDayReference('we covered that yesterday — but today, the mission', NOW)!
    expect(r.matched).toBe('today')
    expect(r.timeRange.from).toBe(localMidnight(0))
  })

  it('does not let an inner phrase beat its own container', () => {
    const r = resolveDayReference('the day before yesterday', NOW)!
    expect(r.matched).toBe('day before yesterday')
  })

  it('is case-insensitive', () => {
    expect(resolveDayReference('YESTERDAY was long', NOW)!.matched).toBe('yesterday')
    expect(resolveDayReference('Today is better', NOW)!.matched).toBe('today')
  })

  it('respects word boundaries', () => {
    expect(resolveDayReference('we drove through Yesterdayville', NOW)).toBeNull()
    expect(resolveDayReference('the Todayer gazette', NOW)).toBeNull()
  })

  it('returns null when no reference is present', () => {
    expect(resolveDayReference('how are the soil samples looking', NOW)).toBeNull()
    expect(resolveDayReference('', NOW)).toBeNull()
  })

  it('returns null on an invalid clock', () => {
    expect(resolveDayReference('the mission today', new Date(NaN))).toBeNull()
  })

  it('is stateless across calls (no leaked regex lastIndex)', () => {
    const first = resolveDayReference('the mission today', NOW)
    const second = resolveDayReference('the mission today', NOW)
    expect(second).toEqual(first)
  })
})
