/**
 * Home dashboard data service.
 *
 * One payload feeds two surfaces — the server-rendered `/` route and the
 * workspace home tab via `/api/v1/system/home` — so every ordering and cap
 * decision here is what the user actually sees on landing. The parts worth
 * pinning: help chats never leak onto the dashboard, project ordering blends
 * three separate activity clocks, and character ordering is a three-key sort
 * whose tiebreakers are easy to get subtly wrong.
 */

jest.mock('@/lib/api/middleware', () => ({
  enrichWithDefaultImage: jest.fn(),
}))

jest.mock('@/lib/services/chat-enrichment.service', () => ({
  enrichChatsForList: jest.fn(),
  cleanEnrichedChats: jest.fn(),
}))

import { getHomeData } from '@/lib/services/home-data.service'
import { enrichWithDefaultImage } from '@/lib/api/middleware'
import { enrichChatsForList, cleanEnrichedChats } from '@/lib/services/chat-enrichment.service'

const mockEnrichImage = enrichWithDefaultImage as jest.Mock
const mockEnrichChats = enrichChatsForList as jest.Mock
const mockCleanChats = cleanEnrichedChats as jest.Mock

type AnyRecord = Record<string, unknown>

function chat(over: AnyRecord = {}): AnyRecord {
  return {
    id: 'chat-1',
    title: 'A Chat',
    chatType: 'salon',
    projectId: null,
    updatedAt: '2026-07-01T00:00:00.000Z',
    lastMessageAt: '2026-07-01T00:00:00.000Z',
    isDangerousChat: false,
    storyBackground: null,
    participants: [],
    _count: { messages: 3 },
    ...over,
  }
}

function character(over: AnyRecord = {}): AnyRecord {
  return {
    id: 'char-1',
    name: 'Aster',
    title: null,
    defaultImageId: null,
    tags: [],
    isFavorite: false,
    npc: false,
    controlledBy: 'llm',
    defaultConnectionProfileId: null,
    ...over,
  }
}

