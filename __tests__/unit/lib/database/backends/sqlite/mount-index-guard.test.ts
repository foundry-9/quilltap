/**
 * @jest-environment node
 *
 * The gate every mount-index repository opens with.
 *
 * A degraded mount index is a *known-partial* index, and the danger is that it
 * still answers queries — a repository handed a degraded connection reports
 * "no such document" for documents that exist, and the vault writes that follow
 * are lost rather than refused. Throwing is the whole point; the two failure
 * modes are distinguished so an operator reading the log knows whether to
 * repair the index or to initialise it.
 */

import { requireMountIndexDb } from '@/lib/database/backends/sqlite/mount-index-guard'
import {
  getRawMountIndexDatabase,
  isMountIndexDegraded,
} from '@/lib/database/backends/sqlite/mount-index-client'

jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  getRawMountIndexDatabase: jest.fn(),
  isMountIndexDegraded: jest.fn(),
}))

const mockGetRaw = jest.mocked(getRawMountIndexDatabase)
const mockIsDegraded = jest.mocked(isMountIndexDegraded)

describe('requireMountIndexDb', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('hands back the raw connection when the index is healthy', () => {
    const db = { name: 'mount-index' }
    mockIsDegraded.mockReturnValue(false)
    mockGetRaw.mockReturnValue(db as never)

    expect(requireMountIndexDb()).toBe(db)
  })

  it('refuses while the index is degraded', () => {
    mockIsDegraded.mockReturnValue(true)
    mockGetRaw.mockReturnValue({ name: 'mount-index' } as never)

    expect(() => requireMountIndexDb()).toThrow('Mount index database is in degraded mode')
  })

  it('checks degradation before reaching for the connection', () => {
    mockIsDegraded.mockReturnValue(true)

    expect(() => requireMountIndexDb()).toThrow()
    expect(mockGetRaw).not.toHaveBeenCalled()
  })

  it('refuses when the index was never initialized', () => {
    mockIsDegraded.mockReturnValue(false)
    mockGetRaw.mockReturnValue(null as never)

    expect(() => requireMountIndexDb()).toThrow('Mount index database not initialized')
  })
})
