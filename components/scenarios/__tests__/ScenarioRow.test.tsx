/**
 * Unit tests for ScenarioRow.
 *
 * jsdom does not load Tailwind CSS, so the container-query visibility classes
 * (`hidden @lg:flex` / `@lg:hidden`) are inert — both the inline buttons and the
 * kebab affordance are in the DOM. We disambiguate by ARIA role: the inline
 * controls are `role="button"`, the kebab menu items are `role="menuitem"`.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// (toBeInTheDocument, etc.) resolves on the global `expect` under tsc — these
// colocated component tests are type-checked, unlike the excluded `__tests__/` tree.
import { render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { ScenarioRow } from '@/components/scenarios/ScenarioRow'
import type { Scenario } from '@/components/scenarios/types'

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    path: 'Scenarios/tavern.md',
    filename: 'tavern',
    name: 'The Tavern',
    description: 'A cozy inn at the crossroads.',
    isDefault: false,
    rawIsDefault: false,
    archived: false,
    body: 'Once upon a time…',
    lastModified: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeHandlers() {
  return {
    onSetDefault: jest.fn(),
    onEdit: jest.fn(),
    onRename: jest.fn(),
    onDelete: jest.fn(),
    onToggleArchived: jest.fn(),
  }
}

type Handlers = ReturnType<typeof makeHandlers>

function renderRow(scenario: Scenario, handlers: Handlers) {
  return render(
    <ul>
      <ScenarioRow
        scenario={scenario}
        scopeLabel="project"
        onSetDefault={handlers.onSetDefault}
        onEdit={handlers.onEdit}
        onRename={handlers.onRename}
        onDelete={handlers.onDelete}
        onToggleArchived={handlers.onToggleArchived}
      />
    </ul>,
  )
}

describe('ScenarioRow', () => {
  let handlers: Handlers

  beforeEach(() => {
    handlers = makeHandlers()
  })

  describe('content', () => {
    it('renders the name, filename, and description', () => {
      renderRow(makeScenario(), handlers)
      expect(screen.getByText('The Tavern')).toBeInTheDocument()
      expect(screen.getByText('tavern.md')).toBeInTheDocument()
      expect(screen.getByText('A cozy inn at the crossroads.')).toBeInTheDocument()
    })

    it('omits the description paragraph when there is none', () => {
      renderRow(makeScenario({ description: undefined }), handlers)
      expect(screen.queryByText('A cozy inn at the crossroads.')).not.toBeInTheDocument()
    })

    it('shows the Default badge only when the scenario is the default', () => {
      const { rerender } = renderRow(makeScenario({ isDefault: false }), handlers)
      expect(screen.queryByText('Default')).not.toBeInTheDocument()

      rerender(
        <ul>
          <ScenarioRow
            scenario={makeScenario({ isDefault: true })}
            scopeLabel="project"
            onSetDefault={handlers.onSetDefault}
            onEdit={handlers.onEdit}
            onRename={handlers.onRename}
            onDelete={handlers.onDelete}
            onToggleArchived={handlers.onToggleArchived}
          />
        </ul>,
      )
      expect(screen.getByText('Default')).toBeInTheDocument()
    })

    it('shows the Archived badge only when the scenario is archived', () => {
      renderRow(makeScenario({ archived: false }), handlers)
      expect(screen.queryByText('Archived')).not.toBeInTheDocument()
    })

    it('badges an archived scenario', () => {
      renderRow(makeScenario({ archived: true }), handlers)
      expect(screen.getByText('Archived')).toBeInTheDocument()
    })
  })

  describe('default radio', () => {
    it('fires onSetDefault when toggled', () => {
      renderRow(makeScenario(), handlers)
      fireEvent.click(screen.getByRole('radio'))
      expect(handlers.onSetDefault).toHaveBeenCalledTimes(1)
      expect(handlers.onSetDefault).toHaveBeenCalledWith(expect.objectContaining({ path: 'Scenarios/tavern.md' }))
    })

    it('is disabled for an archived scenario — it can never win default resolution', () => {
      renderRow(makeScenario({ archived: true }), handlers)
      expect(screen.getByRole('radio')).toBeDisabled()
    })
  })

  describe('inline buttons (wide container)', () => {
    it('fires the matching callback for each inline action', () => {
      renderRow(makeScenario(), handlers)
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      expect(handlers.onEdit).toHaveBeenCalledTimes(1)
      expect(handlers.onRename).toHaveBeenCalledTimes(1)
      expect(handlers.onDelete).toHaveBeenCalledTimes(1)
    })

    it('offers Archive for an active scenario and Restore for an archived one', () => {
      const { unmount } = renderRow(makeScenario({ archived: false }), handlers)
      fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
      expect(handlers.onToggleArchived).toHaveBeenCalledTimes(1)
      unmount()

      renderRow(makeScenario({ archived: true }), handlers)
      expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
      expect(handlers.onToggleArchived).toHaveBeenCalledTimes(2)
    })
  })

  describe('kebab menu (narrow container)', () => {
    function openMenu() {
      const trigger = screen.getByRole('button', { name: /more actions for The Tavern/i })
      fireEvent.click(trigger)
      return trigger
    }

    it('is closed by default and opens on click', () => {
      renderRow(makeScenario(), handlers)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      const trigger = openMenu()
      expect(screen.getByRole('menu')).toBeInTheDocument()
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })

    it.each([
      ['Edit', 'onEdit'],
      ['Rename', 'onRename'],
      ['Archive', 'onToggleArchived'],
      ['Delete', 'onDelete'],
    ] as const)('fires %s once and closes the menu', (label, handlerKey) => {
      renderRow(makeScenario(), handlers)
      openMenu()
      const menu = screen.getByRole('menu')
      fireEvent.click(within(menu).getByRole('menuitem', { name: label }))
      expect(handlers[handlerKey]).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('closes on Escape', () => {
      renderRow(makeScenario(), handlers)
      openMenu()
      expect(screen.getByRole('menu')).toBeInTheDocument()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('closes on an outside pointer press', () => {
      renderRow(makeScenario(), handlers)
      openMenu()
      expect(screen.getByRole('menu')).toBeInTheDocument()
      fireEvent.mouseDown(document.body)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('stays open when the press is inside the menu', () => {
      renderRow(makeScenario(), handlers)
      openMenu()
      const menu = screen.getByRole('menu')
      fireEvent.mouseDown(menu)
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })
  })
})