function project(over: AnyRecord = {}): AnyRecord {
  return {
    id: 'proj-1',
    name: 'A Project',
    description: null,
    color: null,
    icon: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** Build a repos double; `enrichChatsForList` passes the chats straight through. */
function makeRepos(data: {
  user?: AnyRecord | null
  chats?: AnyRecord[]
  projects?: AnyRecord[]
  characters?: AnyRecord[]
  files?: AnyRecord[]
}) {
  return {
    users: { findById: jest.fn(async () => data.user ?? null) },
    chats: { findByUserId: jest.fn(async () => data.chats ?? []) },
    projects: { findAll: jest.fn(async () => data.projects ?? []) },
    characters: { findByUserId: jest.fn(async () => data.characters ?? []) },
    files: { findAll: jest.fn(async () => data.files ?? []) },
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEnrichChats.mockImplementation(async (chats: AnyRecord[]) => chats)
  mockCleanChats.mockImplementation((chats: AnyRecord[]) => chats)
  mockEnrichImage.mockResolvedValue(null)
})

describe('getHomeData — greeting', () => {
  it('prefers the stored user name', async () => {
    const repos = makeRepos({ user: { id: 'u1', name: 'Charlie' } })

    const data = await getHomeData(repos, { userId: 'u1', fallbackName: 'Session Name' })

    expect(data.displayName).toBe('Charlie')
  })

  it('falls back to the supplied name, then to "there"', async () => {
    const noName = await getHomeData(makeRepos({ user: { id: 'u1', name: null } }), {
      userId: 'u1',
      fallbackName: 'Session Name',
    })
    expect(noName.displayName).toBe('Session Name')

    const nothing = await getHomeData(makeRepos({ user: null }), { userId: 'u1' })
    expect(nothing.displayName).toBe('there')
  })

  it('returns an empty dashboard and skips every lookup with no user id', async () => {
    const repos = makeRepos({ chats: [chat()], projects: [project()] })

    const data = await getHomeData(repos, { userId: undefined })

    expect(data).toMatchObject({
      displayName: 'there',
      lastChatId: null,
      recentChats: [],
      projects: [],
      characters: [],
    })
    const spies = repos as never as Record<string, Record<string, jest.Mock>>
    expect(spies.users.findById).not.toHaveBeenCalled()
    expect(spies.chats.findByUserId).not.toHaveBeenCalled()
    expect(spies.projects.findAll).not.toHaveBeenCalled()
    expect(spies.characters.findByUserId).not.toHaveBeenCalled()
    expect(spies.files.findAll).not.toHaveBeenCalled()
  })
})

describe('getHomeData — recent chats', () => {
  it('keeps salon chats and chats with no type, and drops help chats', async () => {
    const repos = makeRepos({
      chats: [
        chat({ id: 'salon' }),
        chat({ id: 'untyped', chatType: undefined }),
        chat({ id: 'help', chatType: 'help' }),
      ],
    })

    const data = await getHomeData(repos, { userId: 'u1' })

    expect(data.recentChats.map((c) => c.id)).toEqual(['salon', 'untyped'])
  })

  it('caps the list at 12 and points "continue last" at the first of them', async () => {
    const chats = Array.from({ length: 20 }, (_, i) => chat({ id: `c${i}` }))

    const data = await getHomeData(makeRepos({ chats }), { userId: 'u1' })

    expect(data.recentChats).toHaveLength(12)
    expect(data.lastChatId).toBe('c0')
  })

  it('reports a null last chat when nothing survives filtering', async () => {
    const data = await getHomeData(makeRepos({ chats: [chat({ chatType: 'help' })] }), {
      userId: 'u1',
    })

    expect(data.lastChatId).toBeNull()
    expect(data.recentChats).toEqual([])
  })

  it('flattens participants and story background into the card shape', async () => {
    const repos = makeRepos({
      chats: [
        chat({
          id: 'c1',
          storyBackground: { filepath: '/files/bg.webp' },
          participants: [
            {
              id: 'p1',
              type: 'CHARACTER',
              isActive: true,
              displayOrder: 0,
              characterId: 'char-1',
              character: {
                id: 'char-1',
                name: 'Aster',
                defaultImageId: 'img-1',
                defaultImage: { id: 'img-1', filepath: '/files/a.webp', url: null },
                tags: ['tag'],
              },
            },
            { id: 'p2', type: 'USER', isActive: true, displayOrder: 1, character: null },
          ],
        }),
      ],
    })

    const [card] = (await getHomeData(repos, { userId: 'u1' })).recentChats

    expect(card.storyBackgroundUrl).toBe('/files/bg.webp')
    expect(card.participants[0].character).toEqual({
      id: 'char-1',
      name: 'Aster',
      defaultImageId: 'img-1',
      defaultImage: { id: 'img-1', filepath: '/files/a.webp', url: undefined },
      tags: ['tag'],
    })
    expect(card.participants[1].character).toBeNull()
    expect(card._count.messages).toBe(3)
  })

  it('reports a null background when the chat has none', async () => {
    const data = await getHomeData(makeRepos({ chats: [chat()] }), { userId: 'u1' })

    expect(data.recentChats[0].storyBackgroundUrl).toBeNull()
  })
})

describe('getHomeData — projects', () => {
  it('counts chats per project and ignores chats with no project', async () => {
    const repos = makeRepos({
      projects: [project({ id: 'p1' }), project({ id: 'p2' })],
      chats: [
        chat({ id: 'a', projectId: 'p1' }),
        chat({ id: 'b', projectId: 'p1' }),
        chat({ id: 'c', projectId: 'p2' }),
        chat({ id: 'd', projectId: null }),
      ],
    })

    const byId = Object.fromEntries(
      (await getHomeData(repos, { userId: 'u1' })).projects.map((p) => [p.id, p.chatCount])
    )

    expect(byId).toEqual({ p1: 2, p2: 1 })
  })

  it('ranks a project by its newest signal, whether that is a chat or a file', async () => {
    const repos = makeRepos({
      projects: [
        project({ id: 'stale-row-fresh-chat', updatedAt: '2026-01-01T00:00:00.000Z' }),
        project({ id: 'stale-row-fresh-file', updatedAt: '2026-01-01T00:00:00.000Z' }),
        project({ id: 'fresh-row-only', updatedAt: '2026-05-01T00:00:00.000Z' }),
      ],
      chats: [
        chat({
          id: 'x',
          projectId: 'stale-row-fresh-chat',
          lastMessageAt: '2026-07-20T00:00:00.000Z',
        }),
      ],
      files: [
        {
          id: 'f',
          projectId: 'stale-row-fresh-file',
          updatedAt: '2026-06-10T00:00:00.000Z',
        },
      ],
    })

    const data = await getHomeData(repos, { userId: 'u1' })

    expect(data.projects.map((p) => p.id)).toEqual([
      'stale-row-fresh-chat', // July chat
      'stale-row-fresh-file', // June file
      'fresh-row-only', // May row
    ])
    expect(data.projects[0].lastActivity).toBe('2026-07-20T00:00:00.000Z')
  })

  it('keeps the project row time when it is newer than any chat or file', async () => {
    const repos = makeRepos({
      projects: [project({ id: 'p1', updatedAt: '2026-07-25T00:00:00.000Z' })],
      chats: [chat({ projectId: 'p1', lastMessageAt: '2026-02-01T00:00:00.000Z' })],
      files: [{ id: 'f', projectId: 'p1', updatedAt: '2026-03-01T00:00:00.000Z' }],
    })

    const [p] = (await getHomeData(repos, { userId: 'u1' })).projects

    expect(p.lastActivity).toBe('2026-07-25T00:00:00.000Z')
  })

  it('tolerates a chat with no lastMessageAt', async () => {
    const repos = makeRepos({
      projects: [project({ id: 'p1', updatedAt: '2026-04-01T00:00:00.000Z' })],
      chats: [chat({ projectId: 'p1', lastMessageAt: null })],
    })

    const [p] = (await getHomeData(repos, { userId: 'u1' })).projects

    expect(p.chatCount).toBe(1)
    expect(p.lastActivity).toBe('2026-04-01T00:00:00.000Z')
  })

  it('caps the project list at 12', async () => {
    const projects = Array.from({ length: 15 }, (_, i) =>
      project({ id: `p${i}`, updatedAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` })
    )

    const data = await getHomeData(makeRepos({ projects }), { userId: 'u1' })

    expect(data.projects).toHaveLength(12)
    // Newest first: p14 down to p3.
    expect(data.projects[0].id).toBe('p14')
  })
})

describe('getHomeData — characters', () => {
  it('excludes NPCs and user-controlled characters', async () => {
    const repos = makeRepos({
      characters: [
        character({ id: 'ai', name: 'Ai' }),
        character({ id: 'npc', name: 'Npc', npc: true }),
        character({ id: 'mine', name: 'Mine', controlledBy: 'user' }),
      ],
    })

    const data = await getHomeData(repos, { userId: 'u1' })

    expect(data.characters.map((c) => c.id)).toEqual(['ai'])
  })

  it('sorts favourites first, then by chat count, then by name', async () => {
    const repos = makeRepos({
      characters: [
        character({ id: 'zed', name: 'Zed' }),
        character({ id: 'busy', name: 'Busy' }),
        character({ id: 'abel', name: 'Abel' }),
        character({ id: 'fav', name: 'Wren', isFavorite: true }),
      ],
      chats: [
        chat({ id: 'c1', participants: [{ characterId: 'busy' }] }),
        chat({ id: 'c2', participants: [{ characterId: 'busy' }] }),
      ],
    })

    const data = await getHomeData(repos, { userId: 'u1' })

    expect(data.characters.map((c) => c.id)).toEqual([
      'fav', // favourite wins outright
      'busy', // 2 chats
      'abel', // 0 chats, alphabetically before Zed
      'zed',
    ])
    expect(data.characters.find((c) => c.id === 'busy')!.chatCount).toBe(2)
  })

  it('breaks name ties without regard to case', async () => {
    const repos = makeRepos({
      characters: [character({ id: 'b', name: 'bertie' }), character({ id: 'a', name: 'Aunt' })],
    })

    const data = await getHomeData(repos, { userId: 'u1' })

    expect(data.characters.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('counts a character once per chat participation, across every chat type', async () => {
    // Chat counts come from allChatsRaw, not the salon-filtered list — a
    // character busy in a help chat is still a busy character.
    const repos = makeRepos({
      characters: [character({ id: 'char-1' })],
      chats: [
        chat({ id: 'c1', participants: [{ characterId: 'char-1' }] }),
        chat({ id: 'c2', chatType: 'help', participants: [{ characterId: 'char-1' }] }),
        chat({ id: 'c3', participants: [{ characterId: null }] }),
      ],
    })

    const data = await getHomeData(repos, { userId: 'u1' })

    expect(data.characters[0].chatCount).toBe(2)
  })

  it('caps the character list at 24', async () => {
    const characters = Array.from({ length: 30 }, (_, i) =>
      character({ id: `c${i}`, name: `Name${String(i).padStart(2, '0')}` })
    )

    const data = await getHomeData(makeRepos({ characters }), { userId: 'u1' })

    expect(data.characters).toHaveLength(24)
  })

  it('resolves the default image through the shared enricher', async () => {
    mockEnrichImage.mockResolvedValue({ id: 'img-7', filepath: '/files/x.webp' })
    const repos = makeRepos({ characters: [character({ defaultImageId: 'img-7' })] })

    const [c] = (await getHomeData(repos, { userId: 'u1' })).characters

    expect(mockEnrichImage).toHaveBeenCalledWith('img-7', repos)
    expect(c.defaultImageId).toBe('img-7')
    expect(c.defaultImage).toEqual({ id: 'img-7', filepath: '/files/x.webp' })
  })

  it('reports a null default image id when the enricher finds nothing', async () => {
    // The id is taken from the *resolved* image, not the raw column, so a
    // dangling reference does not survive into the payload.
    const repos = makeRepos({ characters: [character({ defaultImageId: 'missing' })] })

    const [c] = (await getHomeData(repos, { userId: 'u1' })).characters

    expect(c.defaultImageId).toBeNull()
    expect(c.defaultImage).toBeNull()
  })

  it('defaults the optional character flags', async () => {
    const repos = makeRepos({
      characters: [
        character({ title: undefined, tags: undefined, isFavorite: undefined, npc: undefined }),
      ],
    })

    const [c] = (await getHomeData(repos, { userId: 'u1' })).characters

    expect(c).toMatchObject({ title: null, tags: [], isFavorite: false, npc: false })
  })
})
