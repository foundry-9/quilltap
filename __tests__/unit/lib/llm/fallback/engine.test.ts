/**
 * Fallback engine — trigger classification and chain building.
 */

import { describe, it, expect, beforeEach } from '@jest/globals'

// `jest` is the global here on purpose: importing it from '@jest/globals'
// stops `jest.mock` being hoisted above the imports, and the subject would
// close over the real image-transport module. Same reason the subject arrives
// by `require` below rather than by a static import.
jest.mock('@/lib/llm/image-transport', () => ({
  providerCanTransportImages: () => mockCanTransportImages(),
  // The chain asks the shared predicate, which is both halves of bug 91's
  // question at once — the operator's `supportsImageUpload` tick and whether
  // the plugin can put bytes on the wire. Mirrored here so a test can move
  // either half independently.
  profileCanReceiveAttachment: (profile: { supportsImageUpload?: boolean | null }) =>
    profile.supportsImageUpload === true && mockCanTransportImages(),
}))

const mockCanTransportImages = jest.fn<() => boolean>(() => true)

import {
  APIKeyError,
  ContentLimitError,
  LLMProviderError,
  ModelNotFoundError,
  NetworkError,
  RateLimitError,
  TokenLimitError,
} from '@/lib/llm/errors'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type { FallbackContext } from '@/lib/llm/fallback'

const {
  buildFallbackChain,
  classifyFallbackTrigger,
  summarizeFallbackAttempts,
  recordAttempt,
} = require('@/lib/llm/fallback') as typeof import('@/lib/llm/fallback')

function makeProfile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: 'p-primary',
    userId: 'u1',
    name: 'Primary',
    provider: 'ANTHROPIC',
    transport: 'api',
    courierDeltaMode: true,
    apiKeyId: 'k1',
    baseUrl: null,
    modelName: 'claude-sonnet',
    parameters: {},
    isDefault: false,
    isCheap: false,
    allowWebSearch: false,
    useNativeWebSearch: false,
    allowToolUse: true,
    pseudoToolMode: 'auto',
    multiCharacterPrefill: null,
    fallbackProfileId: null,
    allowTierFallback: false,
    modelClass: 'Extended',
    maxContext: null,
    maxTokens: null,
    isDangerousCompatible: false,
    supportsImageUpload: false,
    tags: [],
    sortIndex: 0,
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    messageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ConnectionProfile
}

function makeContext(overrides: Partial<FallbackContext> = {}): FallbackContext {
  return {
    userId: 'u1',
    purpose: 'chat',
    dangerous: false,
    needsVision: false,
    needsTools: false,
    alreadyTried: [],
    ...overrides,
  }
}

function makeRepos(profiles: ConnectionProfile[]) {
  return {
    connections: {
      findById: async (id: string) => profiles.find((p) => p.id === id) ?? null,
      findByUserId: async (userId: string) => profiles.filter((p) => p.userId === userId),
    },
  }
}

describe('classifyFallbackTrigger', () => {
  it('maps the typed provider errors onto their trigger classes', () => {
    expect(classifyFallbackTrigger(new APIKeyError('OPENAI'))).toBe('auth')
    expect(classifyFallbackTrigger(new RateLimitError('OPENAI'))).toBe('rate-limit')
    expect(classifyFallbackTrigger(new NetworkError('OPENAI'))).toBe('network')
    expect(classifyFallbackTrigger(new ModelNotFoundError('OPENAI', 'gpt-9'))).toBe('model-missing')
  })

  it('treats a bare 5xx from a plugin as a provider error', () => {
    expect(classifyFallbackTrigger(new Error('503 Service Unavailable'))).toBe('provider-error')
    expect(classifyFallbackTrigger(new Error('upstream is overloaded'))).toBe('provider-error')
  })

  it('classifies an untyped LLMProviderError as a provider error', () => {
    expect(classifyFallbackTrigger(new LLMProviderError('GROK', 'something went wrong')))
      .toBe('provider-error')
  })

  it('recognises the cheap path\'s own deadline as a network failure', () => {
    const timeout = new Error('Cheap LLM task exceeded its 45000ms budget')
    timeout.name = 'CheapLLMTimeoutError'
    expect(classifyFallbackTrigger(timeout)).toBe('network')
  })

  describe('non-triggers', () => {
    it('refuses token and content limits — they fail identically anywhere', () => {
      expect(classifyFallbackTrigger(new TokenLimitError('ANTHROPIC', 210311, 200000))).toBeNull()
      expect(classifyFallbackTrigger(new ContentLimitError('ANTHROPIC', 'pdf_pages'))).toBeNull()
      expect(classifyFallbackTrigger(new Error('prompt is too long'))).toBeNull()
    })

    it('refuses a tool-unsupported rejection — already retried with tools stripped', () => {
      expect(classifyFallbackTrigger(new Error('Function calling is not supported'))).toBeNull()
    })

    it('refuses a Zod validation error — our bug, not the provider\'s', () => {
      const zodError = new Error('Invalid input')
      zodError.name = 'ZodError'
      expect(classifyFallbackTrigger(zodError)).toBeNull()
    })

    it('refuses an unattributed 4xx — a malformed request stays malformed', () => {
      expect(classifyFallbackTrigger(new Error('400 Bad Request: unknown field'))).toBeNull()
    })
  })
})

