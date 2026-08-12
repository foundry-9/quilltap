/**
 * Regression tests for the per-turn memory processor.
 *
 * Covers the gate-handling surface area for the two-pass shape:
 *   - SELF pass: one call per allowed character, aboutCharacterId = self
 *   - OTHER pass: one MULTI-SUBJECT call per observer, covering every other
 *     allowed character + the user-controlled character (if any). The call's
 *     return is a Map<subjectId, MemoryCandidate[]> so the dispatcher can
 *     route each candidate's aboutCharacterId. The user is NOT special-cased.
 *
 * Also exercises:
 *   - Multiple extracted candidates → multiple memory writes
 *   - sourceMessageTimestamp preservation
 *   - Rate-limit skip and throttle modes
 *   - SKIP_NEAR_DUPLICATE / SKIP_EMBEDDING_FAILED don't add IDs
 */

import { beforeEach, describe, expect, it } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  resolveUncensoredCheapLLMSelection: jest.fn((selection: unknown) => selection),
}))

jest.mock('@/lib/llm/model-context-data', () => ({
  resolveMaxTokens: jest.fn(),
}))

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  extractSelfMemoriesFromTurn: jest.fn(),
  extractOtherMemoriesFromTurn: jest.fn(),
  loadCanonForSelf: jest.fn(() => ({
    characterId: 'noop',
    characterName: 'noop',
    body: null,
    source: 'none',
  })),
  loadCanonForObserverAboutSubject: jest.fn().mockResolvedValue({
    characterId: 'noop',
    characterName: 'noop',
    body: null,
    source: 'none',
  }),
  renderSelfCanonBlock: jest.fn(() => 'CANON'),
  renderOtherCanonBlock: jest.fn(() => 'CANON'),
}))

jest.mock('@/lib/memory/memory-service', () => ({
  createMemoryWithGate: jest.fn(),
}))

const { getCheapLLMProvider, resolveUncensoredCheapLLMSelection } = jest.requireMock('@/lib/llm/cheap-llm') as {
  getCheapLLMProvider: jest.Mock
  resolveUncensoredCheapLLMSelection: jest.Mock
}
const { resolveMaxTokens } = jest.requireMock('@/lib/llm/model-context-data') as {
  resolveMaxTokens: jest.Mock
}
const tasks = jest.requireMock('@/lib/memory/cheap-llm-tasks') as {
  extractSelfMemoriesFromTurn: jest.Mock
  extractOtherMemoriesFromTurn: jest.Mock
  loadCanonForSelf: jest.Mock
  loadCanonForObserverAboutSubject: jest.Mock
  renderSelfCanonBlock: jest.Mock
  renderOtherCanonBlock: jest.Mock
}
const { createMemoryWithGate } = jest.requireMock('@/lib/memory/memory-service') as {
  createMemoryWithGate: jest.Mock
}

/** Build the Map shape returned by extractOtherMemoriesFromTurn (multi-subject). */
function otherResult(byId: Record<string, Array<{ content: string; summary: string; keywords?: string[]; importance?: number }>>) {
  const map = new Map<string, unknown>()
  for (const [id, candidates] of Object.entries(byId)) {
    map.set(id, candidates.map(c => ({
      content: c.content,
      summary: c.summary,
      keywords: c.keywords ?? [],
      importance: c.importance ?? 0.5,
    })))
  }
  return map
}

function makeTranscript(extra: {
  userMessage?: string | null
  userCharacterId?: string | null
  characterSlices?: Array<{
    characterId: string
    characterName: string
    text: string
    isUserControlled?: boolean
  }>
} = {}) {
  const slices = (extra.characterSlices ?? [
    { characterId: 'char-1', characterName: 'Avery', text: "I'll remember the compass." },
  ]).map(s => ({
    ...s,
    characterPronouns: null,
    contributingMessageIds: [`assistant-${s.characterId}`],
  }))

  // Build participantCharacters map covering every slice + the user character.
  const participantCharacters = new Map<string, any>()
  for (const s of slices) {
    participantCharacters.set(s.characterId, {
      id: s.characterId,
      name: s.characterName,
      identity: null,
      characterDocumentMountPointId: null,
    })
  }
  const userCharacterId = 'userCharacterId' in extra ? (extra.userCharacterId ?? undefined) : 'user-char-1'
  if (userCharacterId) {
    participantCharacters.set(userCharacterId, {
      id: userCharacterId,
      name: 'Bob',
      identity: null,
      characterDocumentMountPointId: null,
    })
  }

  return {
    transcript: {
      turnOpenerMessageId: 'opener-1',
      userMessage: 'userMessage' in extra ? extra.userMessage : "I keep my grandmother's compass in my satchel.",
      userCharacterId,
      userCharacterName: userCharacterId ? 'Bob' : undefined,
      userCharacterPronouns: null,
      characterSlices: slices,
      latestAssistantMessageId: `assistant-${(extra.characterSlices?.[0]?.characterId) ?? 'char-1'}`,
    },
    participantCharacters,
    chatId: 'chat-1',
    userId: 'user-1',
    sourceMessageTimestamp: '2026-04-01T12:34:56.000Z',
    connectionProfile: {
      id: 'profile-1',
      provider: 'OPENAI',
      modelName: 'gpt-4o-mini',
    } as any,
    cheapLLMSettings: {
      strategy: 'PROVIDER_CHEAPEST',
      fallbackToLocal: true,
    } as any,
    availableProfiles: [],
  }
}

