/**
 * Workspace keyboard shortcuts: Ctrl/Cmd+Alt namespaced tab navigation, close,
 * and split toggle — inert while typing in a field.
 */

import { render, screen, act, fireEvent } from '@testing-library/react'
import { WorkspaceProvider, useWorkspace } from '@/components/providers/workspace-provider'
import { useWorkspaceShortcuts } from '@/components/workspace/useWorkspaceShortcuts'
import { getPaneState } from '@/lib/workspace/workspace-reducer'

function Harness() {
  useWorkspaceShortcuts()
  const { state, openTab } = useWorkspace()
  const ps = getPaneState(state, state.focusedPane)
  const activeKind = ps?.activeTabId ? state.tabs[ps.activeTabId]?.kind : '(none)'
  return (
    <div>
      <button onClick={() => openTab('aurora')}>aurora</button>
      <button onClick={() => openTab('prospero')}>prospero</button>
      <button onClick={() => openTab('scriptorium')}>scriptorium</button>
      <div data-testid="active">{activeKind}</div>
      <div data-testid="split">{state.panes.right ? 'split' : 'single'}</div>
      <div data-testid="left-count">{getPaneState(state, 'left')?.order.length}</div>
      <input data-testid="field" />
    </div>
  )
}

function renderHarness() {
  return render(
    <WorkspaceProvider>
      <Harness />
    </WorkspaceProvider>
  )
}

/** Fire a Ctrl+Alt+<key> chord from a non-editable target (document.body). */
function chord(key: string, target: Element = document.body) {
  act(() => {
    fireEvent.keyDown(target, { key, ctrlKey: true, altKey: true, bubbles: true, cancelable: true })
  })
}

function openThree() {
  fireEvent.click(screen.getByText('aurora'))
  fireEvent.click(screen.getByText('prospero'))
  fireEvent.click(screen.getByText('scriptorium'))
}

describe('useWorkspaceShortcuts', () => {
  beforeEach(() => window.localStorage.clear())

  it('cycles tabs next/previous in the focused pane, wrapping', () => {
    renderHarness()
    openThree()
    // order = [home, aurora, prospero, scriptorium]; active = scriptorium
    expect(screen.getByTestId('active')).toHaveTextContent('scriptorium')

    chord('ArrowRight') // wraps to home
    expect(screen.getByTestId('active')).toHaveTextContent('home')

    chord('ArrowLeft') // wraps back to scriptorium
    expect(screen.getByTestId('active')).toHaveTextContent('scriptorium')

    chord('ArrowLeft') // prospero
    expect(screen.getByTestId('active')).toHaveTextContent('prospero')
  })

  it('jumps to the nth tab with a digit', () => {
    renderHarness()
    openThree()
    chord('1') // index 0 = home
    expect(screen.getByTestId('active')).toHaveTextContent('home')
    chord('2') // index 1 = aurora
    expect(screen.getByTestId('active')).toHaveTextContent('aurora')
  })

  it('does nothing while typing in a field', () => {
    renderHarness()
    openThree()
    const field = screen.getByTestId('field')
    chord('ArrowRight', field)
    expect(screen.getByTestId('active')).toHaveTextContent('scriptorium')
  })

  it('toggles split and rejoins', () => {
    renderHarness()
    openThree()
    expect(screen.getByTestId('split')).toHaveTextContent('single')
    chord('\\') // split off the active tab
    expect(screen.getByTestId('split')).toHaveTextContent('split')
    chord('\\') // rejoin
    expect(screen.getByTestId('split')).toHaveTextContent('single')
  })

  it('closes the focused pane active tab', () => {
    renderHarness()
    openThree()
    expect(screen.getByTestId('left-count')).toHaveTextContent('4')
    chord('w')
    expect(screen.getByTestId('left-count')).toHaveTextContent('3')
  })

  it('ignores chords without the Alt namespace', () => {
    renderHarness()
    openThree()
    act(() => {
      fireEvent.keyDown(document.body, { key: 'ArrowRight', ctrlKey: true, bubbles: true })
    })
    expect(screen.getByTestId('active')).toHaveTextContent('scriptorium')
  })
})
