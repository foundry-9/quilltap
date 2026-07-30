/**
 * Custom tools — discovery, tier shadowing, and roster resolution.
 *
 * Shadowing is the part of this feature with the most ways to be subtly wrong:
 * a nearer definition must win, a `disabled` tombstone must keep a name off
 * even when a farther tier still defines it, and a same-tier tie must resolve
 * the same way every time or the roster flickers between two stores.
 */

import { resolveCustomToolRoster } from '@/lib/pascal/custom-tools'
import { MAX_ROSTER_SIZE } from '@/lib/pascal/custom-tool.types'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveTieredMountPool: jest.fn(),
}))

jest.mock('@/lib/mount-index/database-store', () => ({
  listDatabaseFiles: jest.fn(),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
    }
  },
}))

jest.mock('@/lib/mount-index/read-file', () => ({
  readMountFileBytes: jest.fn(),
}))

// Definition *contents* must never come off the disk directly — they go through
// the canonical mount reader, whatever kind of store holds them. Booby-trap
// `fs.readFile` so a regression back to raw filesystem access fails loudly
// instead of quietly working on filesystem mounts and nowhere else. Listing is
// a different matter: the `Tools/` folder is read live from disk on purpose.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs')
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readdir: jest.fn(),
      readFile: jest.fn(async () => {
        throw new Error('custom-tool definitions must be read via readMountFileBytes, not fs.readFile')
      }),
    },
  }
})

import { getRepositories } from '@/lib/repositories/factory'
import { resolveTieredMountPool } from '@/lib/mount-index/tiered-mount-pool'
import { listDatabaseFiles } from '@/lib/mount-index/database-store'
import { readMountFileBytes } from '@/lib/mount-index/read-file'
import { promises as fsPromises } from 'fs'

const mockGetRepositories = getRepositories as jest.Mock
const mockResolvePool = resolveTieredMountPool as jest.Mock
const mockListDatabaseFiles = listDatabaseFiles as jest.Mock
const mockReadMountFileBytes = readMountFileBytes as jest.Mock
const mockReaddir = fsPromises.readdir as unknown as jest.Mock

/** Files per mount id: `{ mountId: { 'Tools/x.tool.json': <definition json> } }` */
type MountFiles = Record<string, Record<string, unknown>>

function tool(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    description: `The ${name} tool.`,
    outcomes: [{ when: true, message: 'done', state: 'info' }],
    ...extra,
  }
}

/**
 * Wire the mocks so each mount id is a store holding the given files.
 *
 * Definition bytes always arrive through `readMountFileBytes`, the canonical
 * mount reader — never through a storage-specific call — which is why a
 * `filesystem` mount can be primed here with no disk in sight.
 */
function primeMounts(files: MountFiles, mountType: 'database' | 'filesystem' = 'database') {
  mockGetRepositories.mockReturnValue({
    docMountPoints: {
      findById: jest.fn(async (id: string) =>
        files[id] ? { id, name: `store-${id}`, enabled: true, mountType, basePath: `/stores/${id}` } : null
      ),
    },
  })

  mockListDatabaseFiles.mockImplementation(async (mountId: string) =>
    Object.keys(files[mountId] ?? {}).map((relativePath) => ({
      kind: 'file',
      relativePath,
      fileName: relativePath.split('/').pop(),
    }))
  )

  // Filesystem stores list their `Tools/` folder off the disk; the ids double
  // as base paths so one readdir mock can serve every mount.
  mockReaddir.mockImplementation(async (folder: string) => {
    const mountId = Object.keys(files).find((id) => folder === `/stores/${id}/Tools`)
    if (!mountId) {
      const err = new Error(`ENOENT: no such directory ${folder}`) as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    }
    return Object.keys(files[mountId]).map((relativePath) => ({
      name: relativePath.split('/').pop() as string,
      isFile: () => true,
    }))
  })

  mockReadMountFileBytes.mockImplementation(async (mountId: string, relativePath: string) => {
    const doc = files[mountId]?.[relativePath]
    if (doc === undefined) throw new Error(`no such file: ${mountId}/${relativePath}`)
    const content = typeof doc === 'string' ? doc : JSON.stringify(doc)
    return { bytes: Buffer.from(content, 'utf-8'), mimeType: 'application/json', fileType: 'json' }
  })
}

