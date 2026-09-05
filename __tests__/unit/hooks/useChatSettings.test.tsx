/**
 * Focused tests for useChatSettings' optimistic-update path after the SWR ->
 * TanStack Query migration. The hook's ~30 mutation handlers write the
 * server-returned settings straight into the cache without revalidating (the
 * old `mutate(updated, false)`), now backed by `queryClient.setQueryData`.
 * This guards that behaviour: the optimistic value lands and no extra GET fires.
 */

import React from 'react'
import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '../../helpers/renderWithQuery'
import { AvatarDisplayProvider } from '@/components/providers/avatar-display-provider'
import { useChatSettings } from '@/components/settings/chat-settings/hooks/useChatSettings'
import type { ChatSettings } from '@/components/settings/chat-settings/types'

const initialSettings = { composerSpellcheck: false } as unknown as ChatSettings

function countSettingsGets(mock: jest.Mock): number {
  return mock.mock.calls.filter(
    ([url, init]: [string, RequestInit | undefined]) =>
      url === '/api/v1/settings/chat' && (!init || init.method === undefined)
  ).length
}

describe('useChatSettings — optimistic update', () => {
  const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>
  let wrapper: React.FC<{ children: React.ReactNode }>

  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/v1/settings/chat' && method === 'GET') {
        return Promise.resolve({ ok: true, json: async () => initialSettings } as Response)
      }
      if (url === '/api/v1/settings/chat' && method === 'PUT') {
        const body = init?.body ? JSON.parse(init.body as string) : {}
        return Promise.resolve({ ok: true, json: async () => ({ ...initialSettings, ...body }) } as Response)
      }
      // connection/embedding/image profile endpoints
      return Promise.resolve({ ok: true, json: async () => ({ profiles: [] }) } as Response)
    })

    // One client for the whole render (a per-render client would reset the cache).
    const client = createTestQueryClient()
    wrapper = ({ children }) => (
      <QueryClientProvider client={client}>
        <AvatarDisplayProvider>{children}</AvatarDisplayProvider>
      </QueryClientProvider>
    )
  })

  it('applies the server-returned value optimistically without a revalidating GET', async () => {
    const { result } = renderHook(() => useChatSettings(), { wrapper })

    await waitFor(() => expect(result.current.settings).not.toBeNull())
    expect(result.current.settings?.composerSpellcheck).toBe(false)

    const getsBefore = countSettingsGets(mockFetch)

    await act(async () => {
      await result.current.handleComposerSpellcheckChange(true)
    })

    // Optimistic write landed...
    expect(result.current.settings?.composerSpellcheck).toBe(true)
    // ...and no extra GET to settings/chat was issued (no revalidation).
    expect(countSettingsGets(mockFetch)).toBe(getsBefore)
  })

  it.each([
    ['handleImageDescriptionProfileChange', 'imageDescriptionProfileId'],
    ['handleUncensoredImageDescriptionProfileChange', 'uncensoredImageDescriptionProfileId'],
  ] as const)('%s PUTs the profile and applies the response without a revalidating GET', async (handler, field) => {
    const { result } = renderHook(() => useChatSettings(), { wrapper })

    await waitFor(() => expect(result.current.settings).not.toBeNull())
    const getsBefore = countSettingsGets(mockFetch)

    await act(async () => {
      await result.current[handler]('profile-1')
    })

    const put = mockFetch.mock.calls.find(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === '/api/v1/settings/chat' && init?.method === 'PUT'
    )
    expect(put).toBeDefined()
    expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({ [field]: 'profile-1' })
    expect((result.current.settings as unknown as Record<string, unknown>)?.[field]).toBe('profile-1')
    expect(countSettingsGets(mockFetch)).toBe(getsBefore)
  })
})
