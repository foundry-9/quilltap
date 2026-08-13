'use client'

/**
 * Shared typeahead shell — the menu surface.
 *
 * Renders the option list into the anchor element that
 * `LexicalTypeaheadMenuPlugin` positions for us, and owns the ARIA wiring that
 * makes a menu driven from a contenteditable legible to a screen reader.
 * Surface classes come from `qt-typeahead-*`; dismissal and keyboard handling
 * belong to the Lexical menu, not here.
 *
 * @module components/chat/lexical/typeahead/MenuPortal
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { RefObject } from 'react'

import type { TypeaheadRow } from './types'

interface MenuPortalProps {
  /** Anchor supplied by `LexicalTypeaheadMenuPlugin`'s `menuRenderFn`. */
  anchorElementRef: RefObject<HTMLElement | null>
  rows: TypeaheadRow[]
  /** Index of the highlighted row, or null when nothing is highlighted. */
  selectedIndex: number | null
  onSelect: (index: number) => void
  onHighlight: (index: number) => void
  /** Shown when `rows` is empty. */
  emptyLabel: string
  /** `id` of the listbox, referenced by the editor's `aria-activedescendant`. */
  listboxId: string
  /**
   * The contenteditable that keeps focus while the menu is open. Focus never
   * moves to the menu, so this element must advertise the active option itself.
   */
  activeDescendantTarget?: HTMLElement | null
}

/** Row `id`s are derived, not stored, so the plugin can point at one by index. */
export function typeaheadOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`
}

export function MenuPortal({
  anchorElementRef,
  rows,
  selectedIndex,
  onSelect,
  onHighlight,
  emptyLabel,
  listboxId,
  activeDescendantTarget,
}: Readonly<MenuPortalProps>) {
  const menuRef = useRef<HTMLDivElement>(null)

  const activeId =
    selectedIndex !== null && rows[selectedIndex]
      ? typeaheadOptionId(listboxId, selectedIndex)
      : null

  /**
   * Flip the menu above the caret when there is no room below it.
   *
   * This is not a nicety: the Salon composer sits at the BOTTOM of the window,
   * so a menu that only ever opens downward is clipped by the viewport every
   * single time — which is exactly what the first live run showed.
   *
   * Written as a direct DOM attribute rather than React state on purpose. The
   * row list changes on every keystroke, so this has to re-measure after every
   * render; routing that through `setState` would cost an extra render pass per
   * character typed, and setting state in an effect body is a lint error here
   * for that very reason.
   */
  useLayoutEffect(() => {
    const menu = menuRef.current
    const anchor = menu?.parentElement
    if (!menu || !anchor) return

    const anchorRect = anchor.getBoundingClientRect()
    const roomBelow = window.innerHeight - anchorRect.bottom
    const flipUp = roomBelow < menu.offsetHeight && anchorRect.top > roomBelow
    menu.setAttribute('data-placement', flipUp ? 'above' : 'below')

    // Same story horizontally: a caret near the right edge would push a
    // left-aligned menu off-screen.
    const overflowsRight = anchorRect.left + menu.offsetWidth > window.innerWidth
    menu.setAttribute('data-align', overflowsRight ? 'right' : 'left')
  })

  useEffect(() => {
    if (!activeDescendantTarget) return

    if (activeId) {
      activeDescendantTarget.setAttribute('aria-activedescendant', activeId)
      activeDescendantTarget.setAttribute('aria-controls', listboxId)
      activeDescendantTarget.setAttribute('aria-expanded', 'true')
    } else {
      activeDescendantTarget.removeAttribute('aria-activedescendant')
    }

    // Clear on unmount too: the menu closing must not leave the composer
    // permanently claiming an expanded listbox that no longer exists.
    return () => {
      activeDescendantTarget.removeAttribute('aria-activedescendant')
      activeDescendantTarget.removeAttribute('aria-controls')
      activeDescendantTarget.removeAttribute('aria-expanded')
    }
  }, [activeDescendantTarget, activeId, listboxId])

  const menu = (
    <div className="qt-typeahead-menu" role="listbox" id={listboxId} ref={menuRef}>
      {rows.length === 0 ? (
        <div className="qt-typeahead-empty">{emptyLabel}</div>
      ) : (
        rows.map((row, index) => (
          <div
            key={row.key}
            id={typeaheadOptionId(listboxId, index)}
            role="option"
            aria-selected={index === selectedIndex}
            aria-label={row.label}
            className={
              index === selectedIndex
                ? 'qt-typeahead-option qt-typeahead-option-active'
                : 'qt-typeahead-option'
            }
            // The editor keeps focus throughout, so this is a pointer affordance
            // on a listbox option rather than a focusable control — the keyboard
            // path is the Lexical menu's own key handling.
            onMouseDown={(event) => {
              // Stop the composer losing its selection before we can act on it.
              event.preventDefault()
              onSelect(index)
            }}
            onMouseEnter={() => onHighlight(index)}
          >
            {row.glyph !== undefined && (
              <span className="qt-typeahead-option-glyph" aria-hidden="true">
                {row.glyph}
              </span>
            )}
            <span className="qt-typeahead-option-label">{row.label}</span>
            {row.detail !== undefined && (
              <span className="qt-typeahead-option-detail">{row.detail}</span>
            )}
          </div>
        ))
      )}
    </div>
  )

  // Reading a ref during render is normally a bug — the value can be populated
  // after the render that needed it, and nothing re-renders. Not here:
  // `LexicalTypeaheadMenuPlugin` renders `menuRenderFn` only once its own anchor
  // is mounted (`… || anchorElementRef.current === null ? null : <LexicalMenu
  // menuRenderFn={…} />`), so the element already exists by the time this
  // component runs. Mirroring it into state would add a render pass for nothing,
  // and the null branch below keeps it honest if that contract ever changes.
  // eslint-disable-next-line react-hooks/refs
  return anchorElementRef.current === null ? null : createPortal(menu, anchorElementRef.current)
}

export default MenuPortal
