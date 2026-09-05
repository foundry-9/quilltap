/**
 * Unit tests for lib/mount-index/document-text-search.ts
 *
 * The keyword (substring) search behind the global search bar's Documents
 * chip. The SQL lives in the repositories and is mocked here; what these
 * tests pin down is the scope decision (which stores are searched), the
 * merge/ranking of name hits over content hits, snippet shaping, and the
 * name-vs-UUID store reference.
 */

import { searchDocumentText } from '@/lib/mount-index/document-text-search'
import { getRepositories } from '@/lib/repositories/factory'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>

function store(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mp-1',
    name: 'Library',
    enabled: true,
    storeType: 'documents',
    mountType: 'database',
    ...overrides,
  }
}

function nameHit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    mountPointId: 'mp-1',
    relativePath: 'Notes/manifesto.md',
    fileName: 'manifesto.md',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function contentHit(overrides: Record<string, unknown> = {}) {
  return {
    linkId: 'link-2',
    mountPointId: 'mp-1',
    relativePath: 'Notes/other.md',
    fileName: 'other.md',
    updatedAt: '2026-07-01T00:00:00.000Z',
    chunkIndex: 0,
    content: 'A passing mention of the manifesto, buried in prose.',
    headingContext: null,
    ...overrides,
  }
}

interface RepoOverrides {
  stores?: unknown[]
  nameHits?: unknown[]
  contentHits?: unknown[]
  characters?: unknown[]
  charactersThrow?: boolean
}

