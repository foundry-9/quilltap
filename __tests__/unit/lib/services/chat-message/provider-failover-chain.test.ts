/**
 * Hard-error failover: the chain walk inside provider-failover.service.
 *
 * Covers the swap semantics the rest of the turn depends on — who ends up in
 * `state.effectiveProfile`, what the buffers hold, and which failures the
 * chain declines to touch at all.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const mockStreamMessageImpl = jest.fn<(opts: Record<string, unknown>) => AsyncGenerator<any>>()
const mockSafeEnqueue = jest.fn()
const mockEncodeStatusEvent = jest.fn((_e: unknown, payload: unknown) => payload)

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  })),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  streamMessage: (opts: Record<string, unknown>) => mockStreamMessageImpl(opts),
  encodeContentChunk: (_e: unknown, text: string) => text,
  encodeStatusEvent: (e: unknown, payload: unknown) => mockEncodeStatusEvent(e, payload),
  safeEnqueue: (...args: any[]) => mockSafeEnqueue(...(args as [])),
  applyReasoningChunk: jest.fn(),
  flushReasoningSegment: jest.fn(),
}))

jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  resolveProviderForDangerousContent: jest.fn(),
}))

jest.mock('@/lib/llm/moderation-finish-reason', () => ({
  describeModerationRefusal: jest.fn(() => null),
}))

const { attemptHardErrorFailover } =
  require('@/lib/services/chat-message/provider-failover.service') as typeof import('@/lib/services/chat-message/provider-failover.service')

import { APIKeyError, TokenLimitError } from '@/lib/llm/errors'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type { StreamingState } from '@/lib/services/chat-message/types'

function makeProfile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: 'p-primary', userId: 'u1', name: 'Primary', provider: 'ANTHROPIC',
    transport: 'api', courierDeltaMode: true, apiKeyId: 'k1', baseUrl: null,
    modelName: 'claude-sonnet', parameters: {}, isDefault: false, isCheap: false,
    allowWebSearch: false, useNativeWebSearch: false, allowToolUse: true,
    pseudoToolMode: 'auto', multiCharacterPrefill: null,
    fallbackProfileId: null, allowTierFallback: false,
    modelClass: 'Standard', maxContext: null, maxTokens: null,
    isDangerousCompatible: false, supportsImageUpload: false, tags: [], sortIndex: 0,
    totalTokens: 0, totalPromptTokens: 0, totalCompletionTokens: 0, messageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ConnectionProfile
}

function makeState(profile: ConnectionProfile, overrides: Partial<StreamingState> = {}): StreamingState {
  return {
    fullResponse: '', effectiveProfile: profile, effectiveApiKey: 'primary-key',
    usage: null, cacheUsage: null, attachmentResults: null, rawResponse: null,
    hasStartedStreaming: false,
    ...overrides,
  } as StreamingState
}

function makeRepos(profiles: ConnectionProfile[]) {
  return {
    connections: {
      findById: async (id: string) => profiles.find((p) => p.id === id) ?? null,
      findByUserId: async (userId: string) => profiles.filter((p) => p.userId === userId),
      findApiKeyById: async (id: string) => ({ key_value: `key-for-${id}` }),
    },
  }
}

function streamYielding(chunks: Array<{ content?: string; done?: boolean }>) {
  return async function* () {
    for (const c of chunks) yield c
  }
}

function baseOpts(state: StreamingState, repos: ReturnType<typeof makeRepos>) {
  return {
    state,
    repos,
    context: {
      userId: 'u1', purpose: 'chat' as const, dangerous: false,
      needsVision: false, needsTools: false, alreadyTried: [],
    },
    formattedMessages: [{ role: 'user', content: 'hello' }],
    modelParams: {},
    actualTools: [],
    useNativeWebSearch: false,
    chatId: 'chat-1',
    character: { id: 'ch-1', name: 'Alice' },
    controller: { enqueue: jest.fn() } as any,
    encoder: new TextEncoder(),
  }
}

describe('attemptHardErrorFailover', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does nothing at all for a failure the chain refuses to act on', async () => {
    const primary = makeProfile({ fallbackProfileId: 'p-understudy' })
    const understudy = makeProfile({ id: 'p-understudy', name: 'Understudy' })
    const state = makeState(primary)

    const result = await attemptHardErrorFailover({
      ...baseOpts(state, makeRepos([primary, understudy])),
      error: new TokenLimitError('ANTHROPIC', 210311, 200000),
    })

    expect(result).toEqual({ recovered: false, attempts: [], tierPickWasOffered: false })
    expect(mockStreamMessageImpl).not.toHaveBeenCalled()
  })

  it('does nothing once content has already reached the user', async () => {
    const primary = makeProfile({ fallbackProfileId: 'p-understudy' })
    const understudy = makeProfile({ id: 'p-understudy', name: 'Understudy' })
    const state = makeState(primary, { hasStartedStreaming: true, fullResponse: 'Half a sen' })

    const result = await attemptHardErrorFailover({
      ...baseOpts(state, makeRepos([primary, understudy])),
      error: new APIKeyError('ANTHROPIC'),
    })

    expect(result.recovered).toBe(false)
    expect(mockStreamMessageImpl).not.toHaveBeenCalled()
    // The partial is left intact for preservePartialOnError.
    expect(state.fullResponse).toBe('Half a sen')
  })

  it('hands the turn to the understudy and swaps the effective profile', async () => {
    const primary = makeProfile({ fallbackProfileId: 'p-understudy' })
    const understudy = makeProfile({ id: 'p-understudy', name: 'Understudy', provider: 'OPENAI' })
    const state = makeState(primary)

    mockStreamMessageImpl.mockImplementation(
      streamYielding([{ content: 'The understudy speaks.' }, { done: true }]) as never
    )

    const result = await attemptHardErrorFailover({
      ...baseOpts(state, makeRepos([primary, understudy])),
      error: new APIKeyError('ANTHROPIC'),
    })

    expect(result.recovered).toBe(true)
    expect(state.fullResponse).toBe('The understudy speaks.')
    expect(state.effectiveProfile.id).toBe('p-understudy')
    expect(state.effectiveApiKey).toBe('key-for-k1')
    // The primary's failure still leads the trail.
    expect(result.attempts.map((a) => a.profileName)).toEqual(['Primary'])
  })

  it('emits a failing-over status naming the understudy', async () => {
    const primary = makeProfile({ fallbackProfileId: 'p-understudy' })
    const understudy = makeProfile({ id: 'p-understudy', name: 'Understudy' })
    const state = makeState(primary)

    mockStreamMessageImpl.mockImplementation(
      streamYielding([{ content: 'ok' }, { done: true }]) as never
    )

    await attemptHardErrorFailover({
      ...baseOpts(state, makeRepos([primary, understudy])),
      error: new APIKeyError('ANTHROPIC'),
    })

    const statuses = mockEncodeStatusEvent.mock.calls.map((c) => c[1] as { stage: string; message: string })
    expect(statuses.some((s) => s.stage === 'failing-over' && s.message.includes('Understudy')))
      .toBe(true)
  })

  it('does not glue the understudy\'s answer onto the failed attempt\'s buffers', async () => {
    const primary = makeProfile({ fallbackProfileId: 'p-understudy' })
    const understudy = makeProfile({ id: 'p-understudy', name: 'Understudy' })
    // Reasoning arrived before the primary died, but no prose did.
    const state = makeState(primary, { reasoningContent: 'the primary was mulling' })

    mockStreamMessageImpl.mockImplementation(
      streamYielding([{ content: 'Fresh.' }, { done: true }]) as never
    )

    await attemptHardErrorFailover({
      ...baseOpts(state, makeRepos([primary, understudy])),
      error: new APIKeyError('ANTHROPIC'),
    })

    expect(state.fullResponse).toBe('Fresh.')
    expect(state.reasoningContent).toBe('')
  })

  it('moves on when an understudy fails too, and records both', async () => {
    const primary = makeProfile({ fallbackProfileId: 'p-understudy', allowTierFallback: true })
    const understudy = makeProfile({ id: 'p-understudy', name: 'Understudy', provider: 'OPENAI' })
    const spare = makeProfile({ id: 'p-spare', name: 'Spare', provider: 'GOOGLE' })
    const state = makeState(primary)

    mockStreamMessageImpl
      .mockImplementationOnce((() => { throw new Error('503 Service Unavailable') }) as never)
      .mockImplementationOnce(streamYielding([{ content: 'Third time lucky.' }, { done: true }]) as never)

    const result = await attemptHardErrorFailover({
      ...baseOpts(state, makeRepos([primary, understudy, spare])),
      error: new APIKeyError('ANTHROPIC'),
    })

    expect(result.recovered).toBe(true)
    expect(state.effectiveProfile.id).toBe('p-spare')
    expect(result.attempts.map((a) => [a.profileName, a.trigger])).toEqual([
      ['Primary', 'auth'],
      ['Understudy', 'provider-error'],
    ])
  })

  it('treats an understudy\'s empty response as a failure and keeps walking', async () => {
    const primary = makeProfile({ fallbackProfileId: 'p-understudy' })
    const understudy = makeProfile({ id: 'p-understudy', name: 'Understudy' })
    const state = makeState(primary)

    mockStreamMessageImpl.mockImplementation(streamYielding([{ done: true }]) as never)

    const result = await attemptHardErrorFailover({
      ...baseOpts(state, makeRepos([primary, understudy])),
      error: new APIKeyError('ANTHROPIC'),
    })

    expect(result.recovered).toBe(false)
    expect(result.attempts.map((a) => a.trigger)).toEqual(['auth', 'empty-response'])
  })

  it('leaves the buffers empty when the chain is exhausted', async () => {
    const primary = makeProfile({ fallbackProfileId: 'p-understudy' })
    const understudy = makeProfile({ id: 'p-understudy', name: 'Understudy' })
    const state = makeState(primary)

    mockStreamMessageImpl.mockImplementation(
      (() => { throw new Error('503 Service Unavailable') }) as never
    )

    const result = await attemptHardErrorFailover({
      ...baseOpts(state, makeRepos([primary, understudy])),
      error: new APIKeyError('ANTHROPIC'),
    })

    expect(result.recovered).toBe(false)
    expect(state.fullResponse).toBe('')
    // Not swapped: nobody answered, so the message stays attributed to the
    // profile the user actually chose.
    expect(state.effectiveProfile.id).toBe('p-primary')
  })

  it('reports whether a tier replacement was ever offered', async () => {
    const primary = makeProfile({ fallbackProfileId: 'p-understudy', allowTierFallback: false })
    const understudy = makeProfile({ id: 'p-understudy', name: 'Understudy' })
    const spare = makeProfile({ id: 'p-spare', name: 'Spare', provider: 'GOOGLE' })
    const state = makeState(primary)

    mockStreamMessageImpl.mockImplementation(
      (() => { throw new Error('503 Service Unavailable') }) as never
    )

    const result = await attemptHardErrorFailover({
      ...baseOpts(state, makeRepos([primary, understudy, spare])),
      error: new APIKeyError('ANTHROPIC'),
    })

    expect(result.tierPickWasOffered).toBe(false)
  })
})
