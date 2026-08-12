/**
 * Episodic-spine helpers (episodic recall overhaul).
 *
 * Small, pure utilities shared by the write path (memory-service, memory-gate,
 * extraction) and the read path (injector, tools):
 *
 *  - {@link buildMemoryAnchorLine} / {@link buildMemoryEmbeddingText}: the
 *    `(when: 2026-07-14 · place: Lighthouse Point)` anchor line appended to a
 *    memory's embedded text so the vector itself carries temporal/place signal.
 *  - {@link resolveWhenPhrase}: deterministic server-side resolution of a
 *    model-emitted `when` phrase (absolute or relative) into an ISO
 *    `occurredAt`, anchored to the source turn's timestamp.
 *  - {@link eventReferenceTimeMs}: the event clock (`occurredAt ?? write
 *    clock`) used for age labels — distinct from the decay reference time in
 *    memory-weighting, which stays on the write/reinforce clock.
 *
 * Pure + I/O-free so it is trivially unit-testable and safe to import from the
 * forked job child.
 */

/** Structural view of the episodic fields (keeps this module Memory-import-free). */
export interface EpisodicAnchorView {
  occurredAt?: string | null
  narrativeTime?: string | null
  entities?: readonly string[] | null
}

/** Cap on entities rendered into the anchor line so it stays one line. */
const ANCHOR_MAX_ENTITIES = 4

/**
 * Render the anchor line appended to a memory's embedded text, e.g.
 * `(when: 2026-07-14 · place: Lighthouse Point)`. Returns `''` when the memory
 * carries no anchors, so callers can append unconditionally. The date is
 * rendered as the ISO calendar date (time-of-day adds noise, not signal, to
 * the embedding); `narrativeTime` rides along verbatim when present.
 */
export function buildMemoryAnchorLine(view: EpisodicAnchorView): string {
  const parts: string[] = []
  const occurredAt = view.occurredAt?.trim()
  if (occurredAt) {
    const dateOnly = occurredAt.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      parts.push(`when: ${dateOnly}`)
    }
  }
  const narrativeTime = view.narrativeTime?.trim()
  if (narrativeTime) {
    parts.push(`story time: ${narrativeTime}`)
  }
  const entities = (view.entities ?? [])
    .map(e => (typeof e === 'string' ? e.trim() : ''))
    .filter(e => e.length > 0)
    .slice(0, ANCHOR_MAX_ENTITIES)
  if (entities.length > 0) {
    parts.push(`place: ${entities.join(', ')}`)
  }
  if (parts.length === 0) return ''
  return `(${parts.join(' · ')})`
}

/**
 * Build the canonical embedded text for a memory: `summary\n\ncontent`, plus
 * the anchor line when any episodic anchor is present. Single source of truth —
 * the gate, the create paths, re-embeds, and reinforcement must all agree or
 * the gate compares against differently-shaped vectors than it writes.
 *
 * New writes only carry the anchor; legacy rows re-embed without one until the
 * optional batched re-embed runs. Mixed old/new embedded-text rows are an
 * accepted, indefinite state (see the spec's cross-cutting list).
 */
export function buildMemoryEmbeddingText(
  summary: string,
  content: string,
  anchors?: EpisodicAnchorView | null,
): string {
  const base = `${summary}\n\n${content}`
  const anchorLine = anchors ? buildMemoryAnchorLine(anchors) : ''
  return anchorLine ? `${base}\n${anchorLine}` : base
}

/** Milliseconds per day. */
const DAY_MS = 86_400_000

const MONTH_NAMES: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

const UNIT_MS: Record<string, number> = {
  day: DAY_MS,
  days: DAY_MS,
  week: 7 * DAY_MS,
  weeks: 7 * DAY_MS,
  month: 30 * DAY_MS,
  months: 30 * DAY_MS,
  year: 365 * DAY_MS,
  years: 365 * DAY_MS,
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3,
}

