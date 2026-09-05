/**
 * Regression tests for ScenarioEditorModal.
 *
 * The bug: the modal seeded its `body` state in a useEffect, while the editor's
 * `remountKey` was computed during render. Because MarkdownLexicalEditor only
 * reads its value at (re)mount and remounts when `remountKey` changes, switching
 * scenarios remounted the editor with the PREVIOUS scenario's body — the effect's
 * setBody landed a tick too late and never re-triggered a remount. The fix seeds
 * the form synchronously during render, so `body` is correct in the same commit
 * that flips `remountKey`.
 *
 * The MarkdownLexicalEditor mock below faithfully mimics that "read value only at
 * mount, remount on remountKey" contract — a naive stub that always renders
 * `value` would NOT catch the bug.
 *
 * Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
 * resolves on the global `expect` under tsc (these colocated tests are
 * type-checked).
 */

import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { ScenarioEditorModal } from '@/components/scenarios/ScenarioEditorModal'
import type { Scenario } from '@/components/scenarios/types'

// Mimic the real editor: only captures `value` at (re)mount, and remounts when
// `remountKey` changes (the real one keys LexicalComposer off remountKey).
jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => {
  const ReactLib = require('react')
  function Captured({ initial }: { initial: string }) {
    const [captured] = ReactLib.useState(initial)
    return ReactLib.createElement('div', { 'data-testid': 'editor-body' }, captured)
  }
  return {
    __esModule: true,
    default: ({ value, remountKey }: { value: string; remountKey?: string | number }) =>
      ReactLib.createElement(Captured, { key: remountKey, initial: value }),
  }
})

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    path: 'Scenarios/alpha.md',
    filename: 'alpha',
    name: 'Alpha',
    description: 'first',
    isDefault: false,
    rawIsDefault: false,
    archived: false,
    body: 'ALPHA BODY',
    lastModified: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function noop() {
  return Promise.resolve({ ok: true } as const)
}

describe('ScenarioEditorModal', () => {
  it('shows the opened scenario body', () => {
    render(
      <ScenarioEditorModal isOpen scenario={makeScenario()} onClose={() => {}} onSave={noop} />,
    )
    expect(screen.getByTestId('editor-body')).toHaveTextContent('ALPHA BODY')
    expect(screen.getByDisplayValue('Alpha')).toBeInTheDocument()
  })

  it('shows the NEW scenario body when switching scenarios while open (regression)', () => {
    const alpha = makeScenario()
    const bravo = makeScenario({ path: 'Scenarios/bravo.md', filename: 'bravo', name: 'Bravo', body: 'BRAVO BODY' })

    const { rerender } = render(
      <ScenarioEditorModal isOpen scenario={alpha} onClose={() => {}} onSave={noop} />,
    )
    expect(screen.getByTestId('editor-body')).toHaveTextContent('ALPHA BODY')

    rerender(<ScenarioEditorModal isOpen scenario={bravo} onClose={() => {}} onSave={noop} />)
    // With the old effect-based seeding this still read "ALPHA BODY".
    expect(screen.getByTestId('editor-body')).toHaveTextContent('BRAVO BODY')
    expect(screen.getByDisplayValue('Bravo')).toBeInTheDocument()
  })

  it('re-seeds fresh when the same scenario is closed and re-opened', () => {
    const alpha = makeScenario()
    const { rerender } = render(
      <ScenarioEditorModal isOpen scenario={alpha} onClose={() => {}} onSave={noop} />,
    )
    // Edit the name in place.
    fireEvent.change(screen.getByDisplayValue('Alpha'), { target: { value: 'Edited Name' } })
    expect(screen.getByDisplayValue('Edited Name')).toBeInTheDocument()

    // Close, then re-open the same scenario — the edit must be discarded.
    rerender(<ScenarioEditorModal isOpen={false} scenario={alpha} onClose={() => {}} onSave={noop} />)
    rerender(<ScenarioEditorModal isOpen scenario={alpha} onClose={() => {}} onSave={noop} />)
    expect(screen.getByDisplayValue('Alpha')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Edited Name')).not.toBeInTheDocument()
  })

  it('renders the create flow (no scenario) with an empty body and a filename field', () => {
    render(
      <ScenarioEditorModal isOpen scenario={null} onClose={() => {}} onSave={noop} />,
    )
    expect(screen.getByTestId('editor-body')).toHaveTextContent('')
    expect(screen.getByLabelText(/Filename/i)).toBeInTheDocument()
  })
})
