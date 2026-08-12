/**
 * Unit tests for the Taboo instance setting accessors
 * (`instance_settings['taboo']`). Every conversational turn reads through
 * these, and the setter's normalization decides the exact bytes that land in
 * the cacheable system-prompt prefix — so defaulting, corrupt-value fallback,
 * and normalization behaviour are all load-bearing here.
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
}))

import { rawQuery } from '@/lib/database/manager'
import {
  getTabooSettings,
  setTabooSettings,
  normalizeTabooPhrases,
} from '@/lib/instance-settings'

const mockRawQuery = jest.mocked(rawQuery)

/** Back the mocked rawQuery with a tiny in-memory key/value store. */
function useMemoryStore(): Map<string, string> {
  const store = new Map<string, string>()
  mockRawQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.trim().startsWith('SELECT')) {
      const value = store.get((params as string[])[0])
      return (value === undefined ? [] : [{ value }]) as never
    }
    store.set((params as string[])[0], (params as string[])[1])
    return { changes: 1 } as never
  })
  return store
}

describe('taboo instance setting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getTabooSettings', () => {
    it('returns an empty list when the setting is unset', async () => {
      mockRawQuery.mockResolvedValue([] as never)
      await expect(getTabooSettings()).resolves.toEqual({ phrases: [] })
    })

    it('returns the stored list in stored order', async () => {
      mockRawQuery.mockResolvedValue([
        { value: JSON.stringify({ phrases: ['weight-bearing', "that's not nothing"] }) },
      ] as never)
      await expect(getTabooSettings()).resolves.toEqual({
        phrases: ['weight-bearing', "that's not nothing"],
      })
    })

    it('falls back to an empty list on unparseable JSON', async () => {
      mockRawQuery.mockResolvedValue([{ value: 'not json' }] as never)
      await expect(getTabooSettings()).resolves.toEqual({ phrases: [] })
    })

    it('falls back to an empty list when the stored shape is wrong', async () => {
      mockRawQuery.mockResolvedValue([{ value: JSON.stringify({ phrases: 'nope' }) }] as never)
      await expect(getTabooSettings()).resolves.toEqual({ phrases: [] })
    })

    it('falls back to an empty list when a stored phrase is out of range', async () => {
      mockRawQuery.mockResolvedValue([
        { value: JSON.stringify({ phrases: ['x'.repeat(201)] }) },
      ] as never)
      await expect(getTabooSettings()).resolves.toEqual({ phrases: [] })
    })

    it('returns an empty list when the read throws', async () => {
      mockRawQuery.mockRejectedValue(new Error('db down'))
      await expect(getTabooSettings()).resolves.toEqual({ phrases: [] })
    })
  })

  describe('normalizeTabooPhrases', () => {
    it('trims each entry', () => {
      expect(normalizeTabooPhrases(['  weight-bearing  '])).toEqual(['weight-bearing'])
    })

    it('drops entries that trim away to nothing', () => {
      expect(normalizeTabooPhrases(['', '   ', '\t\n', 'kept'])).toEqual(['kept'])
    })

    it('drops case-insensitive duplicates, keeping the first occurrence', () => {
      expect(normalizeTabooPhrases(['Weight-Bearing', 'weight-bearing', 'WEIGHT-BEARING'])).toEqual([
        'Weight-Bearing',
      ])
    })

    it('treats a duplicate that differs only by surrounding whitespace as a duplicate', () => {
      expect(normalizeTabooPhrases(['tapestry', '  tapestry  '])).toEqual(['tapestry'])
    })

    it('preserves user order rather than sorting', () => {
      expect(normalizeTabooPhrases(['zeta', 'alpha', 'mu'])).toEqual(['zeta', 'alpha', 'mu'])
    })

    it('returns an empty list for an empty input', () => {
      expect(normalizeTabooPhrases([])).toEqual([])
    })
  })

  describe('setTabooSettings', () => {
    it('round-trips: what set writes, get reads back', async () => {
      useMemoryStore()

      await setTabooSettings({ phrases: ["that's not nothing", 'weight-bearing'] })
      await expect(getTabooSettings()).resolves.toEqual({
        phrases: ["that's not nothing", 'weight-bearing'],
      })
    })

    it('normalizes on write and returns exactly what was stored', async () => {
      useMemoryStore()

      const saved = await setTabooSettings({
        phrases: ['  weight-bearing ', '', 'WEIGHT-BEARING', "that's not nothing"],
      })

      expect(saved).toEqual({ phrases: ['weight-bearing', "that's not nothing"] })
      await expect(getTabooSettings()).resolves.toEqual(saved)
    })

    it('stores an empty list without complaint', async () => {
      useMemoryStore()

      await expect(setTabooSettings({ phrases: [] })).resolves.toEqual({ phrases: [] })
      await expect(getTabooSettings()).resolves.toEqual({ phrases: [] })
    })

    it('rejects a phrase longer than 200 characters without writing', async () => {
      await expect(setTabooSettings({ phrases: ['x'.repeat(201)] })).rejects.toThrow()
      expect(mockRawQuery).not.toHaveBeenCalled()
    })

    it('rejects more than 500 phrases without writing', async () => {
      const tooMany = Array.from({ length: 501 }, (_, i) => `phrase ${i}`)
      await expect(setTabooSettings({ phrases: tooMany })).rejects.toThrow()
      expect(mockRawQuery).not.toHaveBeenCalled()
    })

    it('accepts exactly 500 phrases and a 200-character phrase', async () => {
      useMemoryStore()
      const maxLength = 'x'.repeat(200)
      const atCap = [maxLength, ...Array.from({ length: 499 }, (_, i) => `phrase ${i}`)]

      const saved = await setTabooSettings({ phrases: atCap })

      expect(saved.phrases).toHaveLength(500)
      expect(saved.phrases[0]).toBe(maxLength)
    })
  })
})