function primePool(pool: Partial<Record<string, string[] | string | null>>) {
  mockResolvePool.mockResolvedValue({
    characterMountPointId: pool.characterMountPointId ?? null,
    participantMountPointIds: pool.participantMountPointIds ?? [],
    groupMountPointIds: pool.groupMountPointIds ?? [],
    projectMountPointIds: pool.projectMountPointIds ?? [],
    globalMountPointId: pool.globalMountPointId ?? null,
  })
}

const ctx = { userId: 'u1', chatId: 'c1', characterId: 'char1' }

beforeEach(() => {
  jest.clearAllMocks()
})

describe('discovery', () => {
  it('finds a definition in a database-backed store', async () => {
    primePool({ projectMountPointIds: ['m1'] })
    primeMounts({ m1: { 'Tools/unlock.tool.json': tool('unlock') } })

    const roster = await resolveCustomToolRoster(ctx)

    expect([...roster.tools.keys()]).toEqual(['unlock'])
    expect(roster.tools.get('unlock')!.tier).toBe('project')
    expect(roster.tools.get('unlock')!.definitionPath).toBe('Tools/unlock.tool.json')
  })

  it('reads a filesystem-backed store through the canonical mount reader', async () => {
    primePool({ projectMountPointIds: ['m1'] })
    primeMounts({ m1: { 'Tools/unlock.tool.json': tool('unlock') } }, 'filesystem')

    const roster = await resolveCustomToolRoster(ctx)

    expect([...roster.tools.keys()]).toEqual(['unlock'])
    // The reader is asked for a mount-relative path, never an absolute one —
    // the store's boundary check lives inside it, not out here.
    expect(mockReadMountFileBytes).toHaveBeenCalledWith('m1', 'Tools/unlock.tool.json')
    expect(fsPromises.readFile).not.toHaveBeenCalled()
  })

  it("keys a tool by its `name`, not its filename", async () => {
    primePool({ projectMountPointIds: ['m1'] })
    primeMounts({ m1: { 'Tools/lockpicking.tool.json': tool('unlock') } })

    const roster = await resolveCustomToolRoster(ctx)
    expect(roster.tools.has('unlock')).toBe(true)
  })

  it('ignores a nested file — definitions are a flat root-level convention', async () => {
    // listDatabaseFiles filters by PREFIX, so it returns nested paths too.
    primePool({ projectMountPointIds: ['m1'] })
    primeMounts({
      m1: {
        'Tools/live.tool.json': tool('live'),
        'Tools/archive/old.tool.json': tool('old'),
      },
    })

    const roster = await resolveCustomToolRoster(ctx)
    expect([...roster.tools.keys()]).toEqual(['live'])
  })

  it('ignores a file without the .tool.json suffix', async () => {
    primePool({ projectMountPointIds: ['m1'] })
    primeMounts({ m1: { 'Tools/notes.md': tool('notes') } })

    const roster = await resolveCustomToolRoster(ctx)
    expect(roster.tools.size).toBe(0)
  })

  it('skips a disabled mount', async () => {
    primePool({ projectMountPointIds: ['m1'] })
    mockGetRepositories.mockReturnValue({
      docMountPoints: {
        findById: jest.fn(async (id: string) => ({ id, name: 'off', enabled: false, mountType: 'database', basePath: '' })),
      },
    })

    const roster = await resolveCustomToolRoster(ctx)
    expect(roster.tools.size).toBe(0)
    expect(mockListDatabaseFiles).not.toHaveBeenCalled()
  })

  it('returns an empty roster when the pool has no mounts', async () => {
    primePool({})
    primeMounts({})

    const roster = await resolveCustomToolRoster(ctx)
    expect(roster.tools.size).toBe(0)
    expect(roster.errors).toEqual([])
  })
})

