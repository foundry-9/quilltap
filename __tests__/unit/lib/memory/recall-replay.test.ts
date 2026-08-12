/**
 * Recall replay harness.
 *
 * This is the instrument the episodic-recall constants get tuned against, so
 * it is only useful while it faithfully reproduces the live path. The
 * load-bearing claims: the replayed turn resolves against ITS OWN clock rather
 * than wall-clock now (replaying a June turn must not date "last week" from
 * today), the old path runs with the episodic signals genuinely inert, and the
 * new path's head size widens only for a retrospective turn.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  extractMemorySearchKeywords: jest.fn(),
  stripToolArtifacts: jest.fn((s: string) => s),
}))

jest.mock('@/lib/memory/memory-service', () => ({
  searchMemoriesSemantic: jest.fn(),
}))

jest.mock('@/lib/memory/recall-history', () => ({
  recentlyWhisperedIdSet: jest.fn(() => new Set<string>()),
}))

jest.mock('@/lib/instance-settings', () => ({
  getMemoryRecallSettings: jest.fn(),
}))

import { runRecallReplay } from '@/lib/memory/recall-replay'
import { getRepositories } from '@/lib/repositories/factory'
import { extractMemorySearchKeywords } from '@/lib/memory/cheap-llm-tasks'
import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { getMemoryRecallSettings } from '@/lib/instance-settings'
import { DYNAMIC_HEAD_DEFAULT_SIZE, RETRO_HEAD_SIZE } from '@/lib/chat/context/memory-injector'

const mockRepos = getRepositories as jest.Mock
const mockDistill = extractMemorySearchKeywords as jest.Mock
const mockSearch = searchMemoriesSemantic as jest.Mock
const mockRecallSettings = getMemoryRecallSettings as jest.Mock

type AnyRecord = Record<string, unknown>

const cheapLLM = { provider: 'anthropic', modelName: 'claude-haiku-4-5-20251001' } as never

function message(id: string, role: 'USER' | 'ASSISTANT', content: string, createdAt: string) {
  return { id, type: 'message', role, content, createdAt, systemSender: null }
}

/** Two interchanges, a month apart, so the historical clock is observable. */
const DEFAULT_MESSAGES = [
  message('m1', 'USER', 'What did we do at the fair?', '2026-06-10T12:00:00.000Z'),
  message('m2', 'ASSISTANT', 'We rode the wheel.', '2026-06-10T12:01:00.000Z'),
  message('m3', 'USER', 'And the cellar?', '2026-07-20T09:00:00.000Z'),
  message('m4', 'ASSISTANT', 'Dusty, as ever.', '2026-07-20T09:01:00.000Z'),
]

function hit(id: string, over: AnyRecord = {}) {
  return {
    memory: {
      id,
      summary: `summary ${id}`,
      kind: 'semantic',
      occurredAt: null,
      narrativeTime: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      keywords: ['k'],
    },
    score: 0.5,
    rawWeight: 0.4,
    recallAdjustment: null,
    ...over,
  }
}

function primeRepos(over: { chat?: AnyRecord | null; character?: AnyRecord | null; messages?: unknown[] } = {}) {
  const chat =
    over.chat === undefined
      ? {
          id: 'chat-1',
          projectId: 'proj-1',
          chatType: 'salon',
          timelineMode: 'realtime',
          commonplaceRecallHistory: null,
          participants: [
            { id: 'p-user', characterId: null, controlledBy: 'user', status: 'active' },
            { id: 'p-ai', characterId: 'char-1', controlledBy: 'llm', status: 'active' },
          ],
        }
      : over.chat

  mockRepos.mockReturnValue({
    chats: {
      findById: jest.fn(async () => chat),
      getMessages: jest.fn(async () => over.messages ?? DEFAULT_MESSAGES),
    },
    characters: {
      // Echo the requested id so "which participant did it pick?" is observable.
      findByIdRaw: jest.fn(async (id: string) =>
        over.character === undefined ? { id, name: `Name-${id}` } : over.character
      ),
    },
  })
  return chat
}

function baseInput(over: AnyRecord = {}) {
  return { chatId: 'chat-1', userId: 'u1', cheapLLM, ...over } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  primeRepos()
  mockRecallSettings.mockResolvedValue({ scopePolicy: 'chat', expandRelated: true })
  mockDistill.mockResolvedValue({
    success: true,
    result: { paraphrase: 'the cellar', keywords: ['cellar'], retrospective: false, entities: [] },
  })
  mockSearch.mockResolvedValue([hit('mem-1'), hit('mem-2')])
})

