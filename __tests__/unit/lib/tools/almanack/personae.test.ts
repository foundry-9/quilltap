/**
 * The Almanack's dramatis-personae collector.
 *
 * The interesting logic here is not SQL, it is what happens around it: the
 * ranking and its tie-breaks, and the two cross-database joins (character names
 * for group membership, vault sizes for the top-ten table) that have to be done
 * in application code because the rows live in different databases.
 */

import { collectPersonae } from '@/lib/tools/almanack/phase5-personae'

// Uses global jest (not @jest/globals) for proper SWC mock hoisting

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/tools/almanack/db', () => ({
  mainRows: jest.fn(),
  mountRows: jest.fn(),
  num: (value: unknown) => (typeof value === 'number' ? value : Number(value) || 0),
  // Pure SQL-text helper; the real one keeps the routed fragments intact.
  inClause: jest.requireActual('@/lib/tools/almanack/db').inClause,
}))

import { mainRows, mountRows } from '@/lib/tools/almanack/db'

const mockMainRows = mainRows as jest.MockedFunction<typeof mainRows>
const mockMountRows = mountRows as jest.MockedFunction<typeof mountRows>

/** Route a query to a canned result by matching a distinctive fragment. */
function routeByFragment(routes: Array<[string, unknown[]]>) {
  return (sql: string) => {
    for (const [fragment, rows] of routes) {
      if (sql.includes(fragment)) return rows as never
    }
    return [] as never
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('collectPersonae — top characters', () => {
  function setup(options: {
    characters: Array<{ id: string; name: string; vaultId: string | null }>
    chatCounts: Array<{ characterId: string; chats: number }>
    vaultSizes?: Array<{ id: string; totalSizeBytes: number }>
  }) {
    mockMainRows.mockImplementation(async (sql: string) =>
      routeByFragment([
        ['json_each', options.chatCounts],
        ['FROM "characters" WHERE "userId"', options.characters],
        // No projects, no groups — this describe block is about the ranking.
        ['FROM "projects"', []],
        ['FROM "groups"', []],
      ])(sql),
    )
    mockMountRows.mockImplementation((sql: string) =>
      routeByFragment([['doc_mount_points', options.vaultSizes ?? []]])(sql),
    )
  }

  it('ranks by chat count', async () => {
    setup({
      characters: [
        { id: 'c1', name: 'Bertie', vaultId: null },
        { id: 'c2', name: 'Jeeves', vaultId: null },
        { id: 'c3', name: 'Aunt Agatha', vaultId: null },
      ],
      chatCounts: [
        { characterId: 'c1', chats: 4 },
        { characterId: 'c2', chats: 12 },
        { characterId: 'c3', chats: 1 },
      ],
    })

    const result = await collectPersonae('u1', new Map())

    expect(result.topCharacters.map(c => c.name)).toEqual(['Jeeves', 'Bertie', 'Aunt Agatha'])
  })

  it('breaks chat-count ties on memories', async () => {
    setup({
      characters: [
        { id: 'c1', name: 'Bertie', vaultId: null },
        { id: 'c2', name: 'Jeeves', vaultId: null },
      ],
      chatCounts: [
        { characterId: 'c1', chats: 5 },
        { characterId: 'c2', chats: 5 },
      ],
    })

    const result = await collectPersonae(
      'u1',
      new Map([
        ['c1', 3],
        ['c2', 900],
      ]),
    )

    expect(result.topCharacters.map(c => c.name)).toEqual(['Jeeves', 'Bertie'])
    expect(result.topCharacters[0].memories).toBe(900)
  })

  it('caps the table at ten', async () => {
    const characters = Array.from({ length: 25 }, (_, i) => ({
      id: `c${i}`,
      name: `Character ${i}`,
      vaultId: null,
    }))
    setup({
      characters,
      chatCounts: characters.map((c, i) => ({ characterId: c.id, chats: i })),
    })

    const result = await collectPersonae('u1', new Map())

    expect(result.topCharacters).toHaveLength(10)
    expect(result.topCharacters[0].name).toBe('Character 24')
  })

  it('joins vault sizes from the mount-index database', async () => {
    setup({
      characters: [{ id: 'c1', name: 'Bertie', vaultId: 'vault-1' }],
      chatCounts: [{ characterId: 'c1', chats: 1 }],
      vaultSizes: [{ id: 'vault-1', totalSizeBytes: 4_096 }],
    })

    const result = await collectPersonae('u1', new Map())

    expect(result.topCharacters[0].storageBytes).toBe(4_096)
  })

  it('reports zero storage for a character with no vault', async () => {
    setup({
      characters: [{ id: 'c1', name: 'Bertie', vaultId: null }],
      chatCounts: [{ characterId: 'c1', chats: 1 }],
    })

    const result = await collectPersonae('u1', new Map())

    expect(result.topCharacters[0].storageBytes).toBe(0)
  })

  it('includes characters that have never been in a chat', async () => {
    setup({
      characters: [{ id: 'c1', name: 'Never Cast', vaultId: null }],
      chatCounts: [],
    })

    const result = await collectPersonae('u1', new Map())

    expect(result.topCharacters).toEqual([
      { name: 'Never Cast', chats: 0, memories: 0, storageBytes: 0 },
    ])
  })

  it('excludes help and Brahma chats from the chat count query', async () => {
    setup({ characters: [], chatCounts: [] })

    await collectPersonae('u1', new Map())

    const chatCountCall = mockMainRows.mock.calls.find(call =>
      String(call[0]).includes('json_each'),
    )
    expect(chatCountCall).toBeDefined()
    expect(chatCountCall![1]).toEqual(['u1', 'help', 'brahma'])
  })
})

describe('collectPersonae — groups', () => {
  it('resolves member names across the database boundary', async () => {
    mockMainRows.mockImplementation(async (sql: string) =>
      routeByFragment([
        ['json_each', []],
        ['FROM "characters" WHERE "userId"', []],
        ['FROM "projects"', []],
        ['FROM "groups"', [{ id: 'g1', name: 'The Household', officialMountPointId: 'mp1' }]],
        [
          'FROM "characters"\n       WHERE "id" IN',
          [
            { id: 'c1', name: 'Jeeves' },
            { id: 'c2', name: 'Bertie' },
          ],
        ],
      ])(sql),
    )
    mockMountRows.mockImplementation((sql: string) =>
      routeByFragment([
        [
          'group_character_members',
          [
            { groupId: 'g1', characterId: 'c2' },
            { groupId: 'g1', characterId: 'c1' },
          ],
        ],
        ['group_doc_mount_links', [{ groupId: 'g1', n: 2 }]],
      ])(sql),
    )

    const result = await collectPersonae('u1', new Map())

    expect(result.groups).toEqual([
      {
        name: 'The Household',
        // Sorted for stable rendering, not left in row order.
        members: ['Bertie', 'Jeeves'],
        linkedStores: 2,
        hasOfficialStore: true,
      },
    ])
  })

  it('surfaces a membership row whose character no longer exists', async () => {
    mockMainRows.mockImplementation(async (sql: string) =>
      routeByFragment([
        ['json_each', []],
        ['FROM "characters" WHERE "userId"', []],
        ['FROM "projects"', []],
        ['FROM "groups"', [{ id: 'g1', name: 'Orphans', officialMountPointId: null }]],
        ['FROM "characters"\n       WHERE "id" IN', []],
      ])(sql),
    )
    mockMountRows.mockImplementation((sql: string) =>
      routeByFragment([
        ['group_character_members', [{ groupId: 'g1', characterId: 'ghost' }]],
        ['group_doc_mount_links', []],
      ])(sql),
    )

    const result = await collectPersonae('u1', new Map())

    // A dangling cross-database reference is shown, not silently dropped.
    expect(result.groups[0].members).toEqual(['(missing character)'])
    expect(result.groups[0].hasOfficialStore).toBe(false)
  })
})
