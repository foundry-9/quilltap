/**
 * Timestamp Utilities for Chat System
 *
 * Provides functions for calculating and formatting timestamps for system prompts.
 * Supports both real-time and fictional timestamps with auto-increment capabilities.
 * Supports timezone-aware formatting via IANA timezone names.
 */

import type { TimestampConfig, TimestampFormat } from '@/lib/schemas/types'

/**
 * The timestamp configuration a chat gets when nothing else supplies one — the
 * settings-form default, and the last link of every resolution chain (chat
 * config → Salon default → this). Mirrors the Zod default on
 * `chatSettings.defaultTimestampConfig`; keep the two in step.
 */
export const DEFAULT_TIMESTAMP_CONFIG: TimestampConfig = {
  mode: 'NONE',
  format: 'FRIENDLY',
  useFictionalTime: false,
  autoPrepend: true,
  intervalMinutes: 15,
}

export interface CalculatedTimestamp {
  /** Formatted timestamp string for display/prompt injection */
  formatted: string
  /** ISO-8601 timestamp value (with timezone offset when timezone is specified) */
  isoValue: string
  /** Whether this is a fictional timestamp */
  isFictional: boolean
}

/**
 * Date parts extracted via Intl.DateTimeFormat for a specific timezone.
 * Used by formatCustom() and formatISO8601WithOffset() to produce
 * timezone-correct output without shifting the Date object itself.
 */
interface DatePartsInTimezone {
  year: number
  month: number       // 0-indexed (January = 0)
  day: number
  dayOfWeek: number   // 0 = Sunday
  hours: number       // 0-23
  minutes: number
  seconds: number
  dayPeriod: string   // "AM" or "PM"
}

/**
 * Extract date components in a target timezone using Intl.DateTimeFormat.
 * This is the core mechanism for timezone-aware formatting — it reads the
 * date as it would appear on a clock in the specified timezone.
 *
 * @param date - The Date to extract parts from
 * @param timezone - IANA timezone name (e.g., "America/New_York"). If undefined, uses system default.
 */
function getDatePartsInTimezone(date: Date, timezone?: string): DatePartsInTimezone {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...(timezone ? { timeZone: timezone } : {}),
  }

  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date)
  const get = (type: string): string => parts.find(p => p.type === type)?.value || '0'

  const hours = Number(get('hour'))
  // Intl with hour12:false can return "24" for midnight in some locales
  const normalizedHours = hours === 24 ? 0 : hours

  return {
    year: Number(get('year')),
    month: Number(get('month')) - 1, // Convert to 0-indexed
    day: Number(get('day')),
    dayOfWeek: (() => {
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
      const weekday = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        ...(timezone ? { timeZone: timezone } : {}),
      }).format(date)
      return dayMap[weekday] ?? 0
    })(),
    hours: normalizedHours,
    minutes: Number(get('minute')),
    seconds: Number(get('second')),
    dayPeriod: normalizedHours < 12 ? 'AM' : 'PM',
  }
}

/**
 * Matches a zone-less ("naive") wall-clock timestamp, the shape an <input type="datetime-local">
 * produces: "1550-07-25T10:15", optionally with seconds. A trailing "Z" or "+05:30" makes the
 * string absolute and disqualifies it here.
 */
const NAIVE_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Interpret a timestamp string as a wall-clock reading in a target timezone.
 *
 * `new Date("1550-07-25T10:15")` resolves a zone-less string against the *server's* timezone,
 * which then gets re-rendered in the story's timezone — so a base of 10:15 set for
 * Europe/Istanbul surfaced as 6:01 PM on an America/Chicago host (the two LMT offsets of 1550
 * differing by ~7h46m). The fictional base is a clock reading in the story's own timezone, so
 * that is where it must be anchored.
 *
 * Strings carrying an explicit zone (…Z, …+05:30) are already absolute and pass through untouched.
 *
 * Resolution is iterative because the offset depends on the very instant being solved for
 * (DST, and pre-standardisation LMT offsets that carry seconds). It converges in one step for
 * fixed offsets and two across a DST boundary; three is slack.
 *
 * @param value - Timestamp string, zone-less or absolute
 * @param timezone - IANA timezone name. When undefined, falls back to system-local parsing.
 */