describe('runRecallReplay — resolution and guards', () => {
  it('throws when the chat is missing', async () => {
    primeRepos({ chat: null })

    await expect(runRecallReplay(baseInput())).rejects.toThrow('Chat not found')
  })

  it('throws when no LLM-controlled character participates', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        participants: [{ id: 'p-user', characterId: null, controlledBy: 'user', status: 'active' }],
      },
    })

    await expect(runRecallReplay(baseInput())).rejects.toThrow(/No LLM-controlled character/)
  })

  it('skips a removed participant when auto-selecting the character', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'p-gone', characterId: 'char-gone', controlledBy: 'llm', status: 'removed' },
          { id: 'p-ai', characterId: 'char-1', controlledBy: 'llm', status: 'active' },
        ],
      },
    })

    const result = await runRecallReplay(baseInput())

    expect(result.characterId).toBe('char-1')
  })

  it('throws when the chat has no turns', async () => {
    primeRepos({ messages: [] })

    await expect(runRecallReplay(baseInput())).rejects.toThrow('Chat has no turns to replay')
  })

  it('throws when the character row is gone', async () => {
    primeRepos({ character: null })

    await expect(runRecallReplay(baseInput())).rejects.toThrow('Character record not found')
  })

  it('throws when no query can be derived', async () => {
    mockDistill.mockResolvedValue({ success: true, result: { paraphrase: '', keywords: [] } })
    primeRepos({
      messages: [message('m1', 'USER', '   ', '2026-07-20T09:00:00.000Z')],
    })

    await expect(runRecallReplay(baseInput())).rejects.toThrow(/Could not derive a recall query/)
  })
})

describe('runRecallReplay — the historical clock', () => {
  it('dates the distillation from the replayed turn, not from now', async () => {
    await runRecallReplay(baseInput({ turnIndex: 1 }))

    const [, , , , , , opts] = mockDistill.mock.calls[0]
    // Turn 1 ends in June; replaying it must resolve "last week" against June.
    expect((opts as AnyRecord).nowIso).toBe('2026-06-10T12:01:00.000Z')
  })

  it('passes that same clock to the searches as nowMs', async () => {
    await runRecallReplay(baseInput({ turnIndex: 1 }))

    const [, , options] = mockSearch.mock.calls[0]
    expect((options as AnyRecord).recallContext).toMatchObject({
      nowMs: Date.parse('2026-06-10T12:01:00.000Z'),
      currentChatId: 'chat-1',
      currentProjectId: 'proj-1',
    })
  })

  it('defaults to the last turn and reports the total', async () => {
    const result = await runRecallReplay(baseInput())

    expect(result.totalTurns).toBe(2)
    expect(result.turnIndex).toBe(2)
    expect(result.clockIso).toBe('2026-07-20T09:01:00.000Z')
  })

  it.each([
    [0, 1],
    [-5, 1],
    [99, 2],
  ])('clamps a turnIndex of %i to %i', async (requested, expected) => {
    const result = await runRecallReplay(baseInput({ turnIndex: requested }))

    expect(result.turnIndex).toBe(expected)
  })
})

describe('runRecallReplay — the two paths', () => {
  it('runs the old path with every episodic signal inert', async () => {
    mockDistill.mockResolvedValue({
      success: true,
      result: {
        paraphrase: 'the fair',
        keywords: ['fair'],
        retrospective: true,
        entities: ['Wheel'],
        timeRange: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' },
      },
    })

    await runRecallReplay(baseInput())

    const [, , oldOptions] = mockSearch.mock.calls[0]
    expect(oldOptions).not.toHaveProperty('entityAnchors')
    expect(oldOptions).not.toHaveProperty('occurredWithin')
    expect(oldOptions).not.toHaveProperty('extraProbes')
    expect((oldOptions as AnyRecord).recallContext).not.toHaveProperty('turnRetrospective')
  })

  it('gives the new path the retrospective flip, window, anchors and probes', async () => {
    mockDistill.mockResolvedValue({
      success: true,
      result: {
        paraphrase: 'the fair',
        keywords: ['fair'],
        retrospective: true,
        entities: ['Wheel', 'Cellar'],
        timeRange: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' },
      },
    })

    await runRecallReplay(baseInput())

    const [, , newOptions] = mockSearch.mock.calls[1]
    expect(newOptions).toMatchObject({
      entityAnchors: ['Wheel', 'Cellar'],
      occurredWithin: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' },
    })
    expect((newOptions as AnyRecord).recallContext).toMatchObject({ turnRetrospective: true })
    expect((newOptions as AnyRecord).extraProbes).toEqual([
      'Wheel Cellar',
      'the fair (around 2026-06-01 to 2026-06-30)',
    ])
  })

  it('raises no extra probes on a non-retrospective turn', async () => {
    mockDistill.mockResolvedValue({
      success: true,
      result: {
        paraphrase: 'the cellar',
        keywords: ['cellar'],
        retrospective: false,
        entities: ['Cellar'],
        timeRange: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' },
      },
    })

    await runRecallReplay(baseInput())

    const [, , newOptions] = mockSearch.mock.calls[1]
    expect((newOptions as AnyRecord).extraProbes).toBeUndefined()
    // The window is ungated from the flag, matching the live consumers.
    expect((newOptions as AnyRecord).occurredWithin).toEqual({
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T00:00:00.000Z',
    })
  })

  it('widens the new path head only when the turn is retrospective', async () => {
    const rows = Array.from({ length: RETRO_HEAD_SIZE + 4 }, (_, i) => hit(`m${i}`))
    mockSearch.mockResolvedValue(rows)

    const plain = await runRecallReplay(baseInput())
    expect(plain.newPath.filter((r) => r.selected)).toHaveLength(DYNAMIC_HEAD_DEFAULT_SIZE)

    mockDistill.mockResolvedValue({
      success: true,
      result: { paraphrase: 'the fair', keywords: ['fair'], retrospective: true, entities: [] },
    })
    const retro = await runRecallReplay(baseInput())
    expect(retro.newPath.filter((r) => r.selected)).toHaveLength(RETRO_HEAD_SIZE)
    // The old path never widens — that is what makes the comparison meaningful.
    expect(retro.oldPath.filter((r) => r.selected)).toHaveLength(DYNAMIC_HEAD_DEFAULT_SIZE)
  })
})

