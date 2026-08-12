/**
 * SalonModePanes routing: legacy fallback (no workspace → in-chat SplitLayout)
 * and the workspace branch (each open document spawns its own child tab and the
 * pane is portaled into that tab's host). Guards the trickiest Phase 4 / multi-
 * document logic.
 */

import { useCallback, useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SalonModePanes, type DocumentPaneDescriptor } from '@/app/salon/[id]/components/SalonModePanes'
import { WorkspaceProvider, useWorkspace } from '@/components/providers/workspace-provider'
import {
  WorkspaceTabProvider,
  WorkspacePortalRegistryProvider,
  useWorkspacePortalRegistry,
  portalKey,
} from '@/components/workspace/workspace-tab-context'

/** Registers a portal host node for a document pane (stands in for a TabView). */
function DocHostProbe({ chatId, docId }: { chatId: string; docId: string }) {
  const reg = useWorkspacePortalRegistry()
  const setNode = reg?.setNode
  const ref = useCallback(
    (el: HTMLElement | null) => setNode?.(portalKey('document', chatId, docId), el),
    [setNode, chatId, docId]
  )
  return <div data-testid={`host-document-${docId}`} ref={ref} />
}

/** Surfaces how many document tabs exist in the workspace. */
function DocTabCount() {
  const { state } = useWorkspace()
  const n = Object.values(state.tabs).filter((t) => t.kind === 'document').length
  return <div data-testid="doc-tab-count">{n}</div>
}

const baseProps = {
  parentChatId: 'c1',
  chatTitle: 'My Chat',
  mode: 'normal' as const,
  dividerPosition: 50,
  onDividerPositionChange: () => {},
  rightPaneVerticalSplit: 50,
  onRightPaneVerticalSplitChange: () => {},
  terminalContent: null,
  terminalActive: false,
  onCloseTerminal: () => {},
}

describe('SalonModePanes — legacy (no workspace)', () => {
  it('renders the in-chat SplitLayout with the chat content', () => {
    render(
      <SalonModePanes
        {...baseProps}
        chatContent={<div>CHAT-BODY</div>}
        documentPanes={[]}
        focusedDocId={null}
        onCloseDocument={() => {}}
      />
    )
    expect(screen.getByText('CHAT-BODY')).toBeInTheDocument()
  })

  it('shows the focused document in the single pane', () => {
    render(
      <SalonModePanes
        {...baseProps}
        mode="split"
        chatContent={<div>CHAT-BODY</div>}
        documentPanes={[
          { docId: 'd1', displayTitle: 'One', content: <div>DOC-ONE</div> },
          { docId: 'd2', displayTitle: 'Two', content: <div>DOC-TWO</div> },
        ]}
        focusedDocId="d2"
        onCloseDocument={() => {}}
      />
    )
    expect(screen.getByText('DOC-TWO')).toBeInTheDocument()
    expect(screen.queryByText('DOC-ONE')).not.toBeInTheDocument()
  })
})

describe('SalonModePanes — workspace branch', () => {
  beforeEach(() => window.localStorage.clear())

  function WorkspaceHarness() {
    const [docs, setDocs] = useState<DocumentPaneDescriptor[]>([])
    const openDoc = (docId: string) =>
      setDocs((prev) =>
        prev.some((d) => d.docId === docId)
          ? prev
          : [...prev, { docId, displayTitle: docId.toUpperCase(), content: <div>{`DOC-${docId}`}</div> }]
      )
    const closeDoc = (docId: string) => setDocs((prev) => prev.filter((d) => d.docId !== docId))
    return (
      <WorkspaceProvider>
        <WorkspacePortalRegistryProvider>
          <WorkspaceTabProvider tabId="salon-tab">
            <SalonModePanes
              {...baseProps}
              chatContent={<div>CHAT-BODY</div>}
              documentPanes={docs}
              focusedDocId={docs[docs.length - 1]?.docId ?? null}
              onCloseDocument={closeDoc}
            />
          </WorkspaceTabProvider>
          <DocHostProbe chatId="c1" docId="d1" />
          <DocHostProbe chatId="c1" docId="d2" />
          <DocTabCount />
          <button onClick={() => openDoc('d1')}>open-d1</button>
          <button onClick={() => openDoc('d2')}>open-d2</button>
          <button onClick={() => closeDoc('d1')}>close-d1</button>
        </WorkspacePortalRegistryProvider>
      </WorkspaceProvider>
    )
  }

  it('opens a document child tab per open document and portals each pane into its host', () => {
    render(<WorkspaceHarness />)

    // Chat content renders inline in the workspace branch.
    expect(screen.getByText('CHAT-BODY')).toBeInTheDocument()
    expect(screen.getByTestId('doc-tab-count').textContent).toBe('0')

    fireEvent.click(screen.getByText('open-d1'))
    expect(screen.getByTestId('doc-tab-count').textContent).toBe('1')
    expect(within(screen.getByTestId('host-document-d1')).getByText('DOC-d1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('open-d2'))
    expect(screen.getByTestId('doc-tab-count').textContent).toBe('2')
    expect(within(screen.getByTestId('host-document-d2')).getByText('DOC-d2')).toBeInTheDocument()
  })

  it('closes only the affected document tab when one document closes', () => {
    render(<WorkspaceHarness />)
    fireEvent.click(screen.getByText('open-d1'))
    fireEvent.click(screen.getByText('open-d2'))
    expect(screen.getByTestId('doc-tab-count').textContent).toBe('2')

    fireEvent.click(screen.getByText('close-d1'))
    expect(screen.getByTestId('doc-tab-count').textContent).toBe('1')
    // The surviving document's pane is still portaled.
    expect(within(screen.getByTestId('host-document-d2')).getByText('DOC-d2')).toBeInTheDocument()
  })
})