export function parseTimestampInTimezone(value: string, timezone?: string): Date {
  const match = NAIVE_TIMESTAMP_PATTERN.exec(value.trim())
  if (!match || !timezone) return new Date(value)

  const [, year, month, day, hours, minutes, seconds] = match
  const target = Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hours), Number(minutes), seconds ? Number(seconds) : 0
  )

  let instant = target
  for (let attempt = 0; attempt < 3; attempt++) {
    const shownAs = getDatePartsInTimezone(new Date(instant), timezone)
    const shown = Date.UTC(
      shownAs.year, shownAs.month, shownAs.day,
      shownAs.hours, shownAs.minutes, shownAs.seconds
    )
    const drift = target - shown
    if (drift === 0) break
    instant += drift
  }

  return new Date(instant)
}

/**
 * Compute the UTC offset string (e.g., "+05:30" or "-04:00") for a Date in a given timezone.
 * Uses Intl to find what the local time is, then computes the difference from UTC.
 */
function getTimezoneOffset(date: Date, timezone?: string): string {
  if (!timezone) {
    // Use local system offset
    const offsetMin = date.getTimezoneOffset()
    const sign = offsetMin <= 0 ? '+' : '-'
    const absMin = Math.abs(offsetMin)
    const h = String(Math.floor(absMin / 60)).padStart(2, '0')
    const m = String(absMin % 60).padStart(2, '0')
    return `${sign}${h}:${m}`
  }

  // Get the time in the target timezone and in UTC, then compute the difference
  const parts = getDatePartsInTimezone(date, timezone)
  const utcParts = getDatePartsInTimezone(date, 'UTC')

  // Build comparable timestamps (minutes since midnight, adjusted for day boundary)
  const tzMinutes = parts.hours * 60 + parts.minutes
  const utcMinutes = utcParts.hours * 60 + utcParts.minutes

  // Day difference handling
  let diff = tzMinutes - utcMinutes
  if (parts.day !== utcParts.day) {
    // If days differ, the timezone is ahead or behind by roughly a day
    if (parts.day > utcParts.day || (parts.month > utcParts.month) || (parts.year > utcParts.year)) {
      diff += 24 * 60
    } else {
      diff -= 24 * 60
    }
  }

  const sign = diff >= 0 ? '+' : '-'
  const absDiff = Math.abs(diff)
  const h = String(Math.floor(absDiff / 60)).padStart(2, '0')
  const m = String(absDiff % 60).padStart(2, '0')
  return `${sign}${h}:${m}`
}

/**
 * Format a date as ISO-8601 with timezone offset instead of always "Z".
 * e.g., "2026-02-22T14:30:00-05:00" for America/New_York
 */