describe('runRecallReplay — query derivation and rows', () => {
  it('prefers the paraphrase, then the keywords, then the last message', async () => {
    mockDistill.mockResolvedValue({ success: true, result: { paraphrase: 'the cellar' } })
    expect((await runRecallReplay(baseInput())).query).toBe('the cellar')

    mockDistill.mockResolvedValue({
      success: true,
      result: { paraphrase: '', keywords: ['dust', 'stairs'] },
    })
    expect((await runRecallReplay(baseInput())).query).toBe('dust stairs')

    mockDistill.mockResolvedValue({ success: false, error: 'model down' })
    expect((await runRecallReplay(baseInput())).query).toBe('Dusty, as ever.')
  })

  it('reports null signals when distillation fails, without throwing', async () => {
    mockDistill.mockResolvedValue({ success: false, error: 'model down' })

    const result = await runRecallReplay(baseInput())

    expect(result.signals).toBeNull()
    expect(result.oldPath).toHaveLength(2)
    expect(result.newPath).toHaveLength(2)
  })

  it('flattens a candidate row, including a null recallAdjustment', async () => {
    mockSearch.mockResolvedValue([
      hit('mem-1', {
        score: 0.81,
        rawWeight: 0.62,
        recallAdjustment: {
          blendedBefore: 0.5,
          multiplier: 1.4,
          fired: ['retrospective'],
          blendedAfter: 0.7,
        },
      }),
      hit('mem-2', { rawWeight: undefined, recallAdjustment: null }),
    ])

    const { newPath } = await runRecallReplay(baseInput())

    expect(newPath[0]).toMatchObject({
      memoryId: 'mem-1',
      cosine: 0.81,
      rawWeight: 0.62,
      blendedBefore: 0.5,
      multiplier: 1.4,
      fired: ['retrospective'],
      blendedAfter: 0.7,
      selected: true,
    })
    expect(newPath[1]).toMatchObject({
      rawWeight: null,
      blendedBefore: null,
      multiplier: null,
      fired: [],
      blendedAfter: null,
    })
  })

  it('honours an explicit characterId and limit', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'p-a', characterId: 'char-1', controlledBy: 'llm', status: 'active' },
          { id: 'p-b', characterId: 'char-2', controlledBy: 'llm', status: 'active' },
        ],
      },
    })

    const result = await runRecallReplay(baseInput({ characterId: 'char-2', limit: 5 }))

    // The named character wins over the first LLM participant in the list.
    expect(result.characterId).toBe('char-2')
    expect(result.characterName).toBe('Name-char-2')

    const [characterArg, , options] = mockSearch.mock.calls[0]
    expect(characterArg).toBe('char-2')
    expect((options as AnyRecord).limit).toBe(5)
  })

  it('defaults the candidate table to 25 rows per path', async () => {
    await runRecallReplay(baseInput())

    expect((mockSearch.mock.calls[0][2] as AnyRecord).limit).toBe(25)
    expect((mockSearch.mock.calls[1][2] as AnyRecord).limit).toBe(25)
  })

  it('excludes staff messages and events from the replay window', async () => {
    primeRepos({
      messages: [
        message('m1', 'USER', 'A question.', '2026-07-20T09:00:00.000Z'),
        { ...message('m2', 'ASSISTANT', 'A whisper.', '2026-07-20T09:00:30.000Z'), systemSender: 'commonplaceBook' },
        { id: 'e1', type: 'event', createdAt: '2026-07-20T09:00:45.000Z' },
        message('m3', 'ASSISTANT', 'A reply.', '2026-07-20T09:01:00.000Z'),
      ],
    })
    mockDistill.mockResolvedValue({ success: false, error: 'no model' })

    const result = await runRecallReplay(baseInput())

    // Falls through to the last *eligible* message, not the whisper or event.
    expect(result.query).toBe('A reply.')
    const [distilled] = mockDistill.mock.calls[0]
    expect((distilled as AnyRecord[]).map((m) => m.content)).toEqual(['A question.', 'A reply.'])
  })
})
