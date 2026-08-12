/**
 * Pascal's Workbench — the library and the destination list.
 *
 * The part with the most ways to be subtly wrong is attachment grouping: the
 * same mount can be a project store AND a group store, a character vault must
 * only list characters that actually have one, and anything unclaimed lands in
 * "other" rather than vanishing.
 */

import { buildCustomToolLibrary, listCustomToolDestinations } from '@/lib/pascal/workbench'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
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

import { getRepositories } from '@/lib/repositories/factory'
import { getGeneralMountPointId } from '@/lib/instance-settings'
import { listDatabaseFiles } from '@/lib/mount-index/database-store'
import { readMountFileBytes } from '@/lib/mount-index/read-file'

const mockGetRepositories = getRepositories as jest.Mock
const mockGetGeneralMountPointId = getGeneralMountPointId as jest.Mock
const mockListDatabaseFiles = listDatabaseFiles as jest.Mock
const mockReadMountFileBytes = readMountFileBytes as jest.Mock

function tool(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    description: `The ${name} tool.`,
    outcomes: [{ when: true, message: 'done', state: 'info' }],
    ...extra,
  }
}

interface World {
  /** Mount id → files. Every mount is an enabled database store. */
  mounts: Record<string, Record<string, unknown>>
  generalId?: string | null
  projects?: Array<{ id: string; name: string; mountPointIds: string[] }>
  groups?: Array<{ id: string; name: string; officialMountPointId?: string | null; mountPointIds?: string[] }>
  characters?: Array<{ id: string; name: string; characterDocumentMountPointId?: string | null }>
}

