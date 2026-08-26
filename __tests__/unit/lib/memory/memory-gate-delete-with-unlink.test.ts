/**
 * Unit tests for the memory-deletion chokepoint helpers:
 *   - deleteMemoryWithUnlink (single)
 *   - deleteMemoriesWithUnlinkBatch
 *
 * These verify that the deleted ID is scrubbed from every neighbour's
 * `relatedMemoryIds` *before* the rows are removed.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/database/manager', () => ({
  __esModule: true,
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getDatabaseAsync: jest.fn(),
  initializeDatabase: jest.fn(),
}))

jest.mock('@/lib/embedding/vector-store', () => ({
  getCharacterVectorStore: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class extends Error {},
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    // The real logger exposes `child`; modules that build a scoped logger at
    // import time (the realtime bus, reached through the activity registry)
    // need it present on the mock too.
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}))

const factoryMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
const dbMock = jest.requireMock('@/lib/database/manager') as { rawQuery: jest.Mock }

let deleteMemoryWithUnlink: typeof import('@/lib/memory/memory-gate').deleteMemoryWithUnlink
let deleteMemoriesWithUnlinkBatch: typeof import('@/lib/memory/memory-gate').deleteMemoriesWithUnlinkBatch

interface FakeMemoryRow {
  id: string
  characterId: string
  relatedMemoryIds: string | null
}

function buildRepo(rows: FakeMemoryRow[]) {
  const updates: Array<{ characterId: string; memoryId: string; relatedMemoryIds: string[] }> = []
  const deleted: string[] = []
  const bulkDeleted: Array<{ characterId: string; ids: string[] }> = []

  return {
    updates,
    deleted,
    bulkDeleted,
    repo: {
      memories: {
        findById: jest.fn(async (id: string) => rows.find(r => r.id === id) ?? null),
        delete: jest.fn(async (id: string) => {
          deleted.push(id)
          return true
        }),
        bulkDelete: jest.fn(async (characterId: string, ids: string[]) => {
          bulkDeleted.push({ characterId, ids })
          return ids.length
        }),
        updateForCharacter: jest.fn(async (characterId: string, memoryId: string, patch: { relatedMemoryIds?: string[] }) => {
          updates.push({ characterId, memoryId, relatedMemoryIds: patch.relatedMemoryIds ?? [] })
          return null
        }),
      },
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.isolateModules(() => {
    const gate = require('@/lib/memory/memory-gate')
    deleteMemoryWithUnlink = gate.deleteMemoryWithUnlink
    deleteMemoriesWithUnlinkBatch = gate.deleteMemoriesWithUnlinkBatch
  })
})

describe('deleteMemoryWithUnlink', () => {
  it('scrubs the deleted ID from every neighbour before deleting', async () => {
    // Graph A↔B↔C — we delete B.
    const rows: FakeMemoryRow[] = [
      { id: 'A', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['B']) },
      { id: 'B', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['A', 'C']) },
      { id: 'C', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['B']) },
    ]

    const { repo, updates, deleted } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)

    // LIKE scan returns A and C (rows that contain "B").
    dbMock.rawQuery.mockResolvedValueOnce([rows[0], rows[2]])

    const result = await deleteMemoryWithUnlink('B')
    expect(result).toBe(true)
    expect(updates).toEqual([
      { characterId: 'char-1', memoryId: 'A', relatedMemoryIds: [] },
      { characterId: 'char-1', memoryId: 'C', relatedMemoryIds: [] },
    ])
    expect(deleted).toEqual(['B'])
  })

  it('returns false and touches no neighbours when the memory is gone', async () => {
    const { repo, updates, deleted } = buildRepo([])
    factoryMock.getRepositories.mockReturnValue(repo)

    const result = await deleteMemoryWithUnlink('missing')
    expect(result).toBe(false)
    expect(updates).toEqual([])
    expect(deleted).toEqual([])
    // No LIKE scan should fire when the target doesn't exist.
    expect(dbMock.rawQuery).not.toHaveBeenCalled()
  })

  it('handles cross-character neighbours', async () => {
    const rows: FakeMemoryRow[] = [
      { id: 'X', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['T']) },
      { id: 'T', characterId: 'char-2', relatedMemoryIds: JSON.stringify(['X']) },
    ]
    const { repo, updates } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    dbMock.rawQuery.mockResolvedValueOnce([rows[0]])

    await deleteMemoryWithUnlink('T')

    expect(updates).toEqual([
      { characterId: 'char-1', memoryId: 'X', relatedMemoryIds: [] },
    ])
  })
})

describe('deleteMemoriesWithUnlinkBatch', () => {
  it('scans neighbours once for the whole batch and skips inter-doomed edges', async () => {
    // Graph A↔B↔C↔D. Delete {B, C} together. A and D should be scrubbed; B
    // and C shouldn't churn against each other.
    const rows: FakeMemoryRow[] = [
      { id: 'A', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['B']) },
      { id: 'B', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['A', 'C']) },
      { id: 'C', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['B', 'D']) },
      { id: 'D', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['C']) },
    ]

    const { repo, updates, bulkDeleted } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)

    // First rawQuery: scan all rows with non-empty links.
    dbMock.rawQuery.mockResolvedValueOnce(rows)
    // Second rawQuery: resolve doomed → characterId.
    dbMock.rawQuery.mockResolvedValueOnce([
      { id: 'B', characterId: 'char-1' },
      { id: 'C', characterId: 'char-1' },
    ])

    const deleted = await deleteMemoriesWithUnlinkBatch(['B', 'C'])

    expect(deleted).toBe(2)
    // Only A and D updated; B and C are doomed and skipped.
    expect(updates.map(u => u.memoryId).sort()).toEqual(['A', 'D'])
    const aUpdate = updates.find(u => u.memoryId === 'A')
    const dUpdate = updates.find(u => u.memoryId === 'D')
    expect(aUpdate?.relatedMemoryIds).toEqual([])
    expect(dUpdate?.relatedMemoryIds).toEqual([])
    expect(bulkDeleted).toEqual([{ characterId: 'char-1', ids: ['B', 'C'] }])
  })

  it('returns 0 immediately for an empty batch', async () => {
    const { repo } = buildRepo([])
    factoryMock.getRepositories.mockReturnValue(repo)

    const deleted = await deleteMemoriesWithUnlinkBatch([])
    expect(deleted).toBe(0)
    expect(dbMock.rawQuery).not.toHaveBeenCalled()
  })

  it('groups doomed IDs by character for bulkDelete', async () => {
    const rows: FakeMemoryRow[] = [
      { id: 'X', characterId: 'char-A', relatedMemoryIds: JSON.stringify(['Y']) },
      { id: 'Y', characterId: 'char-B', relatedMemoryIds: JSON.stringify(['X']) },
    ]
    const { repo, bulkDeleted } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    dbMock.rawQuery.mockResolvedValueOnce(rows)
    dbMock.rawQuery.mockResolvedValueOnce([
      { id: 'X', characterId: 'char-A' },
      { id: 'Y', characterId: 'char-B' },
    ])

    await deleteMemoriesWithUnlinkBatch(['X', 'Y'])

    expect(bulkDeleted).toHaveLength(2)
    expect(bulkDeleted.sort((a, b) => a.characterId.localeCompare(b.characterId))).toEqual([
      { characterId: 'char-A', ids: ['X'] },
      { characterId: 'char-B', ids: ['Y'] },
    ])
  })
})
