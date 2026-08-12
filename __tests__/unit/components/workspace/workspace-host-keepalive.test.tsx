/**
 * Keep-alive guard (the core constraint): switching the active tab — and moving
 * a tab between panes — must NEVER unmount a tab's view. A streaming Salon would
 * otherwise lose its EventSource. We mock `TabView` with a per-tab mount counter
 * and assert every view mounts exactly once across activations and a split.
 */

import { useWorkspace, WorkspaceProvider } from '@/components/providers/workspace-provider'
import { TabToolbarRegistryProvider } from '@/components/workspace/tab-toolbar'
import { WorkspaceHost } from '@/components/workspace/WorkspaceHost'
import { render, screen, fireEvent, within } from '@testing-library/react'

const mockMountCounts: Record<string, number> = {}

jest.mock('@/components/workspace/TabView', () => {
  const React = require('react')
  return {
    TabView: ({ tab }: { tab: { id: string; title: string } }) => {
      React.useEffect(() => {
        mockMountCounts[tab.id] = (mockMountCounts[tab.id] ?? 0) + 1
      }, [tab.id])
      return React.createElement('div', { 'data-view': tab.id }, `view:${tab.title}`)
    },
  }
})

function Controls() {
  const { openTab, state, splitTo } = useWorkspace()
  const firstNonHome = Object.values(state.tabs).find((t) => t.kind !== 'home')
  return (
    <div>
      <button onClick={() => openTab('aurora')}>open-aurora</button>
      <button onClick={() => openTab('prospero')}>open-prospero</button>
      <button onClick={() => firstNonHome && splitTo(firstNonHome.id, 'right')}>split-first</button>
    </div>
  )
}

function renderHost() {
  return render(
    <WorkspaceProvider>
      <TabToolbarRegistryProvider>
        <Controls />
        <WorkspaceHost />
      </TabToolbarRegistryProvider>
    </WorkspaceProvider>
  )
}

describe('WorkspaceHost keep-alive', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockMountCounts)) delete mockMountCounts[k]
    window.localStorage.clear()
  })

  it('never remounts a view when switching active tabs', () => {
    renderHost()

    fireEvent.click(screen.getByText('open-aurora'))
    fireEvent.click(screen.getByText('open-prospero'))

    // Switch back and forth a few times via the tab strip.
    const strip = screen.getByRole('tablist')
    fireEvent.click(within(strip).getByText('Characters'))
    fireEvent.click(within(strip).getByText('Projects'))
    fireEvent.click(within(strip).getByText('Characters'))

    // Home + Aurora + Prospero each mounted exactly once.
    const counts = Object.values(mockMountCounts)
    expect(counts.length).toBe(3)
    expect(counts.every((c) => c === 1)).toBe(true)
  })

  it('keeps inactive tab views in the DOM (hidden, not unmounted)', () => {
    renderHost()
    fireEvent.click(screen.getByText('open-aurora'))
    fireEvent.click(screen.getByText('open-prospero'))

    // Aurora is now inactive but must still be present in the DOM.
    expect(screen.getByText('view:Characters')).toBeInTheDocument()
    expect(screen.getByText('view:Projects')).toBeInTheDocument()
  })

  it('does not remount a view when its tab is split into the other pane', () => {
    renderHost()
    fireEvent.click(screen.getByText('open-aurora'))
    const auroraId = Object.entries(mockMountCounts)[
      Object.entries(mockMountCounts).length - 1
    ][0]

    fireEvent.click(screen.getByText('split-first'))

    // The split moved a tab to a new pane; its view must not have remounted.
    expect(mockMountCounts[auroraId]).toBe(1)
  })
})
