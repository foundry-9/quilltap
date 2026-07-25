/**
 * Unit tests for timestamp-utils.ts
 * Tests timestamp calculation, formatting, and injection logic
 */

import {
  calculateCurrentTimestamp,
  shouldInjectTimestamp,
  formatTimestampForSystemPrompt,
  ensureFictionalBaseRealTime,
  parseTimestampInTimezone,
  resolveTimezone,
} from '@/lib/chat/timestamp-utils'
import type { TimestampConfig } from '@/lib/schemas/types'

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('timestamp-utils', () => {
  describe('calculateCurrentTimestamp', () => {
    it('should return current time in FRIENDLY format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'FRIENDLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      expect(result.isFictional).toBe(false)
      expect(result.isoValue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      // FRIENDLY format should contain "at" and AM/PM
      expect(result.formatted).toMatch(/at \d{1,2}:\d{2} [AP]M/)
    })

    it('should return current time in ISO8601 format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'ISO8601',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      expect(result.formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('should return date only in DATE_ONLY format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'DATE_ONLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      // Should contain month name and year, but not "at" or time
      expect(result.formatted).toMatch(/\w+ \d{1,2}, \d{4}/)
      expect(result.formatted).not.toContain('at')
      expect(result.formatted).not.toMatch(/\d{1,2}:\d{2}/)
    })

    it('should return time only in TIME_ONLY format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'TIME_ONLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      // Should contain time with AM/PM but no date
      expect(result.formatted).toMatch(/^\d{1,2}:\d{2} [AP]M$/)
    })

    it('should use custom format when specified', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: 'YYYY-MM-DD',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      expect(result.formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('should calculate fictional time with elapsed real time offset', () => {
      // Set up a fictional base time and a real base time
      const fictionalBase = '1776-07-04T16:30:00.000Z'
      const realBase = new Date(Date.now() - 120000).toISOString() // 2 minutes ago

      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'ISO8601',
        useFictionalTime: true,
        fictionalBaseTimestamp: fictionalBase,
        fictionalBaseRealTime: realBase,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      expect(result.isFictional).toBe(true)

      // The fictional time should be approximately 2 minutes after the fictional base
      const resultDate = new Date(result.isoValue)
      const expectedApprox = new Date('1776-07-04T16:32:00.000Z')

      // Allow for 10 second tolerance in test execution
      const diff = Math.abs(resultDate.getTime() - expectedApprox.getTime())
      expect(diff).toBeLessThan(10000)
    })

    it('should fallback to FRIENDLY when CUSTOM format has no customFormat', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: null,
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      // Should use FRIENDLY format as fallback
      expect(result.formatted).toMatch(/at \d{1,2}:\d{2} [AP]M/)
    })
  })

  describe('shouldInjectTimestamp', () => {
    it('should return false when mode is NONE', () => {
      const config: TimestampConfig = {
        mode: 'NONE',
        format: 'FRIENDLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      expect(shouldInjectTimestamp(config, true)).toBe(false)
      expect(shouldInjectTimestamp(config, false)).toBe(false)
    })

    it('should return true only for initial message when mode is START_ONLY', () => {
      const config: TimestampConfig = {
        mode: 'START_ONLY',
        format: 'FRIENDLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      expect(shouldInjectTimestamp(config, true)).toBe(true)
      expect(shouldInjectTimestamp(config, false)).toBe(false)
    })

    it('should return true for all messages when mode is EVERY_MESSAGE', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'FRIENDLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      expect(shouldInjectTimestamp(config, true)).toBe(true)
      expect(shouldInjectTimestamp(config, false)).toBe(true)
    })

    it('should return false when config is null or undefined', () => {
      expect(shouldInjectTimestamp(null, true)).toBe(false)
      expect(shouldInjectTimestamp(undefined, false)).toBe(false)
    })

    describe('EVERY_N_MINUTES mode', () => {
      const buildConfig = (intervalMinutes: number = 15): TimestampConfig => ({
        mode: 'EVERY_N_MINUTES',
        format: 'FRIENDLY',
        useFictionalTime: false,
        autoPrepend: true,
        intervalMinutes,
      })

      it('should always fire on the initial message regardless of interval', () => {
        expect(shouldInjectTimestamp(buildConfig(15), true, 0)).toBe(true)
        expect(shouldInjectTimestamp(buildConfig(15), true, 2)).toBe(true)
      })

      it('should fire when no prior announcement exists (null or undefined)', () => {
        expect(shouldInjectTimestamp(buildConfig(15), false, null)).toBe(true)
        expect(shouldInjectTimestamp(buildConfig(15), false, undefined)).toBe(true)
      })

      it('should suppress when fewer minutes than the configured interval have elapsed', () => {
        expect(shouldInjectTimestamp(buildConfig(15), false, 0)).toBe(false)
        expect(shouldInjectTimestamp(buildConfig(15), false, 14.9)).toBe(false)
      })

      it('should fire when elapsed minutes meet or exceed the configured interval', () => {
        expect(shouldInjectTimestamp(buildConfig(15), false, 15)).toBe(true)
        expect(shouldInjectTimestamp(buildConfig(15), false, 42)).toBe(true)
      })

      it('should fall back to a 15-minute default when intervalMinutes is missing', () => {
        const config = { ...buildConfig(15) } as TimestampConfig
        delete (config as { intervalMinutes?: number }).intervalMinutes
        expect(shouldInjectTimestamp(config, false, 14)).toBe(false)
        expect(shouldInjectTimestamp(config, false, 15)).toBe(true)
      })

      it('should honour a custom interval', () => {
        expect(shouldInjectTimestamp(buildConfig(5), false, 4)).toBe(false)
        expect(shouldInjectTimestamp(buildConfig(5), false, 5)).toBe(true)
        expect(shouldInjectTimestamp(buildConfig(60), false, 30)).toBe(false)
        expect(shouldInjectTimestamp(buildConfig(60), false, 75)).toBe(true)
      })
    })
  })

  describe('formatTimestampForSystemPrompt', () => {
    it('should format with "Current time:" prefix when autoPrepend is true', () => {
      const timestamp = {
        formatted: 'March 15, 2024 at 2:30 PM',
        isoValue: '2024-03-15T14:30:00.000Z',
        isFictional: false,
      }

      const result = formatTimestampForSystemPrompt(timestamp, true)

      expect(result).toBe('Current time: March 15, 2024 at 2:30 PM')
    })

    it('should return just the formatted timestamp when autoPrepend is false', () => {
      const timestamp = {
        formatted: 'March 15, 2024 at 2:30 PM',
        isoValue: '2024-03-15T14:30:00.000Z',
        isFictional: false,
      }

      const result = formatTimestampForSystemPrompt(timestamp, false)

      expect(result).toBe('March 15, 2024 at 2:30 PM')
    })
  })

  describe('ensureFictionalBaseRealTime', () => {
    const fictionalConfig = (
      overrides: Partial<TimestampConfig> = {}
    ): TimestampConfig => ({
      mode: 'EVERY_MESSAGE',
      format: 'FRIENDLY',
      useFictionalTime: true,
      fictionalBaseTimestamp: '1776-07-04T16:30',
      autoPrepend: true,
      ...overrides,
    })

    it('should stamp the anchor when a fictional clock has none', () => {
      const before = Date.now()
      const result = ensureFictionalBaseRealTime(fictionalConfig())
      const after = Date.now()

      expect(result.fictionalBaseRealTime).toBeDefined()

      const realTime = new Date(result.fictionalBaseRealTime!).getTime()
      expect(realTime).toBeGreaterThanOrEqual(before)
      expect(realTime).toBeLessThanOrEqual(after)

      // Everything else rides through untouched
      expect(result.mode).toBe('EVERY_MESSAGE')
      expect(result.format).toBe('FRIENDLY')
      expect(result.fictionalBaseTimestamp).toBe('1776-07-04T16:30')
      expect(result.autoPrepend).toBe(true)
    })

    it('should accept an explicit anchor for retro-fitting an existing chat', () => {
      const anchor = new Date('2026-01-02T03:04:05.000Z')

      const result = ensureFictionalBaseRealTime(fictionalConfig(), anchor)

      expect(result.fictionalBaseRealTime).toBe('2026-01-02T03:04:05.000Z')
    })

    it('should never re-stamp an anchored clock — that would reset it to the base', () => {
      const existing = '2020-05-05T05:05:05.000Z'

      const result = ensureFictionalBaseRealTime(
        fictionalConfig({ fictionalBaseRealTime: existing })
      )

      expect(result.fictionalBaseRealTime).toBe(existing)
    })

    it('should leave real-time and baseless configs alone', () => {
      expect(
        ensureFictionalBaseRealTime(fictionalConfig({ useFictionalTime: false }))
          .fictionalBaseRealTime
      ).toBeUndefined()

      expect(
        ensureFictionalBaseRealTime(
          fictionalConfig({ fictionalBaseTimestamp: null })
        ).fictionalBaseRealTime
      ).toBeUndefined()
    })

    it('should pass null and undefined straight through', () => {
      expect(ensureFictionalBaseRealTime(null)).toBeNull()
      expect(ensureFictionalBaseRealTime(undefined)).toBeUndefined()
    })
  })

  describe('parseTimestampInTimezone', () => {
    it('should read a zone-less base as a clock in the story timezone', () => {
      // The bug: parsed against the server's zone, "10:15" in Istanbul surfaced as 6:01 PM
      // on an America/Chicago host, the two 1550 LMT offsets differing by ~7h46m.
      const parsed = parseTimestampInTimezone('1550-07-25T10:15', 'Europe/Istanbul')

      const rendered = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Europe/Istanbul',
      }).format(parsed)

      expect(rendered).toBe('10:15 AM')
    })

    it('should round-trip modern wall-clock times across zones', () => {
      for (const timezone of ['Europe/Istanbul', 'America/New_York', 'Asia/Kolkata', 'UTC']) {
        const parsed = parseTimestampInTimezone('2026-07-25T10:15', timezone)

        const rendered = new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: timezone,
        }).format(parsed)

        expect(rendered).toBe('10:15 AM')
      }
    })

    it('should leave absolute timestamps untouched', () => {
      const withZ = parseTimestampInTimezone('1776-07-04T16:30:00.000Z', 'Europe/Istanbul')
      expect(withZ.toISOString()).toBe('1776-07-04T16:30:00.000Z')

      const withOffset = parseTimestampInTimezone('2026-01-15T12:00:00+05:00', 'America/Chicago')
      expect(withOffset.toISOString()).toBe('2026-01-15T07:00:00.000Z')
    })

    it('should fall back to system-local parsing with no timezone', () => {
      const parsed = parseTimestampInTimezone('2026-07-25T10:15', undefined)

      expect(parsed.getHours()).toBe(10)
      expect(parsed.getMinutes()).toBe(15)
    })
  })

  describe('fictional clock advancement', () => {
    it('should advance 1:1 with real time from the anchor', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'ISO8601',
        useFictionalTime: true,
        fictionalBaseTimestamp: '1550-07-25T10:15',
        // 45 minutes and a half, so the reading lands mid-minute and cannot round across a
        // boundary while the test runs
        fictionalBaseRealTime: new Date(Date.now() - 45 * 60_000 - 30_000).toISOString(),
        timezone: 'Europe/Istanbul',
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config, 'Europe/Istanbul')

      expect(result.isFictional).toBe(true)
      // 45 real minutes elapsed since the anchor, so the story clock reads 11:00 AM.
      // Asserted on `formatted` rather than `isoValue`: the latter truncates the UTC offset to
      // whole minutes, which is lossy against Istanbul's 1550 LMT offset of +01:55:52.
      expect(result.formatted).toMatch(/11:00:\d{2}/)
    })

    it('should not report the same instant on successive turns', () => {
      // The original bug: with no anchor the elapsed offset was always ~0, so every turn
      // re-reported the base and the Host announced the same moment forever.
      const anchored = ensureFictionalBaseRealTime({
        mode: 'EVERY_N_MINUTES',
        format: 'ISO8601',
        useFictionalTime: true,
        fictionalBaseTimestamp: '1550-07-25T10:15',
        timezone: 'Europe/Istanbul',
        autoPrepend: true,
        intervalMinutes: 15,
      })

      const firstTurn = calculateCurrentTimestamp(anchored, 'Europe/Istanbul')

      // Rewind the anchor by an hour to stand in for an hour of real conversation
      const later = calculateCurrentTimestamp(
        {
          ...anchored,
          fictionalBaseRealTime: new Date(
            new Date(anchored.fictionalBaseRealTime!).getTime() - 3_600_000
          ).toISOString(),
        },
        'Europe/Istanbul'
      )

      const elapsed =
        new Date(later.isoValue).getTime() - new Date(firstTurn.isoValue).getTime()

      expect(elapsed).toBeGreaterThan(59 * 60_000)
      expect(elapsed).toBeLessThan(61 * 60_000)
    })
  })

  describe('custom format parsing', () => {
    it('should handle YYYY/MM/DD format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: 'YYYY/MM/DD',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)
      expect(result.formatted).toMatch(/^\d{4}\/\d{2}\/\d{2}$/)
    })

    it('should handle 12-hour time format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: 'h:mm a',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)
      expect(result.formatted).toMatch(/^\d{1,2}:\d{2} [ap]m$/)
    })

    it('should handle 24-hour time format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: 'HH:mm:ss',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)
      expect(result.formatted).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    })

    it('should handle full month and day names', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: 'dddd, MMMM D, YYYY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)
      // Should contain a full day name, full month name, day number, and year
      expect(result.formatted).toMatch(/^\w+, \w+ \d{1,2}, \d{4}$/)
    })
  })

  describe('resolveTimezone', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
      delete process.env.QUILLTAP_TIMEZONE
    })

    afterAll(() => {
      process.env = originalEnv
    })

    it('should return per-chat timezone when set', () => {
      process.env.QUILLTAP_TIMEZONE = 'UTC'
      expect(resolveTimezone('America/New_York', 'Europe/London')).toBe('America/New_York')
    })

    it('should fall back to chatSettings timezone when per-chat is null', () => {
      process.env.QUILLTAP_TIMEZONE = 'UTC'
      expect(resolveTimezone(null, 'Europe/London')).toBe('Europe/London')
    })

    it('should fall back to QUILLTAP_TIMEZONE env var when both are null', () => {
      process.env.QUILLTAP_TIMEZONE = 'Asia/Tokyo'
      expect(resolveTimezone(null, null)).toBe('Asia/Tokyo')
    })

    it('should return undefined when all sources are empty', () => {
      expect(resolveTimezone(null, null)).toBeUndefined()
    })

    it('should skip empty strings', () => {
      expect(resolveTimezone('', '')).toBeUndefined()
    })
  })

  describe('timezone-aware formatting', () => {
    it('should format FRIENDLY with explicit timezone', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'FRIENDLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      // Use a fixed date: 2026-02-22T12:00:00Z (noon UTC)
      const originalDateNow = Date.now
      Date.now = () => new Date('2026-02-22T12:00:00Z').getTime()

      try {
        const resultNY = calculateCurrentTimestamp(config, 'America/New_York')
        // 12:00 UTC = 7:00 AM EST
        expect(resultNY.formatted).toContain('7:00 AM')

        const resultTokyo = calculateCurrentTimestamp(config, 'Asia/Tokyo')
        // 12:00 UTC = 9:00 PM JST
        expect(resultTokyo.formatted).toContain('9:00 PM')
      } finally {
        Date.now = originalDateNow
      }
    })

    it('should format ISO8601 with timezone offset', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'ISO8601',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const originalDateNow = Date.now
      Date.now = () => new Date('2026-02-22T12:00:00Z').getTime()

      try {
        const resultNY = calculateCurrentTimestamp(config, 'America/New_York')
        // Should contain an offset like -05:00
        expect(resultNY.formatted).toMatch(/2026-02-22T07:00:00-05:00/)
        // isoValue should also have offset
        expect(resultNY.isoValue).toMatch(/-05:00$/)

        const resultUTC = calculateCurrentTimestamp(config, 'UTC')
        expect(resultUTC.formatted).toMatch(/2026-02-22T12:00:00\+00:00/)
      } finally {
        Date.now = originalDateNow
      }
    })

    it('should format DATE_ONLY with explicit timezone', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'DATE_ONLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      // Use a time that crosses the date boundary:
      // 2026-02-22T23:30:00Z = Feb 22 in UTC, but Feb 23 in Tokyo (JST = UTC+9)
      const originalDateNow = Date.now
      Date.now = () => new Date('2026-02-22T23:30:00Z').getTime()

      try {
        const resultUTC = calculateCurrentTimestamp(config, 'UTC')
        expect(resultUTC.formatted).toContain('February 22')

        const resultTokyo = calculateCurrentTimestamp(config, 'Asia/Tokyo')
        expect(resultTokyo.formatted).toContain('February 23')
      } finally {
        Date.now = originalDateNow
      }
    })

    it('should format TIME_ONLY with explicit timezone', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'TIME_ONLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const originalDateNow = Date.now
      Date.now = () => new Date('2026-02-22T12:00:00Z').getTime()

      try {
        const resultNY = calculateCurrentTimestamp(config, 'America/New_York')
        expect(resultNY.formatted).toMatch(/7:00 AM/)

        const resultTokyo = calculateCurrentTimestamp(config, 'Asia/Tokyo')
        expect(resultTokyo.formatted).toMatch(/9:00 PM/)
      } finally {
        Date.now = originalDateNow
      }
    })

    it('should format CUSTOM with explicit timezone', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: 'YYYY-MM-DD HH:mm',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const originalDateNow = Date.now
      Date.now = () => new Date('2026-02-22T12:00:00Z').getTime()

      try {
        const resultNY = calculateCurrentTimestamp(config, 'America/New_York')
        expect(resultNY.formatted).toBe('2026-02-22 07:00')

        const resultTokyo = calculateCurrentTimestamp(config, 'Asia/Tokyo')
        expect(resultTokyo.formatted).toBe('2026-02-22 21:00')
      } finally {
        Date.now = originalDateNow
      }
    })

    it('should preserve existing behavior when no timezone is specified', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'ISO8601',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      // Without timezone, isoValue should end with Z (UTC)
      expect(result.isoValue).toMatch(/Z$/)
      // formatted should also be ISO format ending with Z
      expect(result.formatted).toMatch(/Z$/)
    })
  })
})
