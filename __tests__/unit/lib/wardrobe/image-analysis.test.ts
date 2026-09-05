/**
 * Tests for the wardrobe-from-image vision prompt and its response parser.
 *
 * The parser is private, so it's driven end-to-end through
 * `analyzeImageForWardrobeItems` with the LLM provider mocked out — no
 * network, no vision model.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

const mockSendMessage = jest.fn()
jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn(async () => ({
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  })),
}))

jest.mock('@/lib/llm/connection-profile-utils', () => ({
  profileSupportsMimeType: jest.fn(() => true),
}))

jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: jest.fn(() => Promise.resolve()),
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  profileParams: jest.fn(() => ({})),
}))

const { analyzeImageForWardrobeItems } = require('@/lib/wardrobe/image-analysis') as {
  analyzeImageForWardrobeItems: typeof import('@/lib/wardrobe/image-analysis').analyzeImageForWardrobeItems
}

const PROFILE = {
  id: 'p1',
  provider: 'ANTHROPIC',
  modelName: 'claude-opus-5',
  apiKeyId: 'k1',
  baseUrl: null,
  isDefault: true,
}

const repos = {
  chatSettings: {
    findByUserId: jest.fn(async () => null),
  },
  connections: {
    findAll: jest.fn(async () => [PROFILE]),
    findApiKeyByIdAndUserId: jest.fn(async () => ({ key_value: 'sk-test' })),
  },
} as never

/** Run the real parser over a canned model answer. */
async function analyze(items: unknown): Promise<{ types: string[]; title: string }[]> {
  mockSendMessage.mockResolvedValue({ content: JSON.stringify({ items }) })
  const result = await analyzeImageForWardrobeItems(
    { image: 'AAAA', mimeType: 'image/png' },
    repos,
    'user-1',
  )
  return result.proposedItems as { types: string[]; title: string }[]
}

describe('wardrobe image analysis — the hair slot', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps an item the model typed as "hair"', async () => {
    const items = await analyze([
      { title: 'Coiled Chignon', description: 'Low twisted knot, jet pins', types: ['hair'] },
    ])
    expect(items).toHaveLength(1)
    expect(items[0].types).toEqual(['hair'])
  })

  it('still defaults a genuinely unknown type to accessories', async () => {
    const items = await analyze([
      { title: 'Mystery Thing', description: 'Unclear', types: ['cloak'] },
    ])
    expect(items[0].types).toEqual(['accessories'])
  })

  it('sends a system prompt that names hair as a slot and rules out unstyled hair', async () => {
    await analyze([])
    const [request] = mockSendMessage.mock.calls[0] as [{ messages: { role: string; content: string }[] }]
    const system = request.messages.find((m) => m.role === 'system')!.content
    expect(system).toContain('"hair"')
    expect(system).toContain('Plain, loose, unstyled hair is NOT an item.')
    expect(system).toContain('- Valid types are ONLY: "top", "bottom", "footwear", "accessories", "hair"')
  })

  it('asks the user prompt for a deliberate hairstyle', async () => {
    await analyze([])
    const [request] = mockSendMessage.mock.calls[0] as [{ messages: { role: string; content: string }[] }]
    const user = request.messages.find((m) => m.role === 'user')!.content
    expect(user).toContain('deliberate hairstyle')
  })
})
