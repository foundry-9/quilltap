/**
 * Unit tests for the data-retention instance setting accessors
 * (`instance_settings['dataRetention']`). The daily maintenance sweep resolves
 * its stale-chat window through these, so defaulting/validation behaviour here
 * decides when a quiet chat's caches get collapsed.
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
import { getDataRetentionSettings, setDataRetentionSettings } from '@/lib/instance-settings'

const mockRawQuery = jest.mocked(rawQuery)

describe('dataRetention instance setting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getDataRetentionSettings', () => {
    it('returns the 30-day default when the setting is unset', async () => {
      mockRawQuery.mockResolvedValue([] as never)
      await expect(getDataRetentionSettings()).resolves.toEqual({ staleChatDays: 30 })
    })

    it('returns the stored value', async () => {
      mockRawQuery.mockResolvedValue([{ value: JSON.stringify({ staleChatDays: 90 }) }] as never)
      await expect(getDataRetentionSettings()).resolves.toEqual({ staleChatDays: 90 })
    })

    it('falls back to defaults on unparseable JSON', async () => {
      mockRawQuery.mockResolvedValue([{ value: 'not json' }] as never)
      await expect(getDataRetentionSettings()).resolves.toEqual({ staleChatDays: 30 })
    })

    it('falls back to defaults on out-of-range values', async () => {
      mockRawQuery.mockResolvedValue([{ value: JSON.stringify({ staleChatDays: 0 }) }] as never)
      await expect(getDataRetentionSettings()).resolves.toEqual({ staleChatDays: 30 })
    })

    it('returns defaults when the read throws', async () => {
      mockRawQuery.mockRejectedValue(new Error('db down'))
      await expect(getDataRetentionSettings()).resolves.toEqual({ staleChatDays: 30 })
    })
  })

  describe('setDataRetentionSettings', () => {
    it('round-trips: what set writes, get reads back', async () => {
      // Simulate the key/value row with a tiny in-memory store.
      const store = new Map<string, string>()
      mockRawQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.trim().startsWith('SELECT')) {
          const value = store.get((params as string[])[0])
          return (value === undefined ? [] : [{ value }]) as never
        }
        store.set((params as string[])[0], (params as string[])[1])
        return { changes: 1 } as never
      })

      await setDataRetentionSettings({ staleChatDays: 120 })
      await expect(getDataRetentionSettings()).resolves.toEqual({ staleChatDays: 120 })
    })

    it('rejects out-of-range values', async () => {
      await expect(setDataRetentionSettings({ staleChatDays: 0 })).rejects.toThrow()
      await expect(setDataRetentionSettings({ staleChatDays: 5000 })).rejects.toThrow()
      expect(mockRawQuery).not.toHaveBeenCalled()
    })
  })
})
