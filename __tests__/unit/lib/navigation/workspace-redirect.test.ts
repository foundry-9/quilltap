/**
 * Old-route → workspace redirect helper.
 *
 * Every legacy per-surface route calls this at the top of its server
 * component. Two things must hold: it is a true no-op when the workspace is
 * disabled (otherwise flipping the flag off would not restore the old routes),
 * and the `?open=` intent it builds must carry the deep-link params through
 * without inventing empty ones.
 */

jest.mock('next/navigation', () => ({
  redirect: jest.fn(() => {
    // Next's redirect throws NEXT_REDIRECT; callers rely on it never returning.
    throw new Error('NEXT_REDIRECT')
  }),
}))

jest.mock('@/lib/config/feature-flags', () => ({
  isWorkspaceTabsEnabled: jest.fn(),
}))

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'
import { redirect } from 'next/navigation'
import { isWorkspaceTabsEnabled } from '@/lib/config/feature-flags'

const mockRedirect = redirect as unknown as jest.Mock
const mockEnabled = isWorkspaceTabsEnabled as jest.Mock

/** Run the helper and hand back the path it redirected to, if any. */
function capture(open: string, params?: Record<string, string | undefined>): string | null {
  try {
    redirectToWorkspaceTab(open, params)
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'NEXT_REDIRECT') throw error
  }
  return mockRedirect.mock.calls.length > 0 ? (mockRedirect.mock.calls[0][0] as string) : null
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEnabled.mockReturnValue(true)
})

describe('redirectToWorkspaceTab', () => {
  it('does nothing at all when the workspace is disabled', () => {
    mockEnabled.mockReturnValue(false)

    // Must return normally — a throw here would break every legacy route.
    expect(() => redirectToWorkspaceTab('salon', { chatId: 'c1' })).not.toThrow()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('redirects with just the open intent when no params are given', () => {
    expect(capture('salon')).toBe('/workspace?open=salon')
  })

  it('carries deep-link params alongside the intent', () => {
    const target = capture('settings', { tab: 'memory', section: 'recall' })

    const params = new URLSearchParams(target!.split('?')[1])
    expect(params.get('open')).toBe('settings')
    expect(params.get('tab')).toBe('memory')
    expect(params.get('section')).toBe('recall')
  })

  it('drops undefined and empty params instead of emitting bare keys', () => {
    // `?chatId=` would read as "open chat with the empty id" downstream.
    const target = capture('salon', { chatId: undefined, tab: '' })

    expect(target).toBe('/workspace?open=salon')
  })

  it('percent-encodes values that would otherwise break the query string', () => {
    const target = capture('scriptorium', { path: 'Notes/A & B.md' })

    const params = new URLSearchParams(target!.split('?')[1])
    expect(params.get('path')).toBe('Notes/A & B.md')
    expect(target).toContain('%26')
  })

  it('lets a param named open override the intent, last write winning', () => {
    // URLSearchParams.set replaces; documenting the behaviour so a caller
    // passing `open` in params is not surprised by a silently ignored value.
    expect(capture('salon', { open: 'aurora' })).toBe('/workspace?open=aurora')
  })
})
