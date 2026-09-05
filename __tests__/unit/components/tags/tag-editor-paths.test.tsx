/**
 * Bug 74 — TagEditor is entity-agnostic and swaps a base path per entity type.
 * The `profile` branch named `/api/v1/profiles/<id>`, a route that has never
 * existed, so every read and write 404'd silently.
 *
 * These assert the URL each entity type actually reaches for, on all three
 * operations, because the component's only contract with the server is that
 * string.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { TagEditor } from '@/components/tags/tag-editor'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
}))

jest.mock('@/components/providers/tag-style-provider', () => ({
  useTagStyles: () => ({ getStyleForTag: () => ({}) }),
}))

const TAG = { id: 'tag-1', name: 'fast-and-cheap' }

function mockFetch() {
  const fetchMock = jest.fn(async (url: string, init?: any) => {
    if (String(url).includes('action=get-tags')) {
      return { ok: true, json: async () => ({ tags: [TAG] }) }
    }
    if (String(url) === '/api/v1/tags' && init?.method === 'POST') {
      return { ok: true, json: async () => ({ tag: TAG }) }
    }
    if (String(url) === '/api/v1/tags') {
      return { ok: true, json: async () => ({ tags: [TAG] }) }
    }
    return { ok: true, json: async () => ({ success: true }) }
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

/** Every URL the component reached for, in order. */
const urls = (m: jest.Mock) => m.mock.calls.map((c) => String(c[0]))

describe('TagEditor entity paths (Bug 74)', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each([
    ['profile', '/api/v1/connection-profiles/entity-1'],
    ['character', '/api/v1/characters/entity-1'],
    ['chat', '/api/v1/chats/entity-1'],
  ] as const)('reads %s tags from %s', async (entityType, base) => {
    const fetchMock = mockFetch()
    render(<TagEditor entityType={entityType} entityId="entity-1" />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(urls(fetchMock)).toContain(`${base}?action=get-tags`)
    // The bug's signature: a path segment that no route serves.
    expect(urls(fetchMock).some((u) => u.startsWith('/api/v1/profiles/'))).toBe(false)
  })

  it('attaches a new tag to the connection-profiles route', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch()
    render(<TagEditor entityType="profile" entityId="entity-1" />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: '+ Add Tag' }))
    await user.type(screen.getByPlaceholderText('Add a tag...'), 'fast-and-cheap')
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(urls(fetchMock)).toContain('/api/v1/connection-profiles/entity-1?action=add-tag')
    )
  })

  it('detaches a tag through the connection-profiles route', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch()
    render(<TagEditor entityType="profile" entityId="entity-1" />)

    await waitFor(() => expect(screen.getByText('fast-and-cheap')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Remove fast-and-cheap tag' }))

    await waitFor(() =>
      expect(urls(fetchMock)).toContain('/api/v1/connection-profiles/entity-1?action=remove-tag')
    )
  })
})
