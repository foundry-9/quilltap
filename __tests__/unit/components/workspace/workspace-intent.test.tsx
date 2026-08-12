/**
 * WorkspaceIntent applies a transient `?open=` intent — the target the Phase 6
 * old-route redirects point at — opening the right tab (with payload) and then
 * stripping the params back to a clean `/workspace`.
 */

let mockParams = new URLSearchParams()
const mockReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockParams,
}))

const mockOpenNewChat = jest.fn()
jest.mock('@/components/providers/new-chat-provider', () => ({
  useNewChatModalOptional: () => ({ open: mockOpenNewChat }),
}))

import { render, screen } from '@testing-library/react'
import { WorkspaceProvider, useWorkspace } from '@/components/providers/workspace-provider'
import { WorkspaceIntent } from '@/components/workspace/WorkspaceIntent'

function Probe() {
  const { state } = useWorkspace()
  const entries = Object.values(state.tabs)
    .map((t) => {
      const p = (t.payload ?? {}) as {
        characterId?: string
        tab?: string
        projectId?: string
        storeId?: string
        groupId?: string
        chatId?: string
        sessionId?: string
      }
      const id = p.characterId ?? p.projectId ?? p.storeId ?? p.groupId ?? p.chatId ?? ''
      return `${t.kind}:${id}:${p.tab ?? p.sessionId ?? ''}`
    })
    .sort()
  return <div data-testid="tabs">{entries.join('|')}</div>
}

function setup(search: string) {
  mockParams = new URLSearchParams(search)
  mockReplace.mockClear()
  mockOpenNewChat.mockClear()
  return render(
    <WorkspaceProvider>
      <WorkspaceIntent />
      <Probe />
    </WorkspaceProvider>
  )
}

describe('WorkspaceIntent', () => {
  beforeEach(() => window.localStorage.clear())

  it('opens a standalone-page kind from ?open= and strips the params', () => {
    setup('open=profile')
    expect(screen.getByTestId('tabs').textContent).toContain('profile::')
    expect(mockReplace).toHaveBeenCalledWith('/workspace')
  })

  it('opens the character editor with its characterId + tab payload', () => {
    setup('open=character-edit&characterId=abc&tab=system-prompts')
    expect(screen.getByTestId('tabs').textContent).toContain('character-edit:abc:system-prompts')
  })

  it('skips character-edit when the characterId is missing', () => {
    setup('open=character-edit')
    expect(screen.getByTestId('tabs').textContent).not.toContain('character-edit')
  })

  it('ignores an unknown open kind (only the default home tab remains)', () => {
    setup('open=bogus')
    expect(screen.getByTestId('tabs').textContent).toBe('home::')
  })

  it('opens the salon list tab', () => {
    setup('open=salon-list')
    expect(screen.getByTestId('tabs').textContent).toContain('salon-list::')
  })

  it('opens the Prospero tab drilled into a project', () => {
    setup('open=prospero&projectId=p1')
    expect(screen.getByTestId('tabs').textContent).toContain('prospero:p1:')
  })

  it('opens the Scriptorium tab drilled into a store', () => {
    setup('open=scriptorium&storeId=s1')
    expect(screen.getByTestId('tabs').textContent).toContain('scriptorium:s1:')
  })

  it('opens the Aurora tab drilled into a group', () => {
    setup('open=aurora&groupId=g1')
    expect(screen.getByTestId('tabs').textContent).toContain('aurora:g1:')
  })

  it('opens the character detail view with its characterId + tab payload', () => {
    setup('open=character-view&characterId=abc&tab=conversations')
    expect(screen.getByTestId('tabs').textContent).toContain('character-view:abc:conversations')
  })

  it('skips character-view when the characterId is missing', () => {
    setup('open=character-view')
    expect(screen.getByTestId('tabs').textContent).not.toContain('character-view')
  })

  it('opens the conversation plus a child terminal tab for a terminal intent', () => {
    setup('open=terminal&chatId=c1&sessionId=s9')
    const text = screen.getByTestId('tabs').textContent ?? ''
    expect(text).toContain('salon:c1:')
    expect(text).toContain('terminal:c1:s9')
  })

  it('pops the new-chat modal (no tab) for open=new-chat', () => {
    setup('open=new-chat&characterId=abc&autonomous=1')
    expect(mockOpenNewChat).toHaveBeenCalledWith({
      projectId: undefined,
      characterId: 'abc',
      autonomous: true,
    })
    expect(screen.getByTestId('tabs').textContent).toBe('home::')
    expect(mockReplace).toHaveBeenCalledWith('/workspace')
  })

  it('pops the new-chat modal for a character detail ?action=chat deep-link', () => {
    setup('open=character-view&characterId=abc&action=chat')
    expect(screen.getByTestId('tabs').textContent).toContain('character-view:abc:')
    expect(mockOpenNewChat).toHaveBeenCalledWith({ characterId: 'abc' })
  })
})
