/**
 * Custom tools — the availability gate.
 *
 * Three things here are easy to get subtly wrong and expensive to notice later:
 * the fail-soft asymmetry between the two clauses on a character with no sheet,
 * the fact that a gated-out definition must NOT claim its name (so a farther
 * tier can still deal one), and the ordering against `disabled` — a tombstone
 * only tombstones if its own gate let it into the room.
 */

import { QtapCustomToolSchema, formatDefinitionIssues } from '@/lib/pascal/custom-tool.types'
import { evaluateToolGate, hasToolGate } from '@/lib/pascal/tool-gate'
import { resolveCustomToolRoster } from '@/lib/pascal/custom-tools'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveTieredMountPool: jest.fn(),
}))

jest.mock('@/lib/mount-index/database-store', () => ({
  listDatabaseFiles: jest.fn(),
  readDatabaseDocument: jest.fn(),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
    }
  },
}))

import { getRepositories } from '@/lib/repositories/factory'
import { resolveTieredMountPool } from '@/lib/mount-index/tiered-mount-pool'
import { listDatabaseFiles, readDatabaseDocument } from '@/lib/mount-index/database-store'

const mockGetRepositories = getRepositories as jest.Mock
const mockResolvePool = resolveTieredMountPool as jest.Mock
const mockListDatabaseFiles = listDatabaseFiles as jest.Mock
const mockReadDatabaseDocument = readDatabaseDocument as jest.Mock

type MountFiles = Record<string, Record<string, unknown>>

function tool(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    description: `The ${name} tool.`,
    outcomes: [{ when: true, message: 'done', state: 'info' }],
    ...extra,
  }
}

