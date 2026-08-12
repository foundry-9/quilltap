/**
 * The global link interceptor must open tab-equivalent links in place (no
 * navigation) while in the workspace, de-dupe singletons, and never double-handle
 * a link that already prevented default (the rail / recent-chat path).
 */

/* Raw <a> elements are intentional here — they simulate the un-wired links
   (e.g. the Settings footer) the interceptor is meant to catch. */
/* eslint-disable @next/next/no-html-link-for-pages */

jest.mock('next/navigation', () => ({
  usePathname: () => '/workspace',
}))

const mockOpenNewChat = jest.fn()
jest.mock('@/components/providers/new-chat-provider', () => ({
  useNewChatModalOptional: () => ({ open: mockOpenNewChat }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceProvider, useWorkspace } from '@/components/providers/workspace-provider'
import { WorkspaceLinkInterceptor } from '@/components/workspace/WorkspaceLinkInterceptor'

function Probe() {
  const { state } = useWorkspace()
  const kinds = Object.values(state.tabs)
    .map((t) => t.kind)
    .sort()
  return <div data-testid="kinds">{kinds.join(',')}</div>
}

function countKind(kind: string) {
  return screen.getByTestId('kinds').textContent!.split(',').filter((k) => k === kind).length
}

function setup() {
  return render(
    <WorkspaceProvider>
      <WorkspaceLinkInterceptor />
      <Probe />
      <a href="/settings" data-testid="settings">Settings</a>
      <a href="/aurora" data-testid="aurora">Aurora</a>
      <a href="/aurora/new" data-testid="newchar">New character</a>
      <a href="/characters/c1/edit?tab=system-prompts" data-testid="editchar">Edit character</a>
      {/* No tab equivalent (a bare character detail renders in-place inside the
          Aurora tab) → must NOT be intercepted. The onClick prevents jsdom's
          unimplemented-navigation noise. */}
      <a href="/aurora/c1/view" data-testid="viewchar">Character detail</a>
      <a href="/aurora/c1" data-testid="nomap" onClick={(e) => e.preventDefault()}>Bare character detail</a>
      <a href="https://example.com" data-testid="ext" onClick={(e) => e.preventDefault()}>External</a>
      <a href="/salon/new" data-testid="newchat">New chat</a>
      <a href="/salon/new?projectId=p1" data-testid="newchat-proj">New chat in project</a>
      <a href="/salon/new?autonomous=1" data-testid="newroom" onClick={(e) => e.preventDefault()}>New room</a>
    </WorkspaceProvider>
  )
}

describe('WorkspaceLinkInterceptor', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockOpenNewChat.mockClear()
  })

  it('opens a tab-equivalent link in place instead of navigating', () => {
    setup()
    expect(screen.getByTestId('kinds')).toHaveTextContent('home')
    fireEvent.click(screen.getByTestId('settings'))
    expect(countKind('settings')).toBe(1)
    fireEvent.click(screen.getByTestId('aurora'))
    expect(countKind('aurora')).toBe(1)
  })

  it('de-dupes singleton tabs on repeated clicks', () => {
    setup()
    fireEvent.click(screen.getByTestId('settings'))
    fireEvent.click(screen.getByTestId('settings'))
    expect(countKind('settings')).toBe(1)
  })

  it('opens the character creator and editor as tabs', () => {
    setup()
    fireEvent.click(screen.getByTestId('newchar'))
    expect(countKind('character-new')).toBe(1)
    fireEvent.click(screen.getByTestId('editchar'))
    expect(countKind('character-edit')).toBe(1)
    fireEvent.click(screen.getByTestId('viewchar'))
    expect(countKind('character-view')).toBe(1)
  })

  it('leaves links with no tab equivalent (and external links) alone', () => {
    setup()
    const before = screen.getByTestId('kinds').textContent
    fireEvent.click(screen.getByTestId('nomap'))
    fireEvent.click(screen.getByTestId('ext'))
    expect(screen.getByTestId('kinds').textContent).toBe(before)
  })

  it('opens the new-chat modal in place for /salon/new (no tab created)', () => {
    setup()
    fireEvent.click(screen.getByTestId('newchat'))
    expect(mockOpenNewChat).toHaveBeenCalledWith({ projectId: undefined, characterId: undefined, autonomous: false })
    fireEvent.click(screen.getByTestId('newchat-proj'))
    expect(mockOpenNewChat).toHaveBeenLastCalledWith({ projectId: 'p1', characterId: undefined, autonomous: false })
    // No salon tab should have been created by these.
    expect(countKind('salon')).toBe(0)
  })

  it('opens the new-chat modal in autonomous mode for /salon/new?autonomous=1', () => {
    setup()
    fireEvent.click(screen.getByTestId('newroom'))
    expect(mockOpenNewChat).toHaveBeenCalledWith({ projectId: undefined, characterId: undefined, autonomous: true })
  })
})
