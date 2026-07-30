/**
 * Fold-time episode pass.
 *
 * This pass rides the fold cadence, so its first duty is to never damage the
 * fold: every failure path — no chat, no participants, a dead extractor, a
 * per-character write that throws — must return a result rather than throw.
 * Its second duty is the fragment linking, which is union-preserving on both
 * sides; a clobbering write here would quietly sever links the gate had
 * already made.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  extractEpisodesFromFold: jest.fn(),
}))

jest.mock('@/lib/memory/memory-service', () => ({
  createMemoryWithGate: jest.fn(),
}))

jest.mock('@/lib/memory/episodic', () => ({
  resolveWhenPhrase: jest.fn(() => null),
}))

import { runFoldEpisodePass } from '@/lib/memory/fold-episode-pass'
import { getRepositories } from '@/lib/repositories/factory'
import { extractEpisodesFromFold } from '@/lib/memory/cheap-llm-tasks'
import { createMemoryWithGate } from '@/lib/memory/memory-service'
import { resolveWhenPhrase } from '@/lib/memory/episodic'

const mockRepos = getRepositories as jest.Mock
const mockExtract = extractEpisodesFromFold as jest.Mock
const mockGate = createMemoryWithGate as jest.Mock
const mockResolveWhen = resolveWhenPhrase as jest.Mock

type AnyRecord = Record<string, unknown>

const cheapLLM = { provider: 'anthropic', modelName: 'claude-haiku-4-5-20251001' } as never

function message(id: string, over: AnyRecord = {}) {
  return {
    id,
    type: 'message',
    role: 'USER',
    content: `content ${id}`,
    createdAt: '2026-07-20T09:00:00.000Z',
    participantId: 'p-user',
    ...over,
  } as never
}

const WINDOW = [
  message('m1', { participantId: 'p-user', createdAt: '2026-07-20T09:00:00.000Z' }),
  message('m2', {
    role: 'ASSISTANT',
    participantId: 'p-ai',
    createdAt: '2026-07-20T09:05:00.000Z',
  }),
]

function episode(over: AnyRecord = {}) {
  return {
    summary: 'The cellar expedition',
    narrative: 'They went down and found the crates.',
    entities: ['Cellar', 'Crates'],
    importance: 0.7,
    when: null,
    narrativeTime: null,
    ...over,
  }
}

let updateForCharacter: jest.Mock
let findFragments: jest.Mock

function primeRepos(over: { chat?: AnyRecord | null } = {}) {
  updateForCharacter = jest.fn(async () => undefined)
  findFragments = jest.fn(async () => [])

  const chat =
    over.chat === undefined
      ? {
          id: 'chat-1',
          participants: [
            { id: 'p-user', type: 'USER', status: 'active', characterId: null },
            { id: 'p-ai', type: 'CHARACTER', status: 'active', characterId: 'char-1' },
          ],
        }
      : over.chat

  mockRepos.mockReturnValue({
    chats: { findById: jest.fn(async () => chat) },
    characters: { findByIdRaw: jest.fn(async (id: string) => ({ id, name: `Name-${id}` })) },
    memories: {
      findByCharacterAndSourceMessageIds: findFragments,
      updateForCharacter,
    },
  })
}

function input(over: AnyRecord = {}) {
  return {
    chatId: 'chat-1',
    userId: 'u1',
    windowMessages: WINDOW,
    cheapLLM,
    timelineMode: 'realtime',
    projectId: 'proj-1',
    inAutonomousRoom: false,
    ...over,
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  primeRepos()
  mockResolveWhen.mockReturnValue(null)
  mockExtract.mockResolvedValue({ success: true, result: [episode()] })
  mockGate.mockResolvedValue({
    action: 'INSERT',
    memory: { id: 'mem-ep', relatedMemoryIds: [] },
  })
})

describe('runFoldEpisodePass — bail-outs never throw', () => {
  it('returns an empty result for an empty window without calling anything', async () => {
    const result = await runFoldEpisodePass(input({ windowMessages: [] }))

    expect(result).toEqual({ episodesExtracted: 0, memoriesWritten: 0, fragmentsLinked: 0 })
    expect(mockExtract).not.toHaveBeenCalled()
  })

  it('returns an empty result when the chat is gone', async () => {
    primeRepos({ chat: null })

    await expect(runFoldEpisodePass(input())).resolves.toEqual({
      episodesExtracted: 0,
      memoriesWritten: 0,
      fragmentsLinked: 0,
    })
  })

  it('returns an empty result when no character participant is present', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'p-user', type: 'USER', status: 'active', characterId: null },
          { id: 'p-gone', type: 'CHARACTER', status: 'removed', characterId: 'char-9' },
        ],
      },
    })

    const result = await runFoldEpisodePass(input())

    expect(result.episodesExtracted).toBe(0)
    expect(mockExtract).not.toHaveBeenCalled()
  })

  it('swallows an extractor failure', async () => {
    mockExtract.mockResolvedValue({ success: false, error: 'model down' })

    await expect(runFoldEpisodePass(input())).resolves.toMatchObject({ episodesExtracted: 0 })
  })

  it('swallows an extractor that succeeds with nothing to say', async () => {
    mockExtract.mockResolvedValue({ success: true, result: [] })

    const result = await runFoldEpisodePass(input())

    expect(result.episodesExtracted).toBe(0)
    expect(mockGate).not.toHaveBeenCalled()
  })

  it('swallows an outright throw from the repositories', async () => {
    mockRepos.mockImplementation(() => {
      throw new Error('database on fire')
    })

    await expect(runFoldEpisodePass(input())).resolves.toEqual({
      episodesExtracted: 0,
      memoriesWritten: 0,
      fragmentsLinked: 0,
    })
  })

  it('isolates a per-character write failure from the other characters', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'p-a', type: 'CHARACTER', status: 'active', characterId: 'char-a' },
          { id: 'p-b', type: 'CHARACTER', status: 'active', characterId: 'char-b' },
        ],
      },
    })
    mockGate.mockImplementation(async (payload: AnyRecord) => {
      if (payload.characterId === 'char-a') throw new Error('gate exploded')
      return { action: 'INSERT', memory: { id: 'mem-b', relatedMemoryIds: [] } }
    })

    const result = await runFoldEpisodePass(input())

    expect(result.memoriesWritten).toBe(1)
    expect(mockGate).toHaveBeenCalledTimes(2)
  })
})

describe('runFoldEpisodePass — the episode memory', () => {
  it('writes one episodic memory per present character', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'p-a', type: 'CHARACTER', status: 'active', characterId: 'char-a' },
          { id: 'p-b', type: 'CHARACTER', status: 'active', characterId: 'char-b' },
        ],
      },
    })

    const result = await runFoldEpisodePass(input())

    expect(result).toMatchObject({ episodesExtracted: 1, memoriesWritten: 2 })
    expect(mockGate.mock.calls.map((c) => (c[0] as AnyRecord).characterId)).toEqual([
      'char-a',
      'char-b',
    ])
  })

  it('tags the memory as episodic with the retrieval keywords the recall path expects', async () => {
    await runFoldEpisodePass(input())

    const [payload] = mockGate.mock.calls[0]
    expect(payload).toMatchObject({
      kind: 'episodic',
      source: 'AUTO',
      summary: 'The cellar expedition',
      content: 'They went down and found the crates.',
      importance: 0.7,
      entities: ['Cellar', 'Crates'],
      projectId: 'proj-1',
      witnessedContext: 'user_present',
    })
    // Entities are lower-cased into keywords, then the three fixed markers.
    expect((payload as AnyRecord).keywords).toEqual([
      'cellar',
      'crates',
      'past',
      'scope: narrow',
      'history',
    ])
  })

  it('marks an autonomous-room fold as such', async () => {
    await runFoldEpisodePass(input({ inAutonomousRoom: true }))

    expect((mockGate.mock.calls[0][0] as AnyRecord).witnessedContext).toBe('autonomous_room')
  })

  it('anchors the clock to the newest stamped message, not to now', async () => {
    await runFoldEpisodePass(input())

    const [, clock] = mockExtract.mock.calls[0]
    expect(clock).toEqual({ nowIso: '2026-07-20T09:05:00.000Z', timelineMode: 'realtime' })
  })

  it('dates the episode from the window start when the when-phrase does not resolve', async () => {
    mockExtract.mockResolvedValue({ success: true, result: [episode({ when: 'last Tuesday' })] })
    mockResolveWhen.mockReturnValue(null)

    await runFoldEpisodePass(input())

    expect((mockGate.mock.calls[0][0] as AnyRecord).occurredAt).toBe('2026-07-20T09:00:00.000Z')
  })

  it('prefers a resolved when-phrase over the window start', async () => {
    mockExtract.mockResolvedValue({ success: true, result: [episode({ when: 'last Tuesday' })] })
    mockResolveWhen.mockReturnValue('2026-07-14T00:00:00.000Z')

    await runFoldEpisodePass(input())

    expect(mockResolveWhen).toHaveBeenCalledWith('last Tuesday', '2026-07-20T09:05:00.000Z')
    expect((mockGate.mock.calls[0][0] as AnyRecord).occurredAt).toBe('2026-07-14T00:00:00.000Z')
  })

  it('falls back to the when-phrase for narrativeTime only in narrative mode', async () => {
    mockExtract.mockResolvedValue({
      success: true,
      result: [episode({ when: 'the second evening', narrativeTime: null })],
    })

    await runFoldEpisodePass(input({ timelineMode: 'narrative' }))
    expect((mockGate.mock.calls[0][0] as AnyRecord).narrativeTime).toBe('the second evening')

    jest.clearAllMocks()
    primeRepos()
    mockExtract.mockResolvedValue({
      success: true,
      result: [episode({ when: 'the second evening', narrativeTime: null })],
    })
    mockGate.mockResolvedValue({ action: 'INSERT', memory: { id: 'm', relatedMemoryIds: [] } })

    await runFoldEpisodePass(input({ timelineMode: 'realtime' }))
    expect((mockGate.mock.calls[0][0] as AnyRecord).narrativeTime).toBeNull()
  })

  it('renders each message under its speaker name, falling back to a role label', async () => {
    await runFoldEpisodePass(input())

    const [rendered] = mockExtract.mock.calls[0]
    expect(rendered).toEqual([
      { speaker: 'User', content: 'content m1', createdAt: '2026-07-20T09:00:00.000Z' },
      { speaker: 'Name-char-1', content: 'content m2', createdAt: '2026-07-20T09:05:00.000Z' },
    ])
  })

  it.each([
    ['INSERT', 1],
    ['INSERT_RELATED', 1],
    ['SKIP_GATE', 1],
    ['MERGE', 0],
    ['SKIP_DUPLICATE', 0],
  ])('counts a %s gate outcome as %i written', async (action, expected) => {
    mockGate.mockResolvedValue({ action, memory: { id: 'mem-ep', relatedMemoryIds: [] } })

    const result = await runFoldEpisodePass(input())

    expect(result.memoriesWritten).toBe(expected)
  })

  it('skips linking when the gate returns no memory at all', async () => {
    mockGate.mockResolvedValue({ action: 'SKIP_DUPLICATE', memory: null })

    const result = await runFoldEpisodePass(input())

    expect(result.memoriesWritten).toBe(0)
    expect(findFragments).not.toHaveBeenCalled()
  })
})

describe('runFoldEpisodePass — fragment linking', () => {
  it('links the window fragments both ways without clobbering existing links', async () => {
    mockGate.mockResolvedValue({
      action: 'INSERT',
      memory: { id: 'mem-ep', relatedMemoryIds: ['pre-existing'] },
    })
    findFragments.mockResolvedValue([
      { id: 'frag-1', relatedMemoryIds: ['other'] },
      { id: 'frag-2', relatedMemoryIds: [] },
    ])

    const result = await runFoldEpisodePass(input())

    expect(findFragments).toHaveBeenCalledWith('char-1', ['m1', 'm2'])
    // Episode side: prior link preserved, both fragments added.
    expect(updateForCharacter).toHaveBeenCalledWith('char-1', 'mem-ep', {
      relatedMemoryIds: ['pre-existing', 'frag-1', 'frag-2'],
    })
    // Fragment side: each keeps its own prior links.
    expect(updateForCharacter).toHaveBeenCalledWith('char-1', 'frag-1', {
      relatedMemoryIds: ['other', 'mem-ep'],
    })
    expect(updateForCharacter).toHaveBeenCalledWith('char-1', 'frag-2', {
      relatedMemoryIds: ['mem-ep'],
    })
    expect(result.fragmentsLinked).toBe(2)
  })

  it('never links an episode to itself', async () => {
    findFragments.mockResolvedValue([{ id: 'mem-ep', relatedMemoryIds: [] }])

    const result = await runFoldEpisodePass(input())

    expect(result.fragmentsLinked).toBe(0)
    expect(updateForCharacter).not.toHaveBeenCalled()
  })

  it('skips the episode-side write when every fragment is already linked', async () => {
    mockGate.mockResolvedValue({
      action: 'INSERT',
      memory: { id: 'mem-ep', relatedMemoryIds: ['frag-1'] },
    })
    findFragments.mockResolvedValue([{ id: 'frag-1', relatedMemoryIds: ['mem-ep'] }])

    const result = await runFoldEpisodePass(input())

    expect(updateForCharacter).not.toHaveBeenCalled()
    expect(result.fragmentsLinked).toBe(0)
  })

  it('caps fragment links at eight per episode', async () => {
    findFragments.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({ id: `frag-${i}`, relatedMemoryIds: [] }))
    )

    const result = await runFoldEpisodePass(input())

    const episodeWrite = updateForCharacter.mock.calls.find((c) => c[1] === 'mem-ep')
    expect((episodeWrite![2] as AnyRecord).relatedMemoryIds).toHaveLength(8)
    expect(result.fragmentsLinked).toBe(8)
  })

  it('does nothing further when the window produced no fragments', async () => {
    findFragments.mockResolvedValue([])

    const result = await runFoldEpisodePass(input())

    expect(updateForCharacter).not.toHaveBeenCalled()
    expect(result.fragmentsLinked).toBe(0)
  })
})