function formatISO8601WithTimezone(date: Date, timezone?: string): string {
  const p = getDatePartsInTimezone(date, timezone)
  const offset = getTimezoneOffset(date, timezone)

  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T` +
    `${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}:${String(p.seconds).padStart(2, '0')}${offset}`
}

/**
 * Format patterns for different timestamp formats.
 * Each format function accepts an optional timezone parameter.
 */
const FORMAT_OPTIONS: Record<
  Exclude<TimestampFormat, 'CUSTOM'>,
  { format: (date: Date, timezone?: string) => string }
> = {
  ISO8601: {
    format: (date: Date, timezone?: string) =>
      timezone ? formatISO8601WithTimezone(date, timezone) : date.toISOString(),
  },
  FRIENDLY: {
    format: (date: Date, timezone?: string) =>
      new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        ...(timezone ? { timeZone: timezone } : {}),
      }).format(date),
  },
  DATE_ONLY: {
    format: (date: Date, timezone?: string) =>
      new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        ...(timezone ? { timeZone: timezone } : {}),
      }).format(date),
  },
  TIME_ONLY: {
    format: (date: Date, timezone?: string) =>
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        ...(timezone ? { timeZone: timezone } : {}),
      }).format(date),
  },
}

/**
 * Parse a custom format string and format the date.
 * Supports common tokens:
 * - YYYY: 4-digit year
 * - YY: 2-digit year
 * - MMMM: Full month name
 * - MMM: Abbreviated month name
 * - MM: 2-digit month (01-12)
 * - M: 1-2 digit month (1-12)
 * - DD: 2-digit day (01-31)
 * - D: 1-2 digit day (1-31)
 * - dddd: Full day name
 * - ddd: Abbreviated day name
 * - HH: 24-hour hour (00-23)
 * - H: 24-hour hour (0-23)
 * - hh: 12-hour hour (01-12)
 * - h: 12-hour hour (1-12)
 * - mm: Minutes (00-59)
 * - ss: Seconds (00-59)
 * - a: am/pm
 * - A: AM/PM
 *
 * @param date - The Date to format
 * @param formatString - Custom format pattern
 * @param timezone - Optional IANA timezone name
 */
function formatCustom(date: Date, formatString: string, timezone?: string): string {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  // Use timezone-aware date parts instead of raw Date methods
  const parts = getDatePartsInTimezone(date, timezone)
  const year = parts.year
  const month = parts.month
  const day = parts.day
  const dayOfWeek = parts.dayOfWeek
  const hours = parts.hours
  const minutes = parts.minutes
  const seconds = parts.seconds
  const hours12 = hours % 12 || 12

  // Order matters: longer patterns must be replaced first
  const replacements: [RegExp, string][] = [
    [/YYYY/g, String(year)],
    [/YY/g, String(year).slice(-2)],
    [/MMMM/g, months[month]],
    [/MMM/g, monthsShort[month]],
    [/MM/g, String(month + 1).padStart(2, '0')],
    [/M/g, String(month + 1)],
    [/dddd/g, dayNames[dayOfWeek]],
    [/ddd/g, daysShort[dayOfWeek]],
    [/DD/g, String(day).padStart(2, '0')],
    [/D/g, String(day)],
    [/HH/g, String(hours).padStart(2, '0')],
    [/H/g, String(hours)],
    [/hh/g, String(hours12).padStart(2, '0')],
    [/h/g, String(hours12)],
    [/mm/g, String(minutes).padStart(2, '0')],
    [/ss/g, String(seconds).padStart(2, '0')],
    [/A/g, hours < 12 ? 'AM' : 'PM'],
    [/a/g, hours < 12 ? 'am' : 'pm'],
  ]

  let result = formatString
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement)
  }

  return result
}

/**
 * Resolve the timezone to use for timestamp formatting.
 * Implements the fallback chain:
 *   1. Per-chat timestampConfig.timezone
 *   2. ChatSettings.timezone (Salon-level default)
 *   3. QUILLTAP_TIMEZONE env var (host OS timezone from Electron)
 *   4. undefined (system default / UTC on server)
 *
 * @param configTimezone - Per-chat timezone override from TimestampConfig
 * @param chatSettingsTimezone - Salon-level default timezone from ChatSettings
 * @returns IANA timezone name or undefined for system default
 */
export function resolveTimezone(
  configTimezone?: string | null,
  chatSettingsTimezone?: string | null
): string | undefined {
  if (configTimezone) {
    return configTimezone
  }
  if (chatSettingsTimezone) {
    return chatSettingsTimezone
  }
  const envTimezone = process.env.QUILLTAP_TIMEZONE
  if (envTimezone) {
    return envTimezone
  }
  return undefined
}

/**
 * Calculate the chat's clock reading at an arbitrary real-world instant.
 * For fictional timestamps, the story instant is the fictional base plus the real
 * time elapsed between the anchor (`fictionalBaseRealTime`) and `realInstant` —
 * story time runs 1:1 with the wall clock.
 *
 * @param realInstant - The real-world instant to translate (e.g. a message's createdAt)
 * @param config - Timestamp configuration
 * @param timezone - Optional IANA timezone name (resolved from the fallback chain by the caller)
 * @param fallbackAnchor - Anchor to measure elapsed time from when the config predates
 *   `fictionalBaseRealTime` stamping (see ensureFictionalBaseRealTime). Pass the chat's
 *   createdAt when translating historical messages; defaults to `realInstant` itself,
 *   which collapses elapsed time to zero — the pre-anchor behaviour of the live clock.
 * @returns Calculated and formatted timestamp
 */
export function calculateTimestampAt(
  realInstant: Date,
  config: TimestampConfig,
  timezone?: string,
  fallbackAnchor?: Date
): CalculatedTimestamp {
  let timestamp: Date
  let isFictional = false

  if (config.useFictionalTime && config.fictionalBaseTimestamp) {
    // Calculate fictional time based on elapsed real time. The base is a clock reading in the
    // story's own timezone, not the server's — see parseTimestampInTimezone.
    const fictionalBase = parseTimestampInTimezone(config.fictionalBaseTimestamp, timezone)
    // Without an anchor there is nothing to measure elapsed time against, so the clock would
    // report the base instant forever. Writers stamp fictionalBaseRealTime (see
    // ensureFictionalBaseRealTime); this fallback only covers rows that predate that.
    const realBase = config.fictionalBaseRealTime
      ? new Date(config.fictionalBaseRealTime)
      : (fallbackAnchor ?? realInstant)

    const elapsedMs = realInstant.getTime() - realBase.getTime()
    timestamp = new Date(fictionalBase.getTime() + elapsedMs)
    isFictional = true

  } else {
    timestamp = realInstant
  }

  // Format the timestamp with timezone support
  let formatted: string
  if (config.format === 'CUSTOM' && config.customFormat) {
    formatted = formatCustom(timestamp, config.customFormat, timezone)
  } else if (config.format === 'CUSTOM') {
    // Fall back to FRIENDLY if CUSTOM but no format string
    formatted = FORMAT_OPTIONS.FRIENDLY.format(timestamp, timezone)
  } else {
    formatted = FORMAT_OPTIONS[config.format].format(timestamp, timezone)
  }

  // For the isoValue, include timezone offset when a timezone is specified
  const isoValue = timezone
    ? formatISO8601WithTimezone(timestamp, timezone)
    : timestamp.toISOString()

  return {
    formatted,
    isoValue,
    isFictional,
  }
}

/**
 * Calculate the current timestamp based on configuration.
 * For fictional timestamps, calculates the elapsed time since the base was set
 * and adds it to the fictional base timestamp.
 *
 * @param config - Timestamp configuration
 * @param timezone - Optional IANA timezone name (resolved from the fallback chain by the caller)
 * @returns Calculated and formatted timestamp
 */
export function calculateCurrentTimestamp(config: TimestampConfig, timezone?: string): CalculatedTimestamp {
  return calculateTimestampAt(new Date(Date.now()), config, timezone)
}

/**
 * Determine if a timestamp should be injected based on configuration and context.
 *
 * @param config - Timestamp configuration
 * @param isInitialMessage - Whether this is the first message in the conversation
 * @param minutesSinceLastAnnouncement - For EVERY_N_MINUTES mode: minutes elapsed since the
 *   most recent Host timestamp announcement in this chat. Pass `null` when no prior
 *   announcement exists (or the caller cannot resolve it); the timestamp will fire.
 * @returns Whether timestamp should be injected
 */
export function shouldInjectTimestamp(
  config: TimestampConfig | null | undefined,
  isInitialMessage: boolean,
  minutesSinceLastAnnouncement?: number | null
): boolean {
  if (!config || config.mode === 'NONE') return false
  if (config.mode === 'START_ONLY') return isInitialMessage
  if (config.mode === 'EVERY_MESSAGE') return true
  if (config.mode === 'EVERY_N_MINUTES') {
    if (isInitialMessage) return true
    if (minutesSinceLastAnnouncement === null || minutesSinceLastAnnouncement === undefined) return true
    const interval = config.intervalMinutes ?? 15
    return minutesSinceLastAnnouncement >= interval
  }
  return false
}

/**
 * Anchor a fictional clock to real time, so it can actually advance.
 *
 * Story time runs 1:1 with the wall clock, measured from `fictionalBaseRealTime`. Nothing
 * populated that field for a long stretch, so `calculateCurrentTimestamp` fell back to "now",
 * measured zero elapsed time, and re-reported the configured base on every single turn — the
 * clock read the same instant forever.
 *
 * Every path that persists a fictional-time config must run it through here first. Existing
 * anchors are left alone: re-stamping a live chat would reset its clock back to the base.
 *
 * Salon- and character-level *defaults* are deliberately not anchored — a default saved months
 * ago carries no meaningful anchor. Chat creation is where a config becomes a running clock, so
 * that is where the stamp is applied (inherited defaults included).
 *
 * @param config - Configuration about to be persisted
 * @param anchor - Real-world instant the clock starts from (defaults to now). Pass a chat's
 *   createdAt when retro-fitting an existing chat.
 * @returns The config, with fictionalBaseRealTime filled in when it is needed and missing
 */
export function ensureFictionalBaseRealTime<T extends TimestampConfig | null | undefined>(
  config: T,
  anchor?: Date
): T {
  if (!config) return config
  if (!config.useFictionalTime || !config.fictionalBaseTimestamp) return config
  if (config.fictionalBaseRealTime) return config

  return {
    ...config,
    fictionalBaseRealTime: (anchor ?? new Date()).toISOString(),
  }
}