describe('load errors', () => {
  it('reports malformed JSON without losing the rest of the store', async () => {
    primePool({ projectMountPointIds: ['m1'] })
    primeMounts({
      m1: {
        'Tools/broken.tool.json': '{ not json at all',
        'Tools/good.tool.json': tool('good'),
      },
    })

    const roster = await resolveCustomToolRoster(ctx)

    // One bad file must not take the roster down with it.
    expect([...roster.tools.keys()]).toEqual(['good'])
    expect(roster.errors).toHaveLength(1)
    expect(roster.errors[0].definitionPath).toBe('Tools/broken.tool.json')
    expect(roster.errors[0].reason).toMatch(/not valid JSON/)
  })

  it('reports a schema violation with a readable reason', async () => {
    primePool({ projectMountPointIds: ['m1'] })
    primeMounts({
      m1: {
        // Final outcome is not a catch-all.
        'Tools/gappy.tool.json': {
          name: 'gappy',
          description: 'Has a coverage gap.',
          outcomes: [{ when: { gt: 0.5 }, message: 'x', state: 'info' }],
        },
      },
    })

    const roster = await resolveCustomToolRoster(ctx)
    expect(roster.tools.size).toBe(0)
    expect(roster.errors[0].reason).toMatch(/catch-all/)
  })

  it('rejects two files in one store claiming the same name', async () => {
    primePool({ projectMountPointIds: ['m1'] })
    primeMounts({
      m1: {
        'Tools/a.tool.json': tool('unlock'),
        'Tools/b.tool.json': tool('unlock'),
      },
    })

    const roster = await resolveCustomToolRoster(ctx)

    // The first wins; the second is an error, not a silent overwrite — within
    // one store there is no tier to break the tie.
    expect(roster.tools.size).toBe(1)
    expect(roster.errors).toHaveLength(1)
    expect(roster.errors[0].reason).toMatch(/already defines/)
  })
})