function makeRepos(overrides: RepoOverrides = {}) {
  const repos = {
    docMountPoints: {
      findEnabled: jest.fn(async () => overrides.stores ?? [store()]),
    },
    docMountFileLinks: {
      searchByNameOrPath: jest.fn(async () => overrides.nameHits ?? []),
    },
    docMountChunks: {
      searchContent: jest.fn(async () => overrides.contentHits ?? []),
    },
    characters: {
      findAllRaw: jest.fn(async () => {
        if (overrides.charactersThrow) throw new Error('characters table unreadable')
        return overrides.characters ?? []
      }),
    },
  }
  mockGetRepositories.mockReturnValue(repos as never)
  return repos
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('searchDocumentText — scope', () => {
  it('searches every enabled store, character vaults included', async () => {
    const repos = makeRepos({
      stores: [store(), store({ id: 'mp-vault', name: 'Rosalind', storeType: 'character' })],
      characters: [
        { id: 'char-1', archivedAt: null, characterDocumentMountPointId: 'mp-vault' },
      ],
    })

    await searchDocumentText('manifesto')

    expect(repos.docMountFileLinks.searchByNameOrPath).toHaveBeenCalledWith(
      'manifesto',
      ['mp-1', 'mp-vault'],
      expect.any(Number)
    )
    expect(repos.docMountChunks.searchContent).toHaveBeenCalledWith(
      'manifesto',
      ['mp-1', 'mp-vault'],
      expect.any(Number)
    )
  })

  it('excludes the vaults of archived characters', async () => {
    const repos = makeRepos({
      stores: [store(), store({ id: 'mp-vault', name: 'Rosalind', storeType: 'character' })],
      characters: [
        {
          id: 'char-1',
          archivedAt: '2026-06-01T00:00:00.000Z',
          characterDocumentMountPointId: 'mp-vault',
        },
      ],
    })

    await searchDocumentText('manifesto')

    expect(repos.docMountFileLinks.searchByNameOrPath).toHaveBeenCalledWith(
      'manifesto',
      ['mp-1'],
      expect.any(Number)
    )
  })

  it('honours caller-supplied exclusions', async () => {
    const repos = makeRepos({
      stores: [store(), store({ id: 'mp-2', name: 'Archive' })],
    })

    await searchDocumentText('manifesto', { excludeMountPointIds: ['mp-2'] })

    expect(repos.docMountFileLinks.searchByNameOrPath).toHaveBeenCalledWith(
      'manifesto',
      ['mp-1'],
      expect.any(Number)
    )
  })

  it('fails closed — drops every character vault when the archived set is unreadable', async () => {
    const repos = makeRepos({
      stores: [store(), store({ id: 'mp-vault', name: 'Rosalind', storeType: 'character' })],
      charactersThrow: true,
    })

    await searchDocumentText('manifesto')

    expect(repos.docMountFileLinks.searchByNameOrPath).toHaveBeenCalledWith(
      'manifesto',
      ['mp-1'],
      expect.any(Number)
    )
  })

  it('does no work when every store is out of scope', async () => {
    const repos = makeRepos({ stores: [] })

    const { results, totalCount } = await searchDocumentText('manifesto')

    expect(results).toEqual([])
    expect(totalCount).toBe(0)
    expect(repos.docMountFileLinks.searchByNameOrPath).not.toHaveBeenCalled()
    expect(repos.docMountChunks.searchContent).not.toHaveBeenCalled()
  })

  it('returns nothing for an empty query without touching the stores', async () => {
    const repos = makeRepos()

    const { results } = await searchDocumentText('   ')

    expect(results).toEqual([])
    expect(repos.docMountPoints.findEnabled).not.toHaveBeenCalled()
  })
})

describe('searchDocumentText — matching and ranking', () => {
  it('gives an exact file-name match priority 0 and a substring match priority 1', async () => {
    makeRepos({
      nameHits: [
        nameHit(),
        nameHit({ id: 'link-3', fileName: 'manifesto', relativePath: 'manifesto' }),
      ],
    })

    const { results } = await searchDocumentText('manifesto')

    expect(results.map((r) => [r.linkId, r.matchPriority])).toEqual([
      ['link-3', 0],
      ['link-1', 1],
    ])
  })

  it('reports a path-only hit as a relativePath match', async () => {
    makeRepos({
      nameHits: [nameHit({ relativePath: 'Manifesto/loose-ends.md', fileName: 'loose-ends.md' })],
    })

    const { results } = await searchDocumentText('manifesto')

    expect(results[0].matchedField).toBe('relativePath')
    expect(results[0].matchedValue).toBe('Manifesto/loose-ends.md')
  })

  it('ranks content hits below name hits and sorts equals by recency', async () => {
    makeRepos({
      nameHits: [nameHit()],
      contentHits: [
        contentHit(),
        contentHit({ linkId: 'link-9', updatedAt: '2026-08-20T00:00:00.000Z' }),
      ],
    })

    const { results, totalCount } = await searchDocumentText('manifesto')

    expect(results.map((r) => r.linkId)).toEqual(['link-1', 'link-9', 'link-2'])
    expect(results.map((r) => r.matchPriority)).toEqual([1, 2, 2])
    expect(totalCount).toBe(3)
  })

  it('keeps one result per document — a name hit shadows the same document’s content hit', async () => {
    makeRepos({
      nameHits: [nameHit()],
      contentHits: [contentHit({ linkId: 'link-1' })],
    })

    const { results, totalCount } = await searchDocumentText('manifesto')

    expect(totalCount).toBe(1)
    expect(results[0].matchedField).toBe('fileName')
  })

  it('slices to the requested limit but reports the full match count', async () => {
    makeRepos({
      contentHits: [
        contentHit({ linkId: 'a' }),
        contentHit({ linkId: 'b' }),
        contentHit({ linkId: 'c' }),
      ],
    })

    const { results, totalCount } = await searchDocumentText('manifesto', { limit: 2 })

    expect(results).toHaveLength(2)
    expect(totalCount).toBe(3)
  })

  it('drops hits from a store that is no longer in scope', async () => {
    makeRepos({
      nameHits: [nameHit({ mountPointId: 'mp-gone' })],
    })

    const { results } = await searchDocumentText('manifesto')

    expect(results).toEqual([])
  })
})

describe('searchDocumentText — snippets', () => {
  it('centres the snippet on the match and marks the trim', async () => {
    const prose = `${'lorem ipsum '.repeat(30)}manifesto${' dolor sit '.repeat(30)}`
    makeRepos({ contentHits: [contentHit({ content: prose })] })

    const { results } = await searchDocumentText('manifesto')

    expect(results[0].snippet).toContain('manifesto')
    expect(results[0].snippet.startsWith('...')).toBe(true)
    expect(results[0].snippet.endsWith('...')).toBe(true)
    expect(results[0].snippet.length).toBeLessThan(250)
  })

  it('prefixes the heading context when the chunk carries one', async () => {
    makeRepos({
      contentHits: [contentHit({ headingContext: 'Chapter II' })],
    })

    const { results } = await searchDocumentText('manifesto')

    expect(results[0].snippet.startsWith('Chapter II — ')).toBe(true)
  })

  it('uses the path as the snippet for a name-only match', async () => {
    makeRepos({ nameHits: [nameHit()] })

    const { results } = await searchDocumentText('manifesto')

    expect(results[0].snippet).toBe('Notes/manifesto.md')
  })
})

describe('searchDocumentText — store reference', () => {
  it('addresses a store by name when the name is unambiguous', async () => {
    makeRepos({ nameHits: [nameHit()] })

    const { results } = await searchDocumentText('manifesto')

    expect(results[0].mountPointRef).toBe('Library')
    expect(results[0].mountPointName).toBe('Library')
  })

  it('falls back to the UUID when two enabled stores share a name', async () => {
    makeRepos({
      stores: [store(), store({ id: 'mp-2', name: 'library' })],
      nameHits: [nameHit()],
    })

    const { results } = await searchDocumentText('manifesto')

    expect(results[0].mountPointRef).toBe('mp-1')
  })

  it('falls back to the UUID when the name collides with a reserved authority', async () => {
    makeRepos({
      stores: [store({ name: 'self' })],
      nameHits: [nameHit()],
    })

    const { results } = await searchDocumentText('manifesto')

    expect(results[0].mountPointRef).toBe('mp-1')
    expect(results[0].mountPointName).toBe('self')
  })

  it('carries the store type through so a vault result can say so', async () => {
    makeRepos({
      stores: [store({ id: 'mp-vault', name: 'Rosalind', storeType: 'character' })],
      nameHits: [nameHit({ mountPointId: 'mp-vault' })],
    })

    const { results } = await searchDocumentText('manifesto')

    expect(results[0].storeType).toBe('character')
  })
})
