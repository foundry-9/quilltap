/**
 * Unit tests for the shared JSON-setting reader/writer behind the typed
 * instance-setting accessors (`readJsonSetting` / `writeJsonSetting` in
 * `lib/instance-settings/index.ts`). The helpers are private, so they are
 * exercised through two of the accessors built on them: the contract is the
 * same for every JSON setting, and the setters echo what they stored.
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
import { logger } from '@/lib/logger'
import {
  getBrahmaConsoleSettings,
  getDataRetentionSettings,
  setBrahmaConsoleSettings,
  setDataRetentionSettings,
} from '@/lib/instance-settings'

const mockRawQuery = jest.mocked(rawQuery)

describe('JSON instance settings (shared reader/writer)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the defaults when the row is absent, without warning', async () => {
    mockRawQuery.mockResolvedValue([] as never)
    await expect(getDataRetentionSettings()).resolves.toEqual({ staleChatDays: 30 })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('names the setting key in the parse-failure warning', async () => {
    mockRawQuery.mockResolvedValue([{ value: '{not json' }] as never)
    await expect(getDataRetentionSettings()).resolves.toEqual({ staleChatDays: 30 })
    expect(logger.warn).toHaveBeenCalledWith(
      '[InstanceSettings] dataRetention failed to parse — using defaults',
      expect.objectContaining({ error: expect.any(String) }),
    )
  })

  it('falls back to the defaults when the stored JSON fails validation', async () => {
    mockRawQuery.mockResolvedValue([{ value: JSON.stringify({ staleChatDays: 'soon' }) }] as never)
    await expect(getDataRetentionSettings()).resolves.toEqual({ staleChatDays: 30 })
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('setters return the validated value they stored', async () => {
    mockRawQuery.mockResolvedValue([] as never)

    await expect(setDataRetentionSettings({ staleChatDays: 45 })).resolves.toEqual({
      staleChatDays: 45,
    })
    await expect(setBrahmaConsoleSettings({ maxAgentTurns: 80 })).resolves.toEqual({
      maxAgentTurns: 80,
    })

    expect(mockRawQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "instance_settings"'),
      ['dataRetention', JSON.stringify({ staleChatDays: 45 })],
    )
    expect(mockRawQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "instance_settings"'),
      ['brahmaConsole', JSON.stringify({ maxAgentTurns: 80 })],
    )
  })

  it('setters refuse an invalid value before touching the database', async () => {
    await expect(setBrahmaConsoleSettings({ maxAgentTurns: 1 })).rejects.toThrow()
    expect(mockRawQuery).not.toHaveBeenCalled()
  })

  it('round-trips through the shared writer and reader', async () => {
    const store = new Map<string, string>()
    mockRawQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('INSERT')) {
        store.set(params![0] as string, params![1] as string)
        return undefined as never
      }
      const value = store.get(params![0] as string)
      return (value === undefined ? [] : [{ value }]) as never
    })

    await setBrahmaConsoleSettings({ maxAgentTurns: 120 })
    await expect(getBrahmaConsoleSettings()).resolves.toEqual({ maxAgentTurns: 120 })
  })
})
