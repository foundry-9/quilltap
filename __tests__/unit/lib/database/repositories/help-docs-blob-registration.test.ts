/**
 * Regression: the help_docs `embedding` BLOB column must be registered against
 * whichever backend is current, on every getCollection() — never remembered on
 * the repository instance.
 *
 * Registration lives on the backend (lib/database/backends/sqlite/backend.ts),
 * but a repository is long-lived and can outlive the backend it first ran
 * against (a reconnect, or a dev-server reload). The repository used to set a
 * `blobColumnsRegistered` flag after the first call and skip registration
 * forever after, so a fresh backend was left with no blob handling for
 * help_docs. Both directions then break, silently:
 *
 *   - writes: documentToRow only converts a Float32Array to a Buffer for a
 *     registered blob column, so the embedding fell through to JSON.stringify
 *     and persisted as an index-keyed object (`{"0":..,"1":..}`) of TEXT.
 *   - reads: hydrateRow only applies parseLegacyEmbeddingText to a registered
 *     blob column, so those same rows then failed Zod validation and were
 *     dropped from findAll() — the doc vanished from help entirely.
 *
 * Surfaced when a help-doc content sync rewrote 28 rows on a running server and
 * every one of them disappeared from /api/v1/help-docs.
 *
 * Pins:
 *   - registration is re-asserted on each getCollection(), not cached.
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals'

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

const mockRegisterBlobColumns = jest.fn()
jest.mock('@/lib/database/manager', () => ({
  registerBlobColumns: (...args: unknown[]) => mockRegisterBlobColumns(...args),
  rawQuery: jest.fn(),
  getDatabase: jest.fn(),
  getCollection: jest.fn(() => ({})),
  getDatabaseAsync: jest.fn(async () => ({ getCollection: () => ({}) })),
  ensureCollection: jest.fn(),
}))

import type { HelpDocsRepository as HelpDocsRepositoryType } from '@/lib/database/repositories/help-docs.repository'

let HelpDocsRepository: typeof HelpDocsRepositoryType
beforeAll(async () => {
  ;({ HelpDocsRepository } = await import('@/lib/database/repositories/help-docs.repository'))
})

describe('HelpDocsRepository blob-column registration', () => {
  let repo: HelpDocsRepositoryType

  beforeEach(() => {
    jest.clearAllMocks()
    repo = new HelpDocsRepository()
  })

  /** getCollection is protected; the point of the test is that it registers. */
  const getCollection = (r: HelpDocsRepositoryType): Promise<unknown> =>
    (r as unknown as { getCollection: () => Promise<unknown> }).getCollection()

  it('registers the embedding blob column when a collection is obtained', async () => {
    await getCollection(repo)

    expect(mockRegisterBlobColumns).toHaveBeenCalledWith('help_docs', ['embedding'])
  })

  it('re-asserts registration on every call, so a new backend is never left unregistered', async () => {
    await getCollection(repo)
    await getCollection(repo)
    await getCollection(repo)

    // A cached "already registered" flag would make this 1 and silently corrupt
    // embeddings written through any backend built after the first call.
    expect(mockRegisterBlobColumns).toHaveBeenCalledTimes(3)
  })
})
