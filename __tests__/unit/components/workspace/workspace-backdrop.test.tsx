/**
 * Workspace backdrop: reporting must not loop (the registry object changes
 * identity on every entries update, so the report effect must depend only on the
 * stable report/clear callbacks), and the active tab's reported background must
 * be painted.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceProvider, useWorkspace } from '@/components/providers/workspace-provider'
import { WorkspaceTabProvider } from '@/components/workspace/workspace-tab-context'
import {
  WorkspaceBackdropProvider,
  WorkspaceBackdrop,
  useReportWorkspaceBackdrop,
} from '@/components/workspace/workspace-backdrop'

function Reporter({ url, isSalon }: { url: string; isSalon: boolean }) {
  useReportWorkspaceBackdrop(url, isSalon)
  return null
}

function Harness({ url, isSalon }: { url: string; isSalon: boolean }) {
  const { openTab, state } = useWorkspace()
  const aurora = Object.values(state.tabs).find((t) => t.kind === 'aurora')
  return (
    <div>
      <button onClick={() => openTab('aurora')}>open</button>
      {aurora && (
        <WorkspaceTabProvider tabId={aurora.id}>
          <Reporter url={url} isSalon={isSalon} />
        </WorkspaceTabProvider>
      )}
      <WorkspaceBackdrop />
    </div>
  )
}

function renderHarness(url = '/img/a.png', isSalon = false) {
  return render(
    <WorkspaceProvider>
      <WorkspaceBackdropProvider>
        <Harness url={url} isSalon={isSalon} />
      </WorkspaceBackdropProvider>
    </WorkspaceProvider>
  )
}

describe('workspace backdrop', () => {
  beforeEach(() => window.localStorage.clear())

  it('reports without an infinite update loop and paints the active background', () => {
    const { container } = renderHarness('/img/a.png', false)
    // Opening the tab mounts the reporter; a looping effect would throw
    // "Maximum update depth exceeded" here.
    fireEvent.click(screen.getByText('open'))

    const layer = container.querySelector('.qt-workspace-backdrop-layer') as HTMLElement | null
    expect(layer).not.toBeNull()
    expect(layer!.style.backgroundImage).toContain('/img/a.png')
  })

  it('renders no backdrop when nothing is reported', () => {
    const { container } = render(
      <WorkspaceProvider>
        <WorkspaceBackdropProvider>
          <WorkspaceBackdrop />
        </WorkspaceBackdropProvider>
      </WorkspaceProvider>
    )
    expect(container.querySelector('.qt-workspace-backdrop')).toBeNull()
  })
})
