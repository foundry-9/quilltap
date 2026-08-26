/**
 * Unit tests for lib/hooks/use-open-document-from-search.ts
 *
 * The branch that decides where a clicked document result lands: in the
 * focused Salon (chat-visible, Librarian announces it), in a standalone tab
 * (silent), or via a URL push outside the workspace shell. Modified clicks are
 * left to the browser so the anchor's own standalone href wins.
 */

import { renderHook } from '@testing-library/react'
import {
  resolveActiveSalon,
  useOpenDocumentFromSearch,
} from '@/lib/hooks/use-open-document-from-search'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { usePathname, useRouter } from 'next/navigation'
import { openDocumentInChat } from '@/lib/documents/open-document-in-chat'
import type { DocumentSearchResultItem } from '@/components/search/types'
import type { WorkspaceState } from '@/lib/workspace/types'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(),
}))

jest.mock('@/components/providers/workspace-provider', () => ({
  useWorkspaceOptional: jest.fn(),
}))

jest.mock('@/lib/documents/open-document-in-chat', () => ({
  openDocumentInChat: jest.fn(),
}))

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
}))

const mockPathname = usePathname as jest.MockedFunction<typeof usePathname>
const mockRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockWorkspace = useWorkspaceOptional as jest.MockedFunction<typeof useWorkspaceOptional>
const mockOpenInChat = openDocumentInChat as jest.MockedFunction<typeof openDocumentInChat>

const result: DocumentSearchResultItem = {
  id: 'link-1',
  type: 'documents',
  name: 'manifesto.md',
  matchedField: 'fileName',
  matchedValue: 'manifesto.md',
  snippet: 'Notes/manifesto.md',
  url: '/workspace?open=document-standalone&scope=document_store&mountPoint=Library&filePath=Notes%2Fmanifesto.md',
  matchPriority: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  mountPointId: 'mp-1',
  mountPointName: 'Library',
  mountPointRef: 'Library',
  storeType: 'documents',
  relativePath: 'Notes/manifesto.md',
}

function salonState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    tabs: {
      't-salon': { id: 't-salon', kind: 'salon', payload: { chatId: 'chat-1' } },
      't-home': { id: 't-home', kind: 'home' },
    },
    panes: {
      left: { order: ['t-salon'], activeTabId: 't-salon' },
      right: { order: ['t-home'], activeTabId: 't-home' },
    },
    focusedPane: 'left',
    ...overrides,
  } as WorkspaceState
}

function clickEvent(overrides: Record<string, unknown> = {}) {
  const event = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: jest.fn(function (this: { defaultPrevented: boolean }) {
      event.defaultPrevented = true
    }),
    ...overrides,
  }
  return event as unknown as React.MouseEvent & { preventDefault: jest.Mock; defaultPrevented: boolean }
}

const push = jest.fn()
const openTab = jest.fn(() => 'tab-id')

beforeEach(() => {
  jest.clearAllMocks()
  mockRouter.mockReturnValue({ push } as never)
  mockOpenInChat.mockResolvedValue(undefined)
})

// ============================================================================
// The pure resolver
// ============================================================================

describe('resolveActiveSalon', () => {
  it('picks the focused pane’s active Salon tab', () => {
    expect(resolveActiveSalon(salonState(), '/workspace')).toEqual({
      chatId: 'chat-1',
      tabId: 't-salon',
    })
  })

  it('ignores a Salon idling in the unfocused pane', () => {
    const state = salonState({ focusedPane: 'right' } as Partial<WorkspaceState>)
    expect(resolveActiveSalon(state, '/workspace')).toBeNull()
  })

  it('ignores a focused non-Salon tab even when a Salon is open elsewhere', () => {
    const state = salonState()
    state.panes.left.activeTabId = 't-home'
    state.panes.left.order = ['t-home', 't-salon']
    expect(resolveActiveSalon(state, '/workspace')).toBeNull()
  })

  it('falls back to the /salon/[id] pathname outside the workspace', () => {
    expect(resolveActiveSalon(null, '/salon/chat-9')).toEqual({
      chatId: 'chat-9',
      tabId: null,
    })
  })

  it('is null on any other pathname, and on the new-chat form', () => {
    expect(resolveActiveSalon(null, '/aurora')).toBeNull()
    expect(resolveActiveSalon(null, '/salon/new')).toBeNull()
    expect(resolveActiveSalon(null, null)).toBeNull()
  })
})

// ============================================================================
// The click handler
// ============================================================================

describe('useOpenDocumentFromSearch', () => {
  it('opens in the focused Salon, parented to its tab', () => {
    mockPathname.mockReturnValue('/workspace')
    mockWorkspace.mockReturnValue({ state: salonState(), openTab } as never)

    const { result: hook } = renderHook(() => useOpenDocumentFromSearch())
    const event = clickEvent()
    hook.current(result, event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(mockOpenInChat).toHaveBeenCalledWith(
      'chat-1',
      {
        filePath: 'Notes/manifesto.md',
        scope: 'document_store',
        mountPoint: 'Library',
        mode: 'split',
      },
      { openTab, parentTabId: 't-salon' }
    )
    expect(openTab).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('opens a silent standalone tab when the workspace has no Salon focused', () => {
    mockPathname.mockReturnValue('/workspace')
    const state = salonState()
    state.panes.left.activeTabId = 't-home'
    mockWorkspace.mockReturnValue({ state, openTab } as never)

    const { result: hook } = renderHook(() => useOpenDocumentFromSearch())
    const event = clickEvent()
    hook.current(result, event)

    expect(mockOpenInChat).not.toHaveBeenCalled()
    expect(openTab).toHaveBeenCalledWith(
      'document-standalone',
      {
        docKey: 'document_store:Library:Notes/manifesto.md',
        scope: 'document_store',
        mountPoint: 'Library',
        filePath: 'Notes/manifesto.md',
        displayTitle: 'manifesto.md',
      },
      { title: 'manifesto.md' }
    )
    expect(push).not.toHaveBeenCalled()
  })

  it('opens in the chat the legacy Salon page is showing, without a tab', () => {
    mockPathname.mockReturnValue('/salon/chat-9')
    mockWorkspace.mockReturnValue(null)

    const { result: hook } = renderHook(() => useOpenDocumentFromSearch())
    hook.current(result, clickEvent())

    expect(mockOpenInChat).toHaveBeenCalledWith(
      'chat-9',
      expect.objectContaining({ filePath: 'Notes/manifesto.md' }),
      { openTab: null, parentTabId: undefined }
    )
  })

  it('pushes the standalone deep link outside the workspace shell', () => {
    mockPathname.mockReturnValue('/aurora')
    mockWorkspace.mockReturnValue(null)

    const { result: hook } = renderHook(() => useOpenDocumentFromSearch())
    hook.current(result, clickEvent())

    expect(push).toHaveBeenCalledWith(result.url)
    expect(mockOpenInChat).not.toHaveBeenCalled()
  })

  it('leaves modified clicks to the browser', () => {
    mockPathname.mockReturnValue('/workspace')
    mockWorkspace.mockReturnValue({ state: salonState(), openTab } as never)

    const { result: hook } = renderHook(() => useOpenDocumentFromSearch())

    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const event = clickEvent(modifier)
      hook.current(result, event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }

    expect(mockOpenInChat).not.toHaveBeenCalled()
    expect(openTab).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })
})