/** Wire the mocks so each mount id is a database store holding the given files. */
function primeMounts(files: MountFiles, characterMetadata?: Record<string, unknown>) {
  mockGetRepositories.mockReturnValue({
    docMountPoints: {
      findById: jest.fn(async (id: string) =>
        files[id] ? { id, name: `store-${id}`, enabled: true, mountType: 'database', basePath: '' } : null
      ),
    },
    characters: {
      findById: jest.fn(async () => ({ id: 'char1', metadata: characterMetadata ?? {} })),
    },
  })

  mockListDatabaseFiles.mockImplementation(async (mountId: string) =>
    Object.keys(files[mountId] ?? {}).map((relativePath) => ({
      kind: 'file',
      relativePath,
      fileName: relativePath.split('/').pop(),
    }))
  )

  mockReadDatabaseDocument.mockImplementation(async (mountId: string, relativePath: string) => {
    const doc = files[mountId]?.[relativePath]
    if (doc === undefined) throw new Error(`no such file: ${mountId}/${relativePath}`)
    return { content: typeof doc === 'string' ? doc : JSON.stringify(doc) }
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

const baseCtx = { userId: 'u1', chatId: 'c1', characterId: 'char1' }

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

describe('gate schema', () => {
  it('accepts an availableWhen gate on a metadata key', () => {
    const parsed = QtapCustomToolSchema.safeParse(
      tool('reprogram', { availableWhen: { metadata: { toolAbilities: { contains: 'programmable' } } } })
    )
    expect(parsed.success).toBe(true)
  })

  it('accepts a withheldWhen gate', () => {
    const parsed = QtapCustomToolSchema.safeParse(
      tool('reprogram', { withheldWhen: { metadata: { novice: { eq: true } } } })
    )
    expect(parsed.success).toBe(true)
  })

  it('rejects a definition declaring both clauses', () => {
    const parsed = QtapCustomToolSchema.safeParse(
      tool('reprogram', {
        availableWhen: { metadata: { a: { eq: true } } },
        withheldWhen: { metadata: { b: { eq: true } } },
      })
    )
    expect(parsed.success).toBe(false)
    expect(formatDefinitionIssues(parsed.error!)).toMatch(/one way or the other/)
  })

  it('rejects a $param operand — there are no parameters before a run', () => {
    const parsed = QtapCustomToolSchema.safeParse(
      tool('reprogram', {
        parameters: { level: { type: 'number', default: 1 } },
        availableWhen: { metadata: { rank: { gte: { $param: 'level' } } } },
      })
    )
    expect(parsed.success).toBe(false)
  })

  it('rejects a $state operand for the same reason', () => {
    const parsed = QtapCustomToolSchema.safeParse(
      tool('reprogram', {
        availableWhen: { metadata: { rank: { gte: { $state: 'player.rank', fallback: 2 } } } },
      })
    )
    expect(parsed.success).toBe(false)
  })

  it('rejects a gate that tests nothing', () => {
    expect(QtapCustomToolSchema.safeParse(tool('x', { availableWhen: { metadata: {} } })).success).toBe(false)
    expect(QtapCustomToolSchema.safeParse(tool('x', { availableWhen: { metadata: { a: {} } } })).success).toBe(false)
  })

  it('rejects an unknown subject — metadata is the only one a pre-roll test has', () => {
    expect(
      QtapCustomToolSchema.safeParse(tool('x', { availableWhen: { params: { a: { eq: 1 } } } })).success
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------

describe('evaluateToolGate', () => {
  it('reports an ungated definition as available', () => {
    expect(hasToolGate({})).toBe(false)
    expect(evaluateToolGate({}, { anything: true })).toEqual({ available: true })
  })

  it('offers a tool whose availableWhen holds', () => {
    const definition = { availableWhen: { metadata: { toolAbilities: { contains: 'programmable' } } } }
    expect(evaluateToolGate(definition, { toolAbilities: 'programmable, networked' })).toEqual({ available: true })
  })

  it('withholds a tool whose availableWhen fails', () => {
    const definition = { availableWhen: { metadata: { toolAbilities: { contains: 'programmable' } } } }
    expect(evaluateToolGate(definition, { toolAbilities: 'mechanical' })).toEqual({
      available: false,
      withheldBy: 'availableWhen',
    })
  })

  it('ANDs every test in a gate', () => {
    const definition = { availableWhen: { metadata: { rank: { gte: 3 }, cleared: { eq: true } } } }
    expect(evaluateToolGate(definition, { rank: 4, cleared: true }).available).toBe(true)
    expect(evaluateToolGate(definition, { rank: 4, cleared: false }).available).toBe(false)
    expect(evaluateToolGate(definition, { rank: 1, cleared: true }).available).toBe(false)
  })

  it('withholds a tool whose withheldWhen holds', () => {
    const definition = { withheldWhen: { metadata: { novice: { eq: true } } } }
    expect(evaluateToolGate(definition, { novice: true })).toEqual({
      available: false,
      withheldBy: 'withheldWhen',
    })
    expect(evaluateToolGate(definition, { novice: false })).toEqual({ available: true })
  })

  it('treats an absent key fail-soft, which cuts opposite ways for the two clauses', () => {
    // The asymmetry that makes both clauses worth having: a character with no
    // sheet qualifies for nothing and is disqualified by nothing.
    expect(evaluateToolGate({ availableWhen: { metadata: { rank: { gte: 3 } } } }, {}).available).toBe(false)
    expect(evaluateToolGate({ withheldWhen: { metadata: { rank: { gte: 3 } } } }, {}).available).toBe(true)
    expect(evaluateToolGate({ availableWhen: { metadata: { rank: { gte: 3 } } } }, null).available).toBe(false)
  })

  it('declines a test the stored type cannot sustain, rather than throwing', () => {
    const ordering = { availableWhen: { metadata: { rank: { gte: 3 } } } }
    expect(evaluateToolGate(ordering, { rank: 'senior' }).available).toBe(false)
    expect(evaluateToolGate(ordering, { rank: ['a'] }).available).toBe(false)

    const containment = { availableWhen: { metadata: { abilities: { contains: 'programmable' } } } }
    expect(evaluateToolGate(containment, { abilities: 7 }).available).toBe(false)
    expect(evaluateToolGate(containment, { abilities: { list: [] } }).available).toBe(false)
  })

  it('does not treat absence as inequality under neq/ncontains', () => {
    expect(evaluateToolGate({ availableWhen: { metadata: { rank: { neq: 3 } } } }, {}).available).toBe(false)
    expect(evaluateToolGate({ availableWhen: { metadata: { a: { ncontains: 'x' } } } }, {}).available).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

describe('gates in roster resolution', () => {
  it('withholds a gated tool from a character whose sheet does not qualify', async () => {
    primePool({ globalMountPointId: 'm1' })
    primeMounts({
      m1: {
        'Tools/reprogram.tool.json': tool('reprogram', {
          availableWhen: { metadata: { toolAbilities: { contains: 'programmable' } } },
        }),
      },
    })

    const qualified = await resolveCustomToolRoster({ ...baseCtx, metadata: { toolAbilities: 'programmable' } })
    expect([...qualified.tools.keys()]).toEqual(['reprogram'])

    const unqualified = await resolveCustomToolRoster({ ...baseCtx, metadata: { toolAbilities: 'mechanical' } })
    expect([...unqualified.tools.keys()]).toEqual([])
  })

  it('lets a farther tier deal a name a nearer gated definition did not qualify for', async () => {
    // The point of gating-without-claiming: a character's vault holds the
    // variant written for characters like them; the General store holds the
    // plain one everyone else gets.
    primePool({ characterMountPointId: 'vault', globalMountPointId: 'general' })
    primeMounts({
      vault: {
        'Tools/unlock.tool.json': tool('unlock', {
          description: 'The clever version.',
          availableWhen: { metadata: { toolAbilities: { contains: 'programmable' } } },
        }),
      },
      general: { 'Tools/unlock.tool.json': tool('unlock', { description: 'The plain version.' }) },
    })

    const clever = await resolveCustomToolRoster({ ...baseCtx, metadata: { toolAbilities: 'programmable' } })
    expect(clever.tools.get('unlock')?.definition.description).toBe('The clever version.')

    const plain = await resolveCustomToolRoster({ ...baseCtx, metadata: {} })
    expect(plain.tools.get('unlock')?.definition.description).toBe('The plain version.')
    expect(plain.tools.get('unlock')?.tier).toBe('global')
  })

  it('does not let a gated-out tombstone suppress a name', async () => {
    primePool({ characterMountPointId: 'vault', globalMountPointId: 'general' })
    primeMounts({
      vault: {
        'Tools/unlock.tool.json': tool('unlock', {
          disabled: true,
          withheldWhen: { metadata: { novice: { eq: true } } },
        }),
      },
      general: { 'Tools/unlock.tool.json': tool('unlock') },
    })

    // The tombstone's own gate withholds it, so it never gets to tombstone.
    const novice = await resolveCustomToolRoster({ ...baseCtx, metadata: { novice: true } })
    expect([...novice.tools.keys()]).toEqual(['unlock'])

    // Not a novice: the tombstone applies, and the name stays off.
    const veteran = await resolveCustomToolRoster({ ...baseCtx, metadata: { novice: false } })
    expect([...veteran.tools.keys()]).toEqual([])
  })

  it('leaves ungated tools alone whatever the sheet says', async () => {
    primePool({ globalMountPointId: 'm1' })
    primeMounts({ m1: { 'Tools/unlock.tool.json': tool('unlock') } })

    const roster = await resolveCustomToolRoster({ ...baseCtx, metadata: {} })
    expect([...roster.tools.keys()]).toEqual(['unlock'])
  })

  it('fetches the invoker’s sheet when the caller supplied none — but only for a gated roster', async () => {
    primePool({ globalMountPointId: 'm1' })
    primeMounts(
      {
        m1: {
          'Tools/reprogram.tool.json': tool('reprogram', {
            availableWhen: { metadata: { toolAbilities: { contains: 'programmable' } } },
          }),
        },
      },
      { toolAbilities: 'programmable' }
    )

    const roster = await resolveCustomToolRoster(baseCtx)
    expect([...roster.tools.keys()]).toEqual(['reprogram'])
    expect(mockGetRepositories().characters.findById).toHaveBeenCalledWith('char1')
  })

  it('does not read the vault at all when nothing is gated', async () => {
    primePool({ globalMountPointId: 'm1' })
    primeMounts({ m1: { 'Tools/unlock.tool.json': tool('unlock') } }, { toolAbilities: 'programmable' })

    const roster = await resolveCustomToolRoster(baseCtx)
    expect([...roster.tools.keys()]).toEqual(['unlock'])
    expect(mockGetRepositories().characters.findById).not.toHaveBeenCalled()
  })

  it('treats an unreadable vault as an empty sheet rather than losing the roster', async () => {
    primePool({ globalMountPointId: 'm1' })
    primeMounts({
      m1: {
        'Tools/plain.tool.json': tool('plain'),
        'Tools/gated.tool.json': tool('gated', { availableWhen: { metadata: { rank: { gte: 3 } } } }),
        'Tools/open.tool.json': tool('open', { withheldWhen: { metadata: { rank: { gte: 3 } } } }),
      },
    })
    mockGetRepositories().characters.findById.mockRejectedValue(new Error('vault is a smoking ruin'))

    const roster = await resolveCustomToolRoster(baseCtx)
    // Fail-closed for availableWhen, fail-open for withheldWhen — the same
    // reading an empty sheet gets, because that is what this amounts to.
    expect([...roster.tools.keys()].sort()).toEqual(['open', 'plain'])
  })
})
