/**
 * Import ordering: document stores must land before group↔store links.
 *
 * `executeImport` created the group's linked-store rows at step 7c but
 * imported document stores last, at step 9. In a mixed archive the link step
 * therefore looked up `idMaps.mountPoints` before `importDocumentStores` had
 * populated it, found nothing, and dropped every link — silently, at debug
 * level. The stores themselves arrived; only the associations vanished.
 *
 * This test drives the real orchestrator over an archive holding both, and
 * asserts the link is made with the *remapped* mount-point id.
 */

import { createMockExportManifest, generateId } from '../fixtures/test-factories'

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}))

// The document-store importer is the unit whose *timing* is under test, not
// its internals — stub it to record the id map it populates.
jest.mock('@/lib/import/quilltap-import/import-document-stores', () => ({
  importDocumentStores: jest.fn(),
}))

import { executeImport } from '@/lib/import/quilltap-import-service'
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory'
import { importDocumentStores } from '@/lib/import/quilltap-import/import-document-stores'

/**
 * A repository stand-in whose every method is an auto-created jest.fn. The
 * orchestrator touches a long tail of repositories irrelevant here.
 */
function repoStub(overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>()
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop]
      if (!cache.has(prop)) cache.set(prop, jest.fn().mockResolvedValue(null))
      return cache.get(prop)
    },
  })
}

describe('executeImport — document stores precede group↔store links', () => {
  const testUserId = generateId()

  const OLD_MOUNT_POINT_ID = 'mp-from-the-other-instance'
  const NEW_MOUNT_POINT_ID = 'mp-freshly-minted-here'

  let groupLink: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()

    groupLink = jest.fn().mockResolvedValue(undefined)
    const groupsRepo = repoStub({
      findById: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(async (data: Record<string, unknown>) => ({ ...data, id: 'group-new' })),
    })
    const userRepos = new Proxy({} as Record<string, unknown>, {
      get(_t, prop: string) {
        if (prop === 'groups') return groupsRepo
        if (prop === 'groupDocMountLinks') return repoStub({ link: groupLink })
        return repoStub()
      },
    })

    ;(getUserRepositories as jest.Mock).mockReturnValue(userRepos)
    ;(getRepositories as jest.Mock).mockReturnValue(
      new Proxy({} as Record<string, unknown>, { get: () => repoStub() })
    )

    // Stand in for the real importer: populate the mount-point id map the way
    // it does, so the link step has something to resolve against.
    ;(importDocumentStores as jest.Mock).mockImplementation(
      async (
        _mountPoints: unknown,
        _folders: unknown,
        _documents: unknown,
        _blobs: unknown,
        _projectLinks: unknown,
        _options: unknown,
        _repos: unknown,
        idMaps: { mountPoints: Map<string, string> }
      ) => {
        idMaps.mountPoints.set(OLD_MOUNT_POINT_ID, NEW_MOUNT_POINT_ID)
        return { mountPoints: 1, folders: 0, documents: 0, blobs: 0, projectLinks: 0 }
      }
    )
  })

  function mixedArchive() {
    return {
      manifest: createMockExportManifest({ exportType: 'groups' }),
      data: {
        groups: [
          {
            id: 'group-old',
            name: 'The Society',
            description: 'A fellowship',
            state: {},
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            _linkedStoreMountPointIds: [OLD_MOUNT_POINT_ID],
          },
        ],
        mountPoints: [
          {
            id: OLD_MOUNT_POINT_ID,
            name: 'Shared Shelf',
            basePath: '',
            mountType: 'database',
            includePatterns: [],
            excludePatterns: [],
            enabled: true,
          },
        ],
      },
    }
  }

  it('links the group to the remapped mount point', async () => {
    const result = await executeImport(testUserId, mixedArchive() as never, {
      conflictStrategy: 'duplicate',
      includeMemories: false,
      includeRelatedEntities: true,
    })

    expect(result.success).toBe(true)
    expect(importDocumentStores).toHaveBeenCalledTimes(1)

    // The link is made, and against the *new* id — not the exporting
    // instance's, which names nothing here.
    expect(groupLink).toHaveBeenCalledTimes(1)
    const [, linkedMountPointId] = groupLink.mock.calls[0]
    expect(linkedMountPointId).toBe(NEW_MOUNT_POINT_ID)
  })

  it('imports the stores before it links them', async () => {
    await executeImport(testUserId, mixedArchive() as never, {
      conflictStrategy: 'duplicate',
      includeMemories: false,
      includeRelatedEntities: true,
    })

    const storesOrder = (importDocumentStores as jest.Mock).mock.invocationCallOrder[0]
    const linkOrder = groupLink.mock.invocationCallOrder[0]
    expect(storesOrder).toBeLessThan(linkOrder)
  })
})
