/**
 * The shared-container wardrobe loader.
 *
 * Two things here are easy to get subtly wrong and impossible to see when they
 * are:
 *
 *   1. **No tier merging.** `items` is exactly the viewed container's own
 *      `Wardrobe/` folder — that is the editable set, and folding a General
 *      archetype into it would offer an Edit button for a garment living
 *      somewhere else. The character scope belongs to
 *      `useCharacterWardrobeItems`, so this hook must no-op on it.
 *   2. **The resolution pool is not the editable set.** General archetypes are
 *      fetched separately, and *always* with archived ones included, because a
 *      composite may bundle an archived archetype and an unresolvable component
 *      renders as a gap rather than an error.
 */

import { renderHook, waitFor } from '@testing-library/react'

import { useWardrobeContainerItems } from '@/lib/hooks/use-wardrobe-container-items'

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>

function items(...ids: string[]) {
  return ids.map(id => ({ id, name: id }))
}

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

/** Answer each URL from a table, so ordering within Promise.all doesn't matter. */
function routeTo(table: Record<string, unknown>): void {
  mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!(url in table)) throw new Error(`unexpected fetch: ${url}`)
    return ok(table[url])
  })
}

function urlsFetched(): string[] {
  return mockFetch.mock.calls.map(call => String(call[0]))
}

beforeEach(() => {
  mockFetch.mockReset()
  global.fetch = mockFetch
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('which containers it loads', () => {
  it('loads a project store and pairs it with the General pool', async () => {
    routeTo({
      '/api/v1/projects/proj-1/wardrobe': { wardrobeItems: items('own-1', 'own-2') },
      '/api/v1/wardrobe?includeArchived=true': { wardrobeItems: items('general-1') },
    })

    const { result } = renderHook(() =>
      useWardrobeContainerItems({ scope: 'project', id: 'proj-1' })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(result.current.items.map(i => i.id)).toEqual(['own-1', 'own-2'])
    expect(result.current.resolutionItems.map(i => i.id)).toEqual(['own-1', 'own-2', 'general-1'])
  })

  it('loads a group store the same way', async () => {
    routeTo({
      '/api/v1/groups/group-1/wardrobe': { wardrobeItems: items('own-1') },
      '/api/v1/wardrobe?includeArchived=true': { wardrobeItems: items('general-1') },
    })

    const { result } = renderHook(() =>
      useWardrobeContainerItems({ scope: 'group', id: 'group-1' })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(result.current.items.map(i => i.id)).toEqual(['own-1'])
  })

  it('does not fetch General twice when General IS the container', async () => {
    routeTo({ '/api/v1/wardrobe': { wardrobeItems: items('general-1') } })

    const { result } = renderHook(() =>
      useWardrobeContainerItems({ scope: 'general', id: null })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(urlsFetched()).toEqual(['/api/v1/wardrobe'])
    expect(result.current.resolutionItems.map(i => i.id)).toEqual(['general-1'])
  })

  it('no-ops on the character scope — that is useCharacterWardrobeItems\' job', async () => {
    const { result } = renderHook(() =>
      useWardrobeContainerItems({ scope: 'character', id: 'char-1' })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([])
    expect(result.current.fetched).toBe(false)
  })

  it('no-ops with no container', async () => {
    const { result } = renderHook(() => useWardrobeContainerItems(null))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('the resolution pool', () => {
  it('always asks General for archived archetypes, even when the container hides them', async () => {
    routeTo({
      '/api/v1/projects/proj-1/wardrobe': { wardrobeItems: [] },
      '/api/v1/wardrobe?includeArchived=true': { wardrobeItems: items('archived-archetype') },
    })

    const { result } = renderHook(() =>
      useWardrobeContainerItems({ scope: 'project', id: 'proj-1' })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(urlsFetched()).toContain('/api/v1/wardrobe?includeArchived=true')
    expect(result.current.resolutionItems.map(i => i.id)).toEqual(['archived-archetype'])
  })

  it('never double-counts an item present in both lists', async () => {
    routeTo({
      '/api/v1/projects/proj-1/wardrobe': { wardrobeItems: items('shared', 'own') },
      '/api/v1/wardrobe?includeArchived=true': { wardrobeItems: items('shared', 'general') },
    })

    const { result } = renderHook(() =>
      useWardrobeContainerItems({ scope: 'project', id: 'proj-1' })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(result.current.resolutionItems.map(i => i.id)).toEqual(['shared', 'own', 'general'])
  })

  it('keeps the pool out of the editable set', async () => {
    routeTo({
      '/api/v1/projects/proj-1/wardrobe': { wardrobeItems: items('own') },
      '/api/v1/wardrobe?includeArchived=true': { wardrobeItems: items('general') },
    })

    const { result } = renderHook(() =>
      useWardrobeContainerItems({ scope: 'project', id: 'proj-1' })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(result.current.items.map(i => i.id)).toEqual(['own'])
  })

  it('still shows the container when the General pool fails to load', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL) =>
      String(input) === '/api/v1/projects/proj-1/wardrobe'
        ? ok({ wardrobeItems: items('own') })
        : ({ ok: false, status: 500 } as Response)
    )

    const { result } = renderHook(() =>
      useWardrobeContainerItems({ scope: 'project', id: 'proj-1' })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(result.current.items.map(i => i.id)).toEqual(['own'])
    expect(result.current.resolutionItems.map(i => i.id)).toEqual(['own'])
  })
})

describe('includeArchived', () => {
  it('is absent from the container URL unless asked for', async () => {
    routeTo({
      '/api/v1/projects/proj-1/wardrobe': { wardrobeItems: [] },
      '/api/v1/wardrobe?includeArchived=true': { wardrobeItems: [] },
    })

    const { result } = renderHook(() =>
      useWardrobeContainerItems({ scope: 'project', id: 'proj-1' })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(urlsFetched()).toContain('/api/v1/projects/proj-1/wardrobe')
  })

  it('rides the container URL when asked for', async () => {
    routeTo({
      '/api/v1/projects/proj-1/wardrobe?includeArchived=true': { wardrobeItems: [] },
      '/api/v1/wardrobe?includeArchived=true': { wardrobeItems: [] },
    })

    const { result } = renderHook(() =>
      useWardrobeContainerItems({ scope: 'project', id: 'proj-1' }, { includeArchived: true })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(urlsFetched()).toContain('/api/v1/projects/proj-1/wardrobe?includeArchived=true')
  })
})

describe('failure and re-entry', () => {
  it('settles empty rather than hanging when the container is unreachable', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response)

    const { result } = renderHook(() =>
      useWardrobeContainerItems({ scope: 'group', id: 'group-1' })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(result.current.items).toEqual([])
    expect(result.current.resolutionItems).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('re-reads when the container changes', async () => {
    routeTo({
      '/api/v1/projects/proj-1/wardrobe': { wardrobeItems: items('proj') },
      '/api/v1/groups/group-1/wardrobe': { wardrobeItems: items('group') },
      '/api/v1/wardrobe?includeArchived=true': { wardrobeItems: [] },
    })

    const { result, rerender } = renderHook(
      ({ container }) => useWardrobeContainerItems(container),
      { initialProps: { container: { scope: 'project' as const, id: 'proj-1' } } }
    )

    await waitFor(() => expect(result.current.items.map(i => i.id)).toEqual(['proj']))

    rerender({ container: { scope: 'group' as never, id: 'group-1' } })

    await waitFor(() => expect(result.current.items.map(i => i.id)).toEqual(['group']))
  })
})
