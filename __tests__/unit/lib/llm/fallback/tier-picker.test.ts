/**
 * Fallback engine — the tier picker's filters and ranking.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/llm/image-transport', () => ({
  providerCanTransportImages: (provider: string) => mockCanTransportImages(provider),
}))

const mockCanTransportImages = jest.fn<(provider: string) => boolean>()

const { pickTierCandidate, tierMatches } =
  require('@/lib/llm/fallback/tier-picker') as typeof import('@/lib/llm/fallback/tier-picker')

import type { ConnectionProfile } from '@/lib/schemas/types'
import type { FallbackContext } from '@/lib/llm/fallback'

function makeProfile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: 'p',
    userId: 'u1',
    name: 'Profile',
    provider: 'OPENAI',
    transport: 'api',
    courierDeltaMode: true,
    apiKeyId: 'k1',
    baseUrl: null,
    modelName: 'gpt-x',
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
    modelClass: 'Standard',
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

describe('tierMatches', () => {
  const failed = makeProfile({ id: 'failed', modelClass: 'Standard' })

  it('accepts an equal tier', () => {
    expect(tierMatches(makeProfile({ modelClass: 'Standard' }), failed)).toBe(true)
  })

  it('accepts a better tier', () => {
    expect(tierMatches(makeProfile({ modelClass: 'Deep' }), failed)).toBe(true)
  })

  it('rejects a worse tier', () => {
    expect(tierMatches(makeProfile({ modelClass: 'Compact' }), failed)).toBe(false)
  })

  it('treats unknown against unknown as a match', () => {
    const unclassifiedFailed = makeProfile({ id: 'failed', modelClass: null })
    expect(tierMatches(makeProfile({ modelClass: null }), unclassifiedFailed)).toBe(true)
  })

  it('treats unknown against known as a non-match, in both directions', () => {
    expect(tierMatches(makeProfile({ modelClass: null }), failed)).toBe(false)
    const unclassifiedFailed = makeProfile({ id: 'failed', modelClass: null })
    expect(tierMatches(makeProfile({ modelClass: 'Deep' }), unclassifiedFailed)).toBe(false)
  })
})

describe('pickTierCandidate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCanTransportImages.mockReturnValue(true)
  })

  const failed = makeProfile({ id: 'failed', provider: 'ANTHROPIC', modelClass: 'Standard' })

  it('returns null when nobody qualifies', () => {
    expect(pickTierCandidate(failed, [failed], makeContext())).toBeNull()
  })

  it('never offers the failed profile itself', () => {
    const twin = makeProfile({ id: 'failed' })
    expect(pickTierCandidate(failed, [twin], makeContext())).toBeNull()
  })

  it('never offers a profile already tried on this call', () => {
    const spare = makeProfile({ id: 'spare' })
    expect(
      pickTierCandidate(failed, [spare], makeContext({ alreadyTried: ['spare'] }))
    ).toBeNull()
  })

  it('never offers a Courier profile', () => {
    const courier = makeProfile({ id: 'courier', transport: 'courier' })
    expect(pickTierCandidate(failed, [courier], makeContext())).toBeNull()
  })

  it('skips a profile with no usable API key', () => {
    const keyless = makeProfile({ id: 'keyless', apiKeyId: null })
    expect(pickTierCandidate(failed, [keyless], makeContext())).toBeNull()
  })

  it('requires isDangerousCompatible in a dangerous-routed context', () => {
    const mainstream = makeProfile({ id: 'mainstream', isDangerousCompatible: false })
    const cleared = makeProfile({ id: 'cleared', isDangerousCompatible: true })

    expect(
      pickTierCandidate(failed, [mainstream], makeContext({ dangerous: true }))
    ).toBeNull()
    expect(
      pickTierCandidate(failed, [cleared], makeContext({ dangerous: true }))?.id
    ).toBe('cleared')
  })

  it('requires both halves of vision: the flag and a plugin that sends bytes', () => {
    const noFlag = makeProfile({ id: 'no-flag', supportsImageUpload: false })
    const flagged = makeProfile({ id: 'flagged', supportsImageUpload: true })

    expect(pickTierCandidate(failed, [noFlag], makeContext({ needsVision: true }))).toBeNull()

    mockCanTransportImages.mockReturnValue(false)
    expect(pickTierCandidate(failed, [flagged], makeContext({ needsVision: true }))).toBeNull()

    mockCanTransportImages.mockReturnValue(true)
    expect(
      pickTierCandidate(failed, [flagged], makeContext({ needsVision: true }))?.id
    ).toBe('flagged')
  })

  it('skips a profile with tool use switched off when the call sends tools', () => {
    const noTools = makeProfile({ id: 'no-tools', allowToolUse: false })
    expect(pickTierCandidate(failed, [noTools], makeContext({ needsTools: true }))).toBeNull()
    expect(pickTierCandidate(failed, [noTools], makeContext({ needsTools: false }))?.id)
      .toBe('no-tools')
  })

  it('rejects a candidate of lower model class', () => {
    const worse = makeProfile({ id: 'worse', modelClass: 'Compact' })
    expect(pickTierCandidate(failed, [worse], makeContext())).toBeNull()
  })

  it('prefers a different provider over a same-provider sibling of better tier', () => {
    // The failure is usually the provider's, so a sibling on the same dead
    // endpoint fails identically — diversity outranks raw quality.
    const sameProviderBetter = makeProfile({
      id: 'same', provider: 'ANTHROPIC', modelClass: 'Deep',
    })
    const differentProvider = makeProfile({
      id: 'different', provider: 'OPENAI', modelClass: 'Standard',
    })

    expect(
      pickTierCandidate(failed, [sameProviderBetter, differentProvider], makeContext())?.id
    ).toBe('different')
  })

  it('compares providers case-insensitively — ProviderEnum is an open string', () => {
    const sameProviderLowercased = makeProfile({ id: 'same', provider: 'anthropic' })
    expect(pickTierCandidate(failed, [sameProviderLowercased], makeContext())?.id).toBe('same')
    // ...but it is still ranked below a genuinely different provider.
    const different = makeProfile({ id: 'different', provider: 'GOOGLE' })
    expect(
      pickTierCandidate(failed, [sameProviderLowercased, different], makeContext())?.id
    ).toBe('different')
  })

  it('breaks a tie on quality, then on the user\'s own sort order', () => {
    const lower = makeProfile({ id: 'lower', provider: 'OPENAI', modelClass: 'Standard', sortIndex: 0 })
    const higher = makeProfile({ id: 'higher', provider: 'GOOGLE', modelClass: 'Deep', sortIndex: 5 })
    expect(pickTierCandidate(failed, [lower, higher], makeContext())?.id).toBe('higher')

    const first = makeProfile({ id: 'first', provider: 'OPENAI', modelClass: 'Deep', sortIndex: 1 })
    const second = makeProfile({ id: 'second', provider: 'GOOGLE', modelClass: 'Deep', sortIndex: 9 })
    expect(pickTierCandidate(failed, [second, first], makeContext())?.id).toBe('first')
  })

  it('returns exactly one candidate, never a list', () => {
    const a = makeProfile({ id: 'a', provider: 'OPENAI' })
    const b = makeProfile({ id: 'b', provider: 'GOOGLE' })
    const pick = pickTierCandidate(failed, [a, b], makeContext())
    expect(pick).not.toBeNull()
    expect(typeof pick?.id).toBe('string')
  })
})
