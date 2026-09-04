/**
 * The wardrobe dialog's per-container dressing-instructions loader/saver.
 *
 * The hook is deliberately un-merged — it shows one container exactly its own
 * `Wardrobe/instructions.md`, because the character > group > project > general
 * cascade is applied server-side only when a character dresses themselves.
 * Showing a merged view here would let a user "edit" text that lives somewhere
 * else and watch the edit vanish.
 *
 * The other load-bearing behaviour is failure: a container whose store is
 * unreachable must settle to `instructions: null, fetched: true` rather than
 * hanging on `loading`, or the editor never opens.
 */

import { act, renderHook, waitFor } from '@testing-library/react'

import { useWardrobeInstructions } from '@/lib/hooks/use-wardrobe-instructions'

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

beforeEach(() => {
  mockFetch.mockReset()
  global.fetch = mockFetch
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('loading', () => {
  it('asks the container\'s own ?action=instructions endpoint', async () => {
    mockFetch.mockResolvedValue(ok({ instructions: 'Dress for the season.' }))

    const { result } = renderHook(() =>
      useWardrobeInstructions({ scope: 'project', id: 'proj-1' })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/projects/proj-1/wardrobe?action=instructions')
    expect(result.current.instructions).toBe('Dress for the season.')
    expect(result.current.loading).toBe(false)
  })

  it('addresses the singleton General container', async () => {
    mockFetch.mockResolvedValue(ok({ instructions: null }))

    const { result } = renderHook(() => useWardrobeInstructions({ scope: 'general', id: null }))

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/wardrobe?action=instructions')
  })

  it('reads an absent file as null', async () => {
    mockFetch.mockResolvedValue(ok({ instructions: null }))

    const { result } = renderHook(() =>
      useWardrobeInstructions({ scope: 'character', id: 'char-1' })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(result.current.instructions).toBeNull()
  })

  it('fetches nothing at all with no container', async () => {
    const { result } = renderHook(() => useWardrobeInstructions(null))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.current.instructions).toBeNull()
    expect(result.current.fetched).toBe(false)
  })

  it('settles rather than hanging when the store is unreachable', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response)

    const { result } = renderHook(() =>
      useWardrobeInstructions({ scope: 'group', id: 'group-1' })
    )

    await waitFor(() => expect(result.current.fetched).toBe(true))
    expect(result.current.instructions).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('re-reads when the container changes — no merged or stale view', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ instructions: 'project text' }))
      .mockResolvedValueOnce(ok({ instructions: 'group text' }))

    const { result, rerender } = renderHook(
      ({ container }) => useWardrobeInstructions(container),
      { initialProps: { container: { scope: 'project' as const, id: 'proj-1' } } }
    )

    await waitFor(() => expect(result.current.instructions).toBe('project text'))

    rerender({ container: { scope: 'group' as never, id: 'group-1' } })

    await waitFor(() => expect(result.current.instructions).toBe('group text'))
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/groups/group-1/wardrobe?action=instructions')
  })
})

describe('saving', () => {
  it('posts the value and adopts what the server answers', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ instructions: null }))
      .mockResolvedValueOnce(ok({ instructions: 'Wear the greatcoat.' }))

    const { result } = renderHook(() =>
      useWardrobeInstructions({ scope: 'project', id: 'proj-1' })
    )
    await waitFor(() => expect(result.current.fetched).toBe(true))

    let saved: boolean | undefined
    await act(async () => {
      saved = await result.current.save('  Wear the greatcoat.  ')
    })

    expect(saved).toBe(true)
    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/v1/projects/proj-1/wardrobe?action=instructions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ instructions: '  Wear the greatcoat.  ' }),
      })
    )
    expect(result.current.instructions).toBe('Wear the greatcoat.')
  })

  it('clears with an explicit null', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ instructions: 'old text' }))
      .mockResolvedValueOnce(ok({ instructions: null }))

    const { result } = renderHook(() =>
      useWardrobeInstructions({ scope: 'general', id: null })
    )
    await waitFor(() => expect(result.current.instructions).toBe('old text'))

    await act(async () => {
      await result.current.save(null)
    })

    expect(result.current.instructions).toBeNull()
  })

  it('reports failure and leaves the loaded value alone', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ instructions: 'old text' }))
      .mockResolvedValueOnce({ ok: false, status: 409 } as Response)

    const { result } = renderHook(() =>
      useWardrobeInstructions({ scope: 'character', id: 'char-1' })
    )
    await waitFor(() => expect(result.current.instructions).toBe('old text'))

    let saved: boolean | undefined
    await act(async () => {
      saved = await result.current.save('new text')
    })

    expect(saved).toBe(false)
    expect(result.current.instructions).toBe('old text')
    expect(result.current.saving).toBe(false)
  })

  it('refuses with no container rather than posting to a guessed URL', async () => {
    const { result } = renderHook(() => useWardrobeInstructions(null))

    let saved: boolean | undefined
    await act(async () => {
      saved = await result.current.save('text')
    })

    expect(saved).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
