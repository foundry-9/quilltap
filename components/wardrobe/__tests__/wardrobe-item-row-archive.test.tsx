/**
 * The Archive / Restore affordance on a wardrobe row's `⋮` menu.
 *
 * Three rules govern whether it appears, and they are easy to break by
 * accident:
 *
 *  1. It is an OPTIONAL prop. A surface that must never archive — the outfit
 *     composer, which does the same job the outfit-selection LLM does — simply
 *     omits the handler and the entry doesn't render.
 *  2. It lives behind `canManage`, alongside Edit and Duplicate. A garment
 *     merged in from a shared tier keeps only Move and Copy: one character
 *     must not be able to retire a coat the whole household shares.
 *  3. The label flips with the item's state, and an archived row is badged.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc — these colocated component tests
// are type-checked, unlike the excluded `__tests__/` tree.
import { render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { WardrobeItemRow } from '@/components/wardrobe/wardrobe-item-row'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

const ARCHIVED_AT = '2026-02-01T00:00:00.000Z'

function makeItem(overrides: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id: 'item-1',
    characterId: 'char-1',
    title: 'Travelling coat',
    types: ['top'],
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as WardrobeItem
}

function makeHandlers() {
  return {
    onToggleDefault: jest.fn(),
    onEdit: jest.fn(),
    onDuplicate: jest.fn(),
    onMove: jest.fn(),
    onCopy: jest.fn(),
    onDelete: jest.fn(),
    onToggleArchived: jest.fn(),
  }
}

type Handlers = ReturnType<typeof makeHandlers>

function renderRow(
  item: WardrobeItem = makeItem(),
  handlers: Handlers = makeHandlers(),
  props: Record<string, unknown> = {},
) {
  return render(
    <WardrobeItemRow
      item={item}
      allItems={[item]}
      inChat={false}
      onToggleDefault={handlers.onToggleDefault}
      onEdit={handlers.onEdit}
      onDuplicate={handlers.onDuplicate}
      onMove={handlers.onMove}
      onCopy={handlers.onCopy}
      onDelete={handlers.onDelete}
      onToggleArchived={handlers.onToggleArchived}
      {...props}
    />,
  )
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  return screen.getByRole('menu')
}

describe('WardrobeItemRow — archive affordance', () => {
  let handlers: Handlers

  beforeEach(() => {
    handlers = makeHandlers()
  })

  it('offers Archive for an active garment and fires the handler', () => {
    renderRow(makeItem(), handlers)
    const menu = openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Archive' }))
    expect(handlers.onToggleArchived).toHaveBeenCalledTimes(1)
    expect(handlers.onToggleArchived).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1' }),
    )
  })

  it('offers Restore from archive for an archived garment', () => {
    renderRow(makeItem({ archivedAt: ARCHIVED_AT }), handlers)
    const menu = openMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Restore from archive' }))
    expect(handlers.onToggleArchived).toHaveBeenCalledTimes(1)
  })

  it('badges an archived garment in the row itself', () => {
    renderRow(makeItem({ archivedAt: ARCHIVED_AT }), handlers)
    expect(screen.getByText('archived')).toBeInTheDocument()
  })

  it('shows no badge for an active garment', () => {
    renderRow(makeItem(), handlers)
    expect(screen.queryByText('archived')).not.toBeInTheDocument()
  })

  it('omits the entry entirely when the surface passes no handler', () => {
    // The outfit composer's case: archived garments must never appear there,
    // so there is nothing to archive and no control to offer.
    render(
      <WardrobeItemRow
        item={makeItem()}
        allItems={[]}
        inChat={false}
        onToggleDefault={handlers.onToggleDefault}
        onEdit={handlers.onEdit}
        onDuplicate={handlers.onDuplicate}
        onMove={handlers.onMove}
        onCopy={handlers.onCopy}
        onDelete={handlers.onDelete}
      />,
    )
    const menu = openMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()
    // The unconditional actions are still there.
    expect(within(menu).getByRole('menuitem', { name: 'Move' })).toBeInTheDocument()
  })

  it('withholds it from a garment borrowed from another tier, as Edit is withheld', () => {
    // `canManage: false` is the shared-tier case — a General archetype seen
    // from a character's merged view. Archive it from the container that owns
    // it, not from here.
    renderRow(makeItem({ characterId: null }), handlers, { canManage: () => false })
    const menu = openMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument()
  })
})
