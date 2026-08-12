/**
 * Unit tests for `resolveBrahmaMaxAgentTurns` — the shared resolver both Brahma
 * Console paths use to read their per-query agent-turn budget. It must never
 * throw: an unreadable setting falls back to the documented default.
 */

jest.mock('@/lib/instance-settings', () => ({
  getBrahmaConsoleSettings: jest.fn(),
}))

import { getBrahmaConsoleSettings } from '@/lib/instance-settings'
import {
  resolveBrahmaMaxAgentTurns,
  DEFAULT_BRAHMA_MAX_AGENT_TURNS,
} from '@/lib/services/brahma-console/turn-budget'

const getSettings = getBrahmaConsoleSettings as jest.MockedFunction<typeof getBrahmaConsoleSettings>

describe('resolveBrahmaMaxAgentTurns', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the configured budget', async () => {
    getSettings.mockResolvedValue({ maxAgentTurns: 120 })
    await expect(resolveBrahmaMaxAgentTurns()).resolves.toBe(120)
  })

  it('falls back to the default when the setting read throws', async () => {
    getSettings.mockRejectedValue(new Error('settings db unreadable'))
    await expect(resolveBrahmaMaxAgentTurns()).resolves.toBe(DEFAULT_BRAHMA_MAX_AGENT_TURNS)
  })

  it('default matches the schema default (50)', () => {
    expect(DEFAULT_BRAHMA_MAX_AGENT_TURNS).toBe(50)
  })
})
