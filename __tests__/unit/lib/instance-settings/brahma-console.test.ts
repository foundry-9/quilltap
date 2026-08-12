/**
 * Unit tests for the Brahma Console instance setting accessors
 * (`instance_settings['brahmaConsole']`). Both the streaming orchestrator and
 * the one-shot `@Brahma` path resolve their agent-turn budget through these, so
 * defaulting/validation behaviour here decides how long a Console query may run.
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
import { getBrahmaConsoleSettings, setBrahmaConsoleSettings } from '@/lib/instance-settings'

const mockRawQuery = jest.mocked(rawQuery)

describe('brahmaConsole instance setting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getBrahmaConsoleSettings', () => {
    it('returns the 50-turn default when the setting is unset', async () => {
      mockRawQuery.mockResolvedValue([] as never)
      await expect(getBrahmaConsoleSettings()).resolves.toEqual({ maxAgentTurns: 50 })
    })

    it('returns the stored value', async () => {
      mockRawQuery.mockResolvedValue([{ value: JSON.stringify({ maxAgentTurns: 120 }) }] as never)
      await expect(getBrahmaConsoleSettings()).resolves.toEqual({ maxAgentTurns: 120 })
    })

    it('falls back to defaults on unparseable JSON', async () => {
      mockRawQuery.mockResolvedValue([{ value: 'not json' }] as never)
      await expect(getBrahmaConsoleSettings()).resolves.toEqual({ maxAgentTurns: 50 })
    })

    it('falls back to defaults on out-of-range values', async () => {
      mockRawQuery.mockResolvedValue([{ value: JSON.stringify({ maxAgentTurns: 1 }) }] as never)
      await expect(getBrahmaConsoleSettings()).resolves.toEqual({ maxAgentTurns: 50 })
    })

    it('returns defaults when the read throws', async () => {
      mockRawQuery.mockRejectedValue(new Error('db down'))
      await expect(getBrahmaConsoleSettings()).resolves.toEqual({ maxAgentTurns: 50 })
    })
  })

  describe('setBrahmaConsoleSettings', () => {
    it('round-trips: what set writes, get reads back', async () => {
      const store = new Map<string, string>()
      mockRawQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.trim().startsWith('SELECT')) {
          const value = store.get((params as string[])[0])
          return (value === undefined ? [] : [{ value }]) as never
        }
        store.set((params as string[])[0], (params as string[])[1])
        return { changes: 1 } as never
      })

      await setBrahmaConsoleSettings({ maxAgentTurns: 75 })
      await expect(getBrahmaConsoleSettings()).resolves.toEqual({ maxAgentTurns: 75 })
    })

    it('rejects out-of-range values', async () => {
      await expect(setBrahmaConsoleSettings({ maxAgentTurns: 1 })).rejects.toThrow()
      await expect(setBrahmaConsoleSettings({ maxAgentTurns: 500 })).rejects.toThrow()
      expect(mockRawQuery).not.toHaveBeenCalled()
    })
  })
})