describe('processTurnForMemory regressions', () => {
  let processTurnForMemory: (ctx: unknown) => Promise<any>

  beforeEach(async () => {
    jest.clearAllMocks()

    getCheapLLMProvider.mockReturnValue({
      provider: 'OPENAI',
      modelName: 'gpt-4o-mini',
      connectionProfileId: 'profile-1',
      isLocal: false,
    } as any)
    resolveUncensoredCheapLLMSelection.mockImplementation((selection: unknown) => selection as any)
    resolveMaxTokens.mockReturnValue(2048)
    tasks.loadCanonForSelf.mockReturnValue({
      characterId: 'noop',
      characterName: 'noop',
      body: null,
      source: 'none',
    } as any)
    tasks.loadCanonForObserverAboutSubject.mockResolvedValue({
      characterId: 'noop',
      characterName: 'noop',
      body: null,
      source: 'none',
    } as any)
    tasks.renderSelfCanonBlock.mockReturnValue('CANON')
    tasks.renderOtherCanonBlock.mockReturnValue('CANON')
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)
    tasks.extractOtherMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: new Map(),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)
    createMemoryWithGate.mockResolvedValue({
      action: 'INSERT',
      memory: { id: 'mem-default' },
    } as any)

    ;({ processTurnForMemory } = await import('@/lib/memory/memory-processor'))
  })

  it('aggregates token usage and writes one memory per gated candidate', async () => {
    tasks.extractOtherMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: otherResult({
        'user-char-1': [
          { content: 'compass fact', summary: 'compass', keywords: ['compass'], importance: 0.8 },
          { content: 'storm fear', summary: 'storms', keywords: ['storms'], importance: 0.7 },
        ],
      }),
      usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
    } as any)
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { content: 'Avery is steady', summary: 'steady', keywords: [], importance: 0.6 },
      ],
      usage: { promptTokens: 9, completionTokens: 3, totalTokens: 12 },
    } as any)

    createMemoryWithGate
      .mockResolvedValueOnce({ action: 'INSERT', memory: { id: 'mem-1' } } as any)
      .mockResolvedValueOnce({ action: 'INSERT_RELATED', memory: { id: 'mem-2' }, relatedMemoryIds: ['mem-1'] } as any)
      .mockResolvedValueOnce({ action: 'REINFORCE', memory: { id: 'mem-3', reinforcementCount: 2 } } as any)

    const result = await processTurnForMemory(makeTranscript())

    // SELF pass writes 1 candidate, OTHER pass (1 char + 1 user subject) writes 2 candidates.
    expect(createMemoryWithGate).toHaveBeenCalledTimes(3)
    expect(result.success).toBe(true)
    expect(result.createdMemoryIds).toEqual(['mem-1', 'mem-2'])
    expect(result.reinforcedMemoryIds).toEqual(['mem-3'])
    expect(result.usage).toEqual({ promptTokens: 21, completionTokens: 7, totalTokens: 28 })
  })

  it('preserves the source message timestamp', async () => {
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { content: 'Avery is steady', summary: 'steady', keywords: [], importance: 0.7 },
      ],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)

    await processTurnForMemory(makeTranscript())

    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMessageTimestamp: '2026-04-01T12:34:56.000Z',
      }),
      { userId: 'user-1' },
    )
  })

  it('stamps the chat projectId onto every derived memory write', async () => {
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { content: 'Avery is steady', summary: 'steady', keywords: [], importance: 0.7 },
      ],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)

    await processTurnForMemory({ ...makeTranscript(), projectId: 'proj-9' })

    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-9' }),
      { userId: 'user-1' },
    )
  })

  it('writes projectId: null when the chat has no project', async () => {
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { content: 'Avery is steady', summary: 'steady', keywords: [], importance: 0.7 },
      ],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)

    await processTurnForMemory(makeTranscript())

    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: null }),
      { userId: 'user-1' },
    )
  })

  it('SKIP_NEAR_DUPLICATE keeps the result clean', async () => {
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { content: 'fact', summary: 'fact', keywords: [], importance: 0.7 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)
    createMemoryWithGate.mockReset()
    createMemoryWithGate.mockResolvedValueOnce({
      action: 'SKIP_NEAR_DUPLICATE',
      memory: { id: 'mem-existing', reinforcementCount: 5 },
      similarity: 0.95,
    } as any)
    // OTHER pass (user as subject) returns nothing — skip is only on SELF.
    tasks.extractOtherMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: new Map(),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)

    const result = await processTurnForMemory(makeTranscript())

    expect(result.success).toBe(true)
    expect(result.createdMemoryIds).toEqual([])
    expect(result.reinforcedMemoryIds).toEqual([])
    expect(result.debugLogs.join('\n')).toContain('SKIPPED near-duplicate')
  })

  it('SKIP_EMBEDDING_FAILED keeps the result clean and surfaces the reason in debug logs', async () => {
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { content: 'fact', summary: 'fact', keywords: [], importance: 0.7 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)
    createMemoryWithGate.mockReset()
    createMemoryWithGate.mockResolvedValueOnce({
      action: 'SKIP_EMBEDDING_FAILED',
      memory: null,
      reason: 'Embedding failed after retry: ECONNREFUSED',
    } as any)
    tasks.extractOtherMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: new Map(),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)

    const result = await processTurnForMemory(makeTranscript())

    expect(result.success).toBe(true)
    expect(result.createdMemoryIds).toEqual([])
    expect(result.debugLogs.join('\n')).toContain('embedding generation failed')
  })

  it('rate limit: skips a character entirely when its recent count >= maxPerHour', async () => {
    const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
      getRepositories: jest.Mock
    }
    repositoriesMock.getRepositories.mockReturnValue({
      memories: { countCreatedSince: jest.fn<any>().mockResolvedValue(25) },
    })

    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { content: 'fact', summary: 'fact', keywords: [], importance: 0.7 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    const ctx = makeTranscript()
    const result = await processTurnForMemory({
      ...ctx,
      memoryExtractionLimits: {
        enabled: true,
        maxPerHour: 20,
        softStartFraction: 0.7,
        softFloor: 0.7,
      },
    })

    expect(result.success).toBe(true)
    expect(tasks.extractSelfMemoriesFromTurn).not.toHaveBeenCalled()
    expect(tasks.extractOtherMemoriesFromTurn).not.toHaveBeenCalled()
    expect(result.debugLogs.join('\n')).toContain('rate limit reached')
  })

  it('rate limit: in soft band, drops candidates below the floor', async () => {
    const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
      getRepositories: jest.Mock
    }
    repositoriesMock.getRepositories.mockReturnValue({
      memories: { countCreatedSince: jest.fn<any>().mockResolvedValue(15) },
    })

    tasks.extractOtherMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: otherResult({
        'user-char-1': [
          { content: 'low', summary: 'low', keywords: [], importance: 0.5 },
          { content: 'alsoLow', summary: 'alsoLow', keywords: [], importance: 0.6 },
          { content: 'high', summary: 'high', keywords: [], importance: 0.8 },
        ],
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    const ctx = makeTranscript()
    const result = await processTurnForMemory({
      ...ctx,
      memoryExtractionLimits: {
        enabled: true,
        maxPerHour: 20,
        softStartFraction: 0.7,
        softFloor: 0.7,
      },
    })

    expect(result.success).toBe(true)
    expect(result.debugLogs.join('\n')).toContain('Throttle dropped')
    expect(result.debugLogs.join('\n')).toContain('floor 0.7')
  })

  it('omits the user from OTHER subjects when no user-controlled character is attached', async () => {
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { content: 'Avery feels protective.', summary: 'Avery is protective', keywords: [], importance: 0.6 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    const ctx = makeTranscript({ userCharacterId: undefined })

    const result = await processTurnForMemory(ctx)

    expect(result.success).toBe(true)
    expect(tasks.extractSelfMemoriesFromTurn).toHaveBeenCalledTimes(1)
    // No other characters and no user — OTHER pass dispatches zero calls.
    expect(tasks.extractOtherMemoriesFromTurn).not.toHaveBeenCalled()
    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-1',
        aboutCharacterId: 'char-1',
      }),
      { userId: 'user-1' },
    )
  })

  it('OTHER pass writes aboutCharacterId = userCharacterId when subject is the user', async () => {
    tasks.extractOtherMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: otherResult({
        'user-char-1': [
          { content: 'User likes jazz.', summary: 'jazz', keywords: ['jazz'], importance: 0.6 },
        ],
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    await processTurnForMemory(makeTranscript())

    // 1 character + 1 user subject = 1 multi-subject OTHER call from char-1
    // covering subjects=[user-char-1].
    expect(tasks.extractOtherMemoriesFromTurn).toHaveBeenCalledTimes(1)
    expect(tasks.extractOtherMemoriesFromTurn).toHaveBeenCalledWith(
      expect.anything(),       // transcript
      'char-1',                // observerCharacterId
      expect.arrayContaining([
        expect.objectContaining({ id: 'user-char-1', isUser: true }),
      ]),                       // subjects
      expect.anything(),       // selection
      'user-1',                // userId
      undefined,               // uncensoredFallback
      'chat-1',                // chatId
      2048,                    // resolvedMaxTokens
      false,                   // inAutonomousRoom (added in b437f0af, Sub-task D)
      { projectDescription: null, chatContextSummary: null }, // orienting context
      expect.objectContaining({ timelineMode: 'realtime' }),  // extraction clock (episodic spine)
    )
    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-1',
        aboutCharacterId: 'user-char-1',
      }),
      { userId: 'user-1' },
    )
  })

  it('OTHER pass fires once per observer covering all subjects (N=2 chars + user → 2 calls, 4 gate writes)', async () => {
    tasks.extractOtherMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: otherResult({
        'char-1': [{ content: 'about-char-1', summary: 'about-char-1', keywords: [], importance: 0.6 }],
        'char-2': [{ content: 'about-char-2', summary: 'about-char-2', keywords: [], importance: 0.6 }],
        'user-char-1': [{ content: 'about-user', summary: 'about-user', keywords: [], importance: 0.6 }],
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    const ctx = makeTranscript({
      characterSlices: [
        { characterId: 'char-1', characterName: 'Avery', text: 'Avery speaks.' },
        { characterId: 'char-2', characterName: 'Beatrice', text: 'Beatrice replies.' },
      ],
    })

    await processTurnForMemory(ctx)

    // One multi-subject call per observer (2 observers → 2 calls). Each call's
    // returned Map is consulted for every subject the observer is paired with,
    // so the gate still fires 2 × 2 = 4 times for the OTHER pass.
    expect(tasks.extractOtherMemoriesFromTurn).toHaveBeenCalledTimes(2)
    // Char-to-char pairings.
    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-1', aboutCharacterId: 'char-2' }),
      { userId: 'user-1' },
    )
    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-2', aboutCharacterId: 'char-1' }),
      { userId: 'user-1' },
    )
    // Both characters also extract memories about the user.
    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-1', aboutCharacterId: 'user-char-1' }),
      { userId: 'user-1' },
    )
    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-2', aboutCharacterId: 'user-char-1' }),
      { userId: 'user-1' },
    )
  })

  // ── User-controlled character as a memory HOLDER ────────────────────────────
  // When a human drives a character, that character's opener arrives as a slice
  // flagged isUserControlled. It must form its own SELF memories and OTHER
  // observations, without being duplicated as a subject or becoming its own
  // OTHER subject.
  describe('user-controlled holder', () => {
    function userHolderCtx() {
      // Bob is driven by the human (slice flagged isUserControlled); Avery is
      // a normal AI character. Both are slices this turn.
      return makeTranscript({
        userMessage: 'I keep my compass.',
        userCharacterId: 'user-char-1',
        characterSlices: [
          { characterId: 'user-char-1', characterName: 'Bob', text: 'I keep my compass.', isUserControlled: true },
          { characterId: 'char-1', characterName: 'Avery', text: 'Avery nods.' },
        ],
      })
    }

    beforeEach(() => {
      // SELF returns a candidate only for the user-controlled holder; OTHER
      // returns one candidate about every subject the observer is paired with.
      tasks.extractSelfMemoriesFromTurn.mockImplementation(async (_t: unknown, targetId: string) => ({
        success: true,
        result: targetId === 'user-char-1'
          ? [{ content: 'I committed to leaving at dawn.', summary: 'committed to leave', keywords: [], importance: 0.7 }]
          : [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }) as any)
      tasks.extractOtherMemoriesFromTurn.mockImplementation(
        async (_t: unknown, observerId: string, subjects: Array<{ id: string }>) => {
          const map = new Map<string, unknown>()
          for (const s of subjects) {
            map.set(s.id, [{ content: `${observerId} about ${s.id}`, summary: 'obs', keywords: [], importance: 0.6 }])
          }
          return { success: true, result: map, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } } as any
        },
      )
    })

    it('forms SELF memories attributed to the user-controlled character (aboutCharacterId === self)', async () => {
      await processTurnForMemory(userHolderCtx())

      expect(tasks.extractSelfMemoriesFromTurn).toHaveBeenCalledWith(
        expect.anything(), 'user-char-1', expect.anything(), expect.anything(),
        'user-1', undefined, 'chat-1', expect.anything(), false, expect.anything(),
        expect.anything(), // extraction clock (episodic spine)
      )
      expect(createMemoryWithGate).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: 'user-char-1', aboutCharacterId: 'user-char-1' }),
        { userId: 'user-1' },
      )
    })

    it('forms OTHER memories the user character holds about the other present characters', async () => {
      await processTurnForMemory(userHolderCtx())

      // Bob (user-controlled) observes Avery.
      expect(createMemoryWithGate).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: 'user-char-1', aboutCharacterId: 'char-1' }),
        { userId: 'user-1' },
      )
      // Avery still observes Bob.
      expect(createMemoryWithGate).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: 'char-1', aboutCharacterId: 'user-char-1' }),
        { userId: 'user-1' },
      )
    })

    it('never makes the user character its own OTHER subject', async () => {
      await processTurnForMemory(userHolderCtx())

      const bobCall = tasks.extractOtherMemoriesFromTurn.mock.calls.find((c: unknown[]) => c[1] === 'user-char-1')
      expect(bobCall).toBeDefined()
      const bobSubjects = bobCall![2] as Array<{ id: string }>
      expect(bobSubjects.map(s => s.id)).toEqual(['char-1'])
      expect(bobSubjects.some(s => s.id === 'user-char-1')).toBe(false)
    })

    it('de-dupes the user subject: exactly one user entry, tagged isUser, and logs the skip', async () => {
      const result = await processTurnForMemory(userHolderCtx())

      const averyCall = tasks.extractOtherMemoriesFromTurn.mock.calls.find((c: unknown[]) => c[1] === 'char-1')
      expect(averyCall).toBeDefined()
      const averySubjects = averyCall![2] as Array<{ id: string; isUser: boolean }>
      const userEntries = averySubjects.filter(s => s.id === 'user-char-1')
      expect(userEntries).toHaveLength(1)
      expect(userEntries[0].isUser).toBe(true)
      expect(result.debugLogs.join('\n')).toContain('Skipped duplicate user subject')
    })

    it('rate-limits the user-controlled holder on its own per-character cap', async () => {
      // Bob is over the cap; Avery is fresh. The cap is keyed on character ID,
      // so the user-controlled character is gated exactly like an AI one.
      const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
      repositoriesMock.getRepositories.mockReturnValue({
        memories: {
          countCreatedSince: jest.fn<any>((id: string) => Promise.resolve(id === 'user-char-1' ? 25 : 0)),
        },
      })

      const result = await processTurnForMemory({
        ...userHolderCtx(),
        memoryExtractionLimits: { enabled: true, maxPerHour: 20, softStartFraction: 0.7, softFloor: 0.7 },
      })

      expect(result.success).toBe(true)
      // Bob (over cap) never forms memories…
      const selfTargets = tasks.extractSelfMemoriesFromTurn.mock.calls.map((c: unknown[]) => c[1])
      expect(selfTargets).not.toContain('user-char-1')
      expect(selfTargets).toContain('char-1')
      const otherObservers = tasks.extractOtherMemoriesFromTurn.mock.calls.map((c: unknown[]) => c[1])
      expect(otherObservers).not.toContain('user-char-1')
      expect(result.debugLogs.join('\n')).toContain('SKIPPED extraction for Bob')
    })
  })
})