/** Midnight-UTC ISO timestamp for a calendar date derived from `ms`. */
function isoDateFromMs(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 10)}T00:00:00.000Z`
}

/**
 * Deterministically resolve a `when` phrase into an ISO `occurredAt`, anchored
 * to `anchorIso` (the source turn's message timestamp). Handles:
 *
 *  - Absolute ISO dates / datetimes (`2026-07-14`, `2026-07-14T09:30:00Z`)
 *  - `Month day[, year]` / `day Month [year]` (year defaults to the anchor's,
 *    rolled back a year if that lands in the anchor's future)
 *  - `today` / `tonight` / `this morning…` → the anchor timestamp itself
 *  - `yesterday`, `N days/weeks/months/years ago`, `last week/month/year`,
 *    `last <weekday>`, `a couple/few days ago` — resolved to a calendar date
 *
 * Returns null for anything unrecognized (including future-tense phrases) —
 * recall must degrade, never block, so an unresolvable phrase simply leaves
 * `occurredAt` to the fallback stamping rule.
 */
export function resolveWhenPhrase(
  phrase: string | null | undefined,
  anchorIso: string,
): string | null {
  const raw = phrase?.trim()
  if (!raw) return null
  const anchorMs = Date.parse(anchorIso)
  if (!Number.isFinite(anchorMs)) return null
  const lower = raw.toLowerCase()

  // Absolute ISO datetime / date.
  const isoMatch = lower.match(/^(\d{4})-(\d{2})-(\d{2})(t[\d:.]+(z|[+-]\d{2}:?\d{2})?)?$/)
  if (isoMatch) {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) {
      return isoMatch[4] ? new Date(parsed).toISOString() : `${lower.slice(0, 10)}T00:00:00.000Z`
    }
    return null
  }

  // "July 14, 2026" / "July 14" / "14 July 2026" / "14 July"
  const monthFirst = lower.match(/^(?:on\s+)?([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/)
  const dayFirst = lower.match(/^(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)(?:,?\s+(\d{4}))?$/)
  const named = monthFirst && MONTH_NAMES[monthFirst[1]] !== undefined
    ? { month: MONTH_NAMES[monthFirst[1]], day: parseInt(monthFirst[2], 10), year: monthFirst[3] ? parseInt(monthFirst[3], 10) : null }
    : dayFirst && MONTH_NAMES[dayFirst[2]] !== undefined
      ? { month: MONTH_NAMES[dayFirst[2]], day: parseInt(dayFirst[1], 10), year: dayFirst[3] ? parseInt(dayFirst[3], 10) : null }
      : null
  if (named && named.day >= 1 && named.day <= 31) {
    const anchor = new Date(anchorMs)
    let year = named.year ?? anchor.getUTCFullYear()
    let candidate = Date.UTC(year, named.month, named.day)
    // A yearless date that lands after the anchor refers to the previous year
    // (retold events are in the past).
    if (named.year === null && candidate > anchorMs) {
      year -= 1
      candidate = Date.UTC(year, named.month, named.day)
    }
    return isoDateFromMs(candidate)
  }

  // The anchor moment itself.
  if (/^(today|tonight|this (morning|afternoon|evening|night)|earlier( today)?|just now|now)$/.test(lower)) {
    return new Date(anchorMs).toISOString()
  }

  if (/^(yesterday|last night)$/.test(lower)) {
    return isoDateFromMs(anchorMs - DAY_MS)
  }

  // "N days ago", "a week ago", "a couple of months ago", "few days back"
  const agoMatch = lower.match(/^(?:about\s+|around\s+|some\s+)?([a-z]+|\d+)\s+(?:of\s+)?(days?|weeks?|months?|years?)\s+(?:ago|back|earlier|before)$/)
  if (agoMatch) {
    const n = /^\d+$/.test(agoMatch[1]) ? parseInt(agoMatch[1], 10) : WORD_NUMBERS[agoMatch[1]]
    const unit = UNIT_MS[agoMatch[2]]
    if (n !== undefined && n > 0 && n < 10000 && unit) {
      return isoDateFromMs(anchorMs - n * unit)
    }
  }
  // "a couple of days ago" (couple/few consume an extra "of" word slot)
  const coupleMatch = lower.match(/^a\s+(couple|few)\s+(?:of\s+)?(days?|weeks?|months?|years?)\s+(?:ago|back)$/)
  if (coupleMatch) {
    const n = WORD_NUMBERS[coupleMatch[1]]
    const unit = UNIT_MS[coupleMatch[2]]
    if (n && unit) return isoDateFromMs(anchorMs - n * unit)
  }

  // "last week/month/year", "the other day", "last spring" (seasons → mid-season approximation)
  if (/^last week$/.test(lower)) return isoDateFromMs(anchorMs - 7 * DAY_MS)
  if (/^last month$/.test(lower)) return isoDateFromMs(anchorMs - 30 * DAY_MS)
  if (/^last year$/.test(lower)) return isoDateFromMs(anchorMs - 365 * DAY_MS)
  if (/^the other day$/.test(lower)) return isoDateFromMs(anchorMs - 2 * DAY_MS)

  // "last <weekday>" — the most recent strictly-past occurrence of that weekday.
  const weekdayMatch = lower.match(/^last\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/)
  if (weekdayMatch) {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const target = weekdays.indexOf(weekdayMatch[1])
    const anchorDay = new Date(anchorMs).getUTCDay()
    const back = ((anchorDay - target + 7) % 7) || 7
    return isoDateFromMs(anchorMs - back * DAY_MS)
  }

  const seasonMatch = lower.match(/^last\s+(spring|summer|fall|autumn|winter)$/)
  if (seasonMatch) {
    // Coarse: treat "last <season>" as ~6 months back. Precision is not the
    // point — landing in the right half-year is enough for window retrieval.
    return isoDateFromMs(anchorMs - 182 * DAY_MS)
  }

  return null
}

/**
 * Event-clock reference time for age labels: prefer `occurredAt` (when the
 * event happened) over the write/reinforce clock. Falls back to the supplied
 * write-clock milliseconds when `occurredAt` is absent or unparsable.
 */
export function eventReferenceTimeMs(
  occurredAt: string | null | undefined,
  writeClockMs: number,
): number {
  if (occurredAt) {
    const parsed = Date.parse(occurredAt)
    if (Number.isFinite(parsed)) return parsed
  }
  return writeClockMs
}