describe('buildFallbackChain', () => {
  let primary: ConnectionProfile
  let understudy: ConnectionProfile

  beforeEach(() => {
    jest.clearAllMocks()
    mockCanTransportImages.mockReturnValue(true)
    understudy = makeProfile({ id: 'p-understudy', name: 'Understudy', provider: 'OPENAI' })
    primary = makeProfile({ fallbackProfileId: 'p-understudy' })
  })

  it('leads with the primary and follows with its configured understudy', async () => {
    const chain = await buildFallbackChain(primary, makeRepos([primary, understudy]), makeContext())

    expect(chain.map((c) => [c.profile.id, c.kind])).toEqual([
      ['p-primary', 'primary'],
      ['p-understudy', 'configured'],
    ])
  })

  it('does not recurse: B\'s own understudy is never followed', async () => {
    // A -> B, B -> C. C must not appear.
    const third = makeProfile({ id: 'p-third', name: 'Third' })
    understudy.fallbackProfileId = 'p-third'

    const chain = await buildFallbackChain(
      primary,
      makeRepos([primary, understudy, third]),
      makeContext()
    )

    expect(chain.map((c) => c.profile.id)).toEqual(['p-primary', 'p-understudy'])
  })

  it('makes an A->B, B->A cycle harmless', async () => {
    understudy.fallbackProfileId = 'p-primary'

    const chain = await buildFallbackChain(
      primary,
      makeRepos([primary, understudy]),
      makeContext()
    )

    expect(chain.map((c) => c.profile.id)).toEqual(['p-primary', 'p-understudy'])
  })

  it('ignores a self-reference', async () => {
    primary.fallbackProfileId = 'p-primary'

    const chain = await buildFallbackChain(primary, makeRepos([primary]), makeContext())

    expect(chain.map((c) => c.profile.id)).toEqual(['p-primary'])
  })

  it('drops an understudy that has since been deleted', async () => {
    const chain = await buildFallbackChain(primary, makeRepos([primary]), makeContext())

    expect(chain.map((c) => c.profile.id)).toEqual(['p-primary'])
  })

  it('drops an understudy that has since become a Courier profile', async () => {
    understudy.transport = 'courier'

    const chain = await buildFallbackChain(
      primary,
      makeRepos([primary, understudy]),
      makeContext()
    )

    expect(chain.map((c) => c.profile.id)).toEqual(['p-primary'])
  })

  it('skips a named understudy that cannot receive this turn\'s images', async () => {
    // A chain swaps the model but reuses the message array built for the
    // primary — with the raw bytes already embedded. A text-only stand-in is a
    // guaranteed 400 (bug 106), so it is not worth the attempt.
    understudy.supportsImageUpload = false
    primary.supportsImageUpload = true

    const chain = await buildFallbackChain(
      primary,
      makeRepos([primary, understudy]),
      makeContext({ needsVision: true })
    )

    expect(chain.map((c) => c.profile.id)).toEqual(['p-primary'])
  })

  it('keeps a named understudy that can receive images', async () => {
    understudy.supportsImageUpload = true
    primary.supportsImageUpload = true

    const chain = await buildFallbackChain(
      primary,
      makeRepos([primary, understudy]),
      makeContext({ needsVision: true })
    )

    expect(chain.map((c) => c.profile.id)).toEqual(['p-primary', 'p-understudy'])
  })

  it('skips a named understudy whose plugin cannot put images on the wire', async () => {
    understudy.supportsImageUpload = true
    mockCanTransportImages.mockReturnValue(false)

    const chain = await buildFallbackChain(
      primary,
      makeRepos([primary, understudy]),
      makeContext({ needsVision: true })
    )

    expect(chain.map((c) => c.profile.id)).toEqual(['p-primary'])
  })

  it('honours a named understudy on a text-only turn regardless of vision', async () => {
    understudy.supportsImageUpload = false

    const chain = await buildFallbackChain(
      primary,
      makeRepos([primary, understudy]),
      makeContext({ needsVision: false })
    )

    expect(chain.map((c) => c.profile.id)).toEqual(['p-primary', 'p-understudy'])
  })

  it('honours a named understudy that is not dangerous-compatible — the user chose it', async () => {
    // Unlike vision, danger-compatibility is a policy preference, not an
    // incompatibility. An auto-picked stand-in is filtered on it; one the user
    // named themselves is theirs to make.
    understudy.isDangerousCompatible = false

    const chain = await buildFallbackChain(
      primary,
      makeRepos([primary, understudy]),
      makeContext({ dangerous: true })
    )

    expect(chain.map((c) => c.profile.id)).toEqual(['p-primary', 'p-understudy'])
  })

  it('skips a candidate already tried on this call', async () => {
    const chain = await buildFallbackChain(
      primary,
      makeRepos([primary, understudy]),
      makeContext({ alreadyTried: ['p-understudy'] })
    )

    expect(chain.map((c) => c.profile.id)).toEqual(['p-primary'])
  })

  it('offers no tier pick unless the profile opts in', async () => {
    const spare = makeProfile({ id: 'p-spare', name: 'Spare', provider: 'GOOGLE' })
    primary.fallbackProfileId = null

    const chain = await buildFallbackChain(primary, makeRepos([primary, spare]), makeContext())

    expect(chain.map((c) => c.profile.id)).toEqual(['p-primary'])
  })

  it('adds exactly one tier pick when the profile opts in', async () => {
    const spareA = makeProfile({ id: 'p-a', name: 'Spare A', provider: 'GOOGLE' })
    const spareB = makeProfile({ id: 'p-b', name: 'Spare B', provider: 'GROK' })
    primary.allowTierFallback = true

    const chain = await buildFallbackChain(
      primary,
      makeRepos([primary, understudy, spareA, spareB]),
      makeContext()
    )

    expect(chain).toHaveLength(3)
    expect(chain[2].kind).toBe('tier-pick')
  })

  it('never offers the same profile twice across understudy and tier pick', async () => {
    primary.allowTierFallback = true

    const chain = await buildFallbackChain(
      primary,
      makeRepos([primary, understudy]),
      makeContext()
    )

    const ids = chain.map((c) => c.profile.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('summarizeFallbackAttempts', () => {
  it('names each profile and how it failed', () => {
    const attempts = [
      recordAttempt(makeProfile({ name: 'Claude Sonnet' }), 'rate-limit', new Error('429')),
      recordAttempt(makeProfile({ name: 'Kimi' }), 'network', new Error('ECONNRESET')),
    ]

    expect(summarizeFallbackAttempts(attempts, true)).toBe(
      'Claude Sonnet failed (rate-limit), Kimi failed (network)'
    )
  })

  it('says so when no tier replacement qualified', () => {
    const attempts = [
      recordAttempt(makeProfile({ name: 'Claude Sonnet' }), 'rate-limit', new Error('429')),
      recordAttempt(makeProfile({ name: 'Kimi' }), 'network', new Error('ECONNRESET')),
    ]

    expect(summarizeFallbackAttempts(attempts, false)).toBe(
      'Claude Sonnet failed (rate-limit), Kimi failed (network); no tier replacement qualified'
    )
  })

  it('is empty when nothing was attempted', () => {
    expect(summarizeFallbackAttempts([], false)).toBe('')
  })
})