describe('tier shadowing', () => {
  it('lets a nearer tier win over a farther one', async () => {
    primePool({ characterMountPointId: 'charMount', projectMountPointIds: ['projMount'] })
    primeMounts({
      charMount: { 'Tools/unlock.tool.json': tool('unlock', { description: 'The locksmith’s own.' }) },
      projMount: { 'Tools/unlock.tool.json': tool('unlock', { description: 'The house rule.' }) },
    })

    const roster = await resolveCustomToolRoster(ctx)

    expect(roster.tools.size).toBe(1)
    expect(roster.tools.get('unlock')!.tier).toBe('character')
    expect(roster.tools.get('unlock')!.definition.description).toBe('The locksmith’s own.')
  })

  it('resolves the full precedence chain nearest-first', async () => {
    primePool({
      characterMountPointId: 'c',
      participantMountPointIds: ['p'],
      groupMountPointIds: ['g'],
      projectMountPointIds: ['j'],
      globalMountPointId: 'gl',
    })
    primeMounts({
      c: { 'Tools/a.tool.json': tool('a') },
      p: { 'Tools/a.tool.json': tool('a'), 'Tools/b.tool.json': tool('b') },
      g: { 'Tools/b.tool.json': tool('b'), 'Tools/c.tool.json': tool('c') },
      j: { 'Tools/c.tool.json': tool('c'), 'Tools/d.tool.json': tool('d') },
      gl: { 'Tools/d.tool.json': tool('d'), 'Tools/e.tool.json': tool('e') },
    })

    const roster = await resolveCustomToolRoster(ctx)

    expect(roster.tools.get('a')!.tier).toBe('character')
    expect(roster.tools.get('b')!.tier).toBe('participant')
    expect(roster.tools.get('c')!.tier).toBe('group')
    expect(roster.tools.get('d')!.tier).toBe('project')
    expect(roster.tools.get('e')!.tier).toBe('global')
  })

  it('suppresses an inherited tool via a nearer `disabled` definition', async () => {
    primePool({ characterMountPointId: 'charMount', projectMountPointIds: ['projMount'] })
    primeMounts({
      charMount: { 'Tools/unlock.tool.json': tool('unlock', { disabled: true }) },
      projMount: { 'Tools/unlock.tool.json': tool('unlock') },
    })

    const roster = await resolveCustomToolRoster(ctx)

    // The tombstone must keep the name off the roster entirely — not merely
    // lose to the farther definition.
    expect(roster.tools.has('unlock')).toBe(false)
  })

  it('does not let a `disabled` at a FARTHER tier remove a nearer live tool', async () => {
    primePool({ characterMountPointId: 'charMount', projectMountPointIds: ['projMount'] })
    primeMounts({
      charMount: { 'Tools/unlock.tool.json': tool('unlock') },
      projMount: { 'Tools/unlock.tool.json': tool('unlock', { disabled: true }) },
    })

    const roster = await resolveCustomToolRoster(ctx)
    expect(roster.tools.get('unlock')!.tier).toBe('character')
  })

  it('leaves other tools untouched when one name is disabled', async () => {
    primePool({ characterMountPointId: 'charMount', projectMountPointIds: ['projMount'] })
    primeMounts({
      charMount: { 'Tools/unlock.tool.json': tool('unlock', { disabled: true }) },
      projMount: { 'Tools/unlock.tool.json': tool('unlock'), 'Tools/listen.tool.json': tool('listen') },
    })

    const roster = await resolveCustomToolRoster(ctx)
    expect([...roster.tools.keys()]).toEqual(['listen'])
  })

  it('resolves a same-tier collision deterministically by mount id', async () => {
    primePool({ projectMountPointIds: ['zzz', 'aaa'] })
    primeMounts({
      aaa: { 'Tools/unlock.tool.json': tool('unlock', { description: 'from aaa' }) },
      zzz: { 'Tools/unlock.tool.json': tool('unlock', { description: 'from zzz' }) },
    })

    // Lexicographic by mount id — arbitrary, but stable, so the roster never
    // flickers between two equally-close stores.
    const first = await resolveCustomToolRoster(ctx)
    expect(first.tools.get('unlock')!.definition.description).toBe('from aaa')

    jest.clearAllMocks()
    primePool({ projectMountPointIds: ['aaa', 'zzz'] })
    primeMounts({
      aaa: { 'Tools/unlock.tool.json': tool('unlock', { description: 'from aaa' }) },
      zzz: { 'Tools/unlock.tool.json': tool('unlock', { description: 'from zzz' }) },
    })

    // Pool order must not change the answer.
    const second = await resolveCustomToolRoster(ctx)
    expect(second.tools.get('unlock')!.definition.description).toBe('from aaa')
  })
})

describe('perspective', () => {
  it('passes the invoker through to the pool resolver so the character tier is theirs', async () => {
    primePool({})
    primeMounts({})

    await resolveCustomToolRoster({
      userId: 'u1',
      chatId: 'c1',
      characterId: 'char1',
      characterMountPointId: 'vault1',
      characterIds: ['char1', 'char2'],
      projectId: 'proj1',
    })

    // characterId AND characterMountPointId must both go through: the mount id
    // is a fast path for the vault, but the group tier keys off characterId and
    // silently resolves to [] without it.
    expect(mockResolvePool).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        characterId: 'char1',
        characterMountPointId: 'vault1',
        characterIds: ['char1', 'char2'],
        projectId: 'proj1',
      }),
      expect.objectContaining({ includeParticipants: true })
    )
  })
})

describe('roster cap', () => {
  it('drops the surplus past the cap and reports what it dropped', async () => {
    const files: Record<string, unknown> = {}
    for (let i = 0; i < MAX_ROSTER_SIZE + 3; i++) {
      // Zero-padded so lexicographic order is numeric order.
      files[`Tools/t${String(i).padStart(3, '0')}.tool.json`] = tool(`t${String(i).padStart(3, '0')}`)
    }
    primePool({ projectMountPointIds: ['m1'] })
    primeMounts({ m1: files })

    const roster = await resolveCustomToolRoster(ctx)

    expect(roster.tools.size).toBe(MAX_ROSTER_SIZE)
    // Never truncate silently — a missing tool with no explanation reads as a
    // bug rather than a cap the user can act on.
    expect(roster.droppedForCap).toHaveLength(3)
  })
})
