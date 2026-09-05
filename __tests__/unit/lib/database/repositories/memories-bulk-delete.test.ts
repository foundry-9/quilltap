/**
 * Unit tests for MemoriesRepository.bulkDelete
 *
 * The method must chunk its `$in` filter: the query translator expands each
 * ID into one bind variable, and a full-wipe cascade (e.g. restoring over an
 * instance with tens of thousands of memories) can exceed
 * SQLITE_MAX_VARIABLE_NUMBER in a single statement. These tests pin the
 * chunked call shapes.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getCollection: jest.fn(),
  getDatabaseAsync: jest.fn(),
  ensureCollection: jest.fn(),
}))

import type { MemoriesRepository as MemoriesRepositoryType } from '@/lib/database/repositories/memories.repository'

let MemoriesRepository: typeof MemoriesRepositoryType
beforeAll(async () => {
  ;({ MemoriesRepository } = await import('@/lib/database/repositories/memories.repository'))
})

describe('MemoriesRepository.bulkDelete', () => {
  let repo: MemoriesRepositoryType

  beforeEach(() => {
    jest.clearAllMocks()
    repo = new MemoriesRepository()
  })

  it('returns 0 without deleting for an empty batch', async () => {
    const deleteManySpy = jest
      .spyOn(repo as any, 'deleteMany')
      .mockImplementation(async () => 0)

    const deleted = await repo.bulkDelete('char-1', [])

    expect(deleted).toBe(0)
    expect(deleteManySpy).not.toHaveBeenCalled()
  })

  it('issues one character-scoped deleteMany for a small batch', async () => {
    const deleteManySpy = jest
      .spyOn(repo as any, 'deleteMany')
      .mockImplementation(async (filter: any) => filter.id.$in.length)

    const deleted = await repo.bulkDelete('char-1', ['a', 'b', 'c'])

    expect(deleted).toBe(3)
    expect(deleteManySpy).toHaveBeenCalledTimes(1)
    expect(deleteManySpy).toHaveBeenCalledWith({
      characterId: 'char-1',
      id: { $in: ['a', 'b', 'c'] },
    })
  })

  it('chunks the $in filter under the SQLite variable limit for large batches', async () => {
    const deleteManySpy = jest
      .spyOn(repo as any, 'deleteMany')
      .mockImplementation(async (filter: any) => filter.id.$in.length)

    const ids = Array.from({ length: 2000 }, (_, i) => `mem-${i}`)
    const deleted = await repo.bulkDelete('char-1', ids)

    expect(deleted).toBe(2000)
    expect(deleteManySpy).toHaveBeenCalledTimes(3)
    const calls = deleteManySpy.mock.calls.map(([filter]: any[]) => filter)
    expect(calls.map(f => f.id.$in.length)).toEqual([900, 900, 200])
    for (const filter of calls) {
      expect(filter.characterId).toBe('char-1')
    }
    // The chunks reassemble to exactly the requested IDs, in order.
    expect(calls.flatMap(f => f.id.$in)).toEqual(ids)
  })
})