function primeWorld(world: World) {
  const mountRows = Object.keys(world.mounts).map((id) => ({
    id,
    name: `store-${id}`,
    enabled: true,
    mountType: 'database',
    basePath: '',
  }))

  mockGetGeneralMountPointId.mockResolvedValue(world.generalId ?? null)

  mockGetRepositories.mockReturnValue({
    docMountPoints: {
      findEnabled: jest.fn(async () => mountRows),
      findById: jest.fn(async (id: string) => mountRows.find((m) => m.id === id) ?? null),
    },
    projects: {
      findAll: jest.fn(async () => (world.projects ?? []).map(({ id, name }) => ({ id, name }))),
    },
    projectDocMountLinks: {
      findByProjectId: jest.fn(async (projectId: string) =>
        (world.projects ?? [])
          .filter((p) => p.id === projectId)
          .flatMap((p) => p.mountPointIds.map((mountPointId) => ({ projectId, mountPointId })))
      ),
    },
    groups: {
      findAll: jest.fn(async () =>
        (world.groups ?? []).map(({ id, name, officialMountPointId }) => ({
          id,
          name,
          officialMountPointId: officialMountPointId ?? null,
        }))
      ),
    },
    groupDocMountLinks: {
      findByGroupId: jest.fn(async (groupId: string) =>
        (world.groups ?? [])
          .filter((g) => g.id === groupId)
          .flatMap((g) => (g.mountPointIds ?? []).map((mountPointId) => ({ groupId, mountPointId })))
      ),
    },
    characters: {
      findAllRaw: jest.fn(async () =>
        (world.characters ?? []).map(({ id, name, characterDocumentMountPointId }) => ({
          id,
          name,
          characterDocumentMountPointId: characterDocumentMountPointId ?? null,
        }))
      ),
    },
  })

  mockListDatabaseFiles.mockImplementation(async (mountId: string) =>
    Object.keys(world.mounts[mountId] ?? {}).map((relativePath) => ({
      kind: 'file',
      relativePath,
      fileName: relativePath.split('/').pop(),
    }))
  )

  mockReadMountFileBytes.mockImplementation(async (mountId: string, relativePath: string) => {
    const doc = world.mounts[mountId]?.[relativePath]
    if (doc === undefined) throw new Error(`no such file: ${mountId}/${relativePath}`)
    const content = typeof doc === 'string' ? doc : JSON.stringify(doc)
    return { bytes: Buffer.from(content, 'utf-8'), mimeType: 'application/json', fileType: 'json' }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('buildCustomToolLibrary', () => {
  it('lists every definition in every enabled store, with attachments', async () => {
    primeWorld({
      mounts: {
        'mount-general': { 'Tools/a.tool.json': tool('alpha') },
        'mount-vault': { 'Tools/b.tool.json': tool('beta', { disabled: true }) },
      },
      generalId: 'mount-general',
      characters: [{ id: 'char-1', name: 'Imogen', characterDocumentMountPointId: 'mount-vault' }],
    })

    const library = await buildCustomToolLibrary()

    expect(library.errors).toEqual([])
    expect(library.tools).toHaveLength(2)

    const alpha = library.tools.find((t) => t.name === 'alpha')
    expect(alpha).toMatchObject({
      valid: true,
      title: 'Alpha',
      disabled: false,
      defaultVisibility: 'public',
      rollForm: 'range',
      parameterCount: 0,
      outcomeCount: 1,
      mountPointId: 'mount-general',
      attachments: [{ kind: 'general', label: 'General' }],
    })

    const beta = library.tools.find((t) => t.name === 'beta')
    expect(beta).toMatchObject({
      disabled: true,
      attachments: [{ kind: 'character', id: 'char-1', label: 'Imogen' }],
    })
  })

  it('lists broken files with the loader reason and valid: false', async () => {
    primeWorld({
      mounts: {
        'mount-1': {
          'Tools/bad.tool.json': '{ not json',
          'Tools/good.tool.json': tool('fine'),
        },
      },
    })

    const library = await buildCustomToolLibrary()

    expect(library.tools).toHaveLength(1)
    expect(library.errors).toHaveLength(1)
    expect(library.errors[0]).toMatchObject({
      valid: false,
      definitionPath: 'Tools/bad.tool.json',
      mountPointId: 'mount-1',
      attachments: [{ kind: 'unattached', label: 'Unattached' }],
    })
    expect(library.errors[0].reason).toContain('JSON')
  })

  it('reports dice form and counts for a fuller definition', async () => {
    primeWorld({
      mounts: {
        'mount-1': {
          'Tools/saving.tool.json': tool('saving_throw', {
            title: 'Saving Throw',
            roll: '1d20',
            parameters: { bonus: { type: 'number', default: 0 } },
            outcomes: [
              { when: { gte: 12 }, message: 'saved', state: 'success' },
              { when: true, message: 'failed', state: 'failure' },
            ],
          }),
        },
      },
    })

    const library = await buildCustomToolLibrary()

    expect(library.tools[0]).toMatchObject({
      title: 'Saving Throw',
      rollForm: 'dice',
      parameterCount: 1,
      outcomeCount: 2,
    })
  })

  it('carries a shared mount attachment on every badge kind at once', async () => {
    primeWorld({
      mounts: { 'mount-x': { 'Tools/a.tool.json': tool('alpha') } },
      projects: [{ id: 'proj-1', name: 'Ashfall', mountPointIds: ['mount-x'] }],
      groups: [{ id: 'grp-1', name: 'Night Shift', mountPointIds: ['mount-x'] }],
    })

    const library = await buildCustomToolLibrary()

    expect(library.tools[0].attachments).toEqual([
      { kind: 'group', id: 'grp-1', label: 'Night Shift' },
      { kind: 'project', id: 'proj-1', label: 'Ashfall' },
    ])
  })
})

describe('listCustomToolDestinations', () => {
  it('groups stores by attachment and reports existing tool names', async () => {
    primeWorld({
      mounts: {
        'mount-general': { 'Tools/a.tool.json': tool('alpha') },
        'mount-proj': {},
        'mount-official': { 'Tools/b.tool.json': tool('beta') },
        'mount-vault': {},
        'mount-loose': {},
      },
      generalId: 'mount-general',
      projects: [{ id: 'proj-1', name: 'Ashfall', mountPointIds: ['mount-proj'] }],
      groups: [{ id: 'grp-1', name: 'Night Shift', officialMountPointId: 'mount-official' }],
      characters: [
        { id: 'char-1', name: 'Imogen', characterDocumentMountPointId: 'mount-vault' },
        { id: 'char-2', name: 'Vaultless', characterDocumentMountPointId: null },
      ],
    })

    const destinations = await listCustomToolDestinations()

    expect(destinations.general).toEqual({
      mountPointId: 'mount-general',
      mountName: 'store-mount-general',
      existingToolNames: ['alpha'],
    })

    expect(destinations.projects).toEqual([
      {
        projectId: 'proj-1',
        projectName: 'Ashfall',
        stores: [{ mountPointId: 'mount-proj', mountName: 'store-mount-proj', existingToolNames: [] }],
      },
    ])

    expect(destinations.groups).toEqual([
      {
        groupId: 'grp-1',
        groupName: 'Night Shift',
        stores: [
          {
            mountPointId: 'mount-official',
            mountName: 'store-mount-official',
            official: true,
            existingToolNames: ['beta'],
          },
        ],
      },
    ])

    // Only characters WITH a vault appear.
    expect(destinations.characters).toEqual([
      {
        characterId: 'char-1',
        characterName: 'Imogen',
        mountPointId: 'mount-vault',
        mountName: 'store-mount-vault',
        existingToolNames: [],
      },
    ])

    expect(destinations.other).toEqual([
      { mountPointId: 'mount-loose', mountName: 'store-mount-loose', existingToolNames: [] },
    ])
  })

  it('returns a null general store when unprovisioned', async () => {
    primeWorld({ mounts: { 'mount-loose': {} } })

    const destinations = await listCustomToolDestinations()

    expect(destinations.general).toBeNull()
    expect(destinations.other).toHaveLength(1)
  })

  it('marks group linked stores as unofficial alongside the official one', async () => {
    primeWorld({
      mounts: { 'mount-official': {}, 'mount-linked': {} },
      groups: [
        {
          id: 'grp-1',
          name: 'Night Shift',
          officialMountPointId: 'mount-official',
          mountPointIds: ['mount-linked'],
        },
      ],
    })

    const destinations = await listCustomToolDestinations()

    expect(destinations.groups[0].stores).toEqual([
      expect.objectContaining({ mountPointId: 'mount-official', official: true }),
      expect.objectContaining({ mountPointId: 'mount-linked', official: false }),
    ])
    expect(destinations.other).toEqual([])
  })
})
