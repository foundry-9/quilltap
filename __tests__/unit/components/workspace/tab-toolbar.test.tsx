/**
 * Per-tab page toolbar + focus-driven header bridge.
 *
 * Each tab's `usePageToolbar()` writes into a per-tab registry (isolated, so
 * kept-alive sibling tabs never clobber each other). `WorkspaceToolbarBridge`
 * then surfaces the *focused* pane's active tab's content into the single global
 * page toolbar — so activating a different tab regenerates the header, and
 * focusing a pane whose active tab injected nothing clears it.
 */

import { useEffect } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import {
  PageToolbarProvider,
  usePageToolbar,
} from '@/components/providers/page-toolbar-provider'
import { useWorkspace, WorkspaceProvider } from '@/components/providers/workspace-provider'
import {
  TabToolbarRegistryProvider,
  TabToolbarProvider,
  WorkspaceToolbarBridge,
} from '@/components/workspace/tab-toolbar'

/** A surface that injects left toolbar content, like SalonView does. */
function LeftInjector({ text }: { text: string }) {
  const { setLeftContent } = usePageToolbar()
  useEffect(() => {
    setLeftContent(<span>{text}</span>)
  }, [text, setLeftContent])
  return null
}

/** Mimics WorkspaceHost/TabView: every open tab is kept alive and (for
 *  non-`home` tabs) injects a header, each under its own per-tab provider. */
function MiniHost() {
  const { state } = useWorkspace()
  return (
    <>
      {Object.values(state.tabs).map((t) => (
        <TabToolbarProvider key={t.id} tabId={t.id}>
          {t.kind === 'home' ? null : <LeftInjector text={`hdr:${t.title}`} />}
        </TabToolbarProvider>
      ))}
    </>
  )
}

/** Mimics the single global PageToolbar reading the global context. */
function GlobalHeader() {
  const { leftContent } = usePageToolbar()
  return <div data-testid="global-header">{leftContent}</div>
}

function Controls() {
  const { openTab, setActive, setFocusedPane, splitTo, state } = useWorkspace()
  const byKind = (kind: string) => Object.values(state.tabs).find((t) => t.kind === kind)
  const home = byKind('home')
  const aurora = byKind('aurora')
  return (
    <div>
      <button onClick={() => openTab('aurora')}>open-aurora</button>
      <button onClick={() => openTab('prospero')}>open-prospero</button>
      <button onClick={() => home && setActive('left', home.id)}>activate-home</button>
      <button onClick={() => aurora && setActive('left', aurora.id)}>activate-aurora</button>
      <button onClick={() => aurora && splitTo(aurora.id, 'right')}>split-aurora</button>
      <button onClick={() => setFocusedPane('left')}>focus-left</button>
      <button onClick={() => setFocusedPane('right')}>focus-right</button>
    </div>
  )
}

function renderBridge() {
  return render(
    <PageToolbarProvider>
      <WorkspaceProvider>
        <TabToolbarRegistryProvider>
          <Controls />
          <MiniHost />
          <WorkspaceToolbarBridge />
          <GlobalHeader />
        </TabToolbarRegistryProvider>
      </WorkspaceProvider>
    </PageToolbarProvider>
  )
}

function header() {
  return within(screen.getByTestId('global-header'))
}

describe('focus-driven toolbar bridge', () => {
  beforeEach(() => window.localStorage.clear())

  it('regenerates the header when the active tab changes', () => {
    renderBridge()

    fireEvent.click(screen.getByText('open-aurora'))
    expect(header().getByText('hdr:Characters')).toBeInTheDocument()

    // Opening (and activating) Projects swaps the header to its content.
    fireEvent.click(screen.getByText('open-prospero'))
    expect(header().getByText('hdr:Projects')).toBeInTheDocument()
    expect(header().queryByText('hdr:Characters')).toBeNull()

    // Re-activating the Characters tab brings its header back.
    fireEvent.click(screen.getByText('activate-aurora'))
    expect(header().getByText('hdr:Characters')).toBeInTheDocument()
    expect(header().queryByText('hdr:Projects')).toBeNull()
  })

  it('clears the header when the active tab injected nothing', () => {
    renderBridge()

    fireEvent.click(screen.getByText('open-aurora'))
    expect(header().getByText('hdr:Characters')).toBeInTheDocument()

    // Home injects no toolbar content → header goes blank.
    fireEvent.click(screen.getByText('activate-home'))
    expect(header().queryByText('hdr:Characters')).toBeNull()
    expect(screen.getByTestId('global-header')).toBeEmptyDOMElement()
  })

  it('follows the focused pane in a split', () => {
    renderBridge()

    // Aurora into the right pane (focus follows the moved tab); left stays Home.
    fireEvent.click(screen.getByText('open-aurora'))
    fireEvent.click(screen.getByText('split-aurora'))
    expect(header().getByText('hdr:Characters')).toBeInTheDocument()

    // Focusing the left (Home) pane clears the header...
    fireEvent.click(screen.getByText('focus-left'))
    expect(header().queryByText('hdr:Characters')).toBeNull()

    // ...and focusing back onto the Aurora pane restores it.
    fireEvent.click(screen.getByText('focus-right'))
    expect(header().getByText('hdr:Characters')).toBeInTheDocument()
  })
})
