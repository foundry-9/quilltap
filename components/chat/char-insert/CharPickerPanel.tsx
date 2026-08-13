'use client'

/**
 * CharPickerPanel
 *
 * The browsable half of the character-insertion feature, shared by both
 * profiles: a search field over the same Tier B engine the inline typeahead
 * uses, a Recents row, and a grid grouped by the dataset's own categories
 * (emoji groups, or Unicode blocks).
 *
 * `EmojiPickerPopover` and `UnicodePickerPopover` are thin wrappers that supply
 * a profile and the popover surface. Everything below is profile-agnostic — a
 * third dataset would need no changes here.
 *
 * Dismissal behaviour follows `RngDropdown` (`useClickOutside`, which also
 * handles Escape); the surface classes follow `DeleteConfirmPopover`
 * (`qt-popover`). Those two precedents disagree with each other in the repo —
 * this takes one from each deliberately.
 *
 * NOTE: the formatting toolbar only renders in composition / document-editing
 * mode, so the buttons that open this are a convenience, not the feature. The
 * inline triggers are the primary surface and are always available.
 *
 * @module components/chat/char-insert/CharPickerPanel
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LexicalEditor } from 'lexical'

import { useClickOutside } from '@/hooks/useClickOutside'
import { searchChars, findByCodePoint } from '@/lib/char-insert/search'
import type { CharEntry, CharIndex, CharProfile } from '@/lib/char-insert/types'
import { insertCharAtSelection } from './insert-char'
import { readRecents } from './recents-storage'

/** Cells per row. Arrow-key navigation is computed from this, so keep them in step. */
const COLUMNS = 8

/** Results shown for a non-empty query. Generous — this surface is for browsing. */
const SEARCH_LIMIT = 64

interface CharSection {
  key: string
  label: string
  entries: CharEntry[]
}

export interface CharPickerPanelProps {
  /** Which dataset to browse. */
  profile: CharProfile
  onClose: () => void
  /** Editor the pick is inserted into. */
  editor: LexicalEditor
  /** Ref of the toggling button, so clicking it again closes rather than reopens. */
  toggleRef?: React.RefObject<HTMLElement | null>
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size))
  return rows
}

/**
 * Rendered ONLY while open — the caller gates it (`{open && <…PickerPopover …
 * />}`). That is what lets "what to show when the picker opens" be lazy state
 * initializers rather than an effect that sets state on an `isOpen` flip.
 */
export function CharPickerPanel({
  profile,
  onClose,
  editor,
  toggleRef,
}: Readonly<CharPickerPanelProps>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Read once, on mount — i.e. when the picker opens.
  const [index, setIndex] = useState<CharIndex | null>(() => profile.loader.getLoaded())
  const [recents, setRecents] = useState<string[]>(() => readRecents(profile))
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  useClickOutside(containerRef, onClose, {
    onEscape: onClose,
    excludeRefs: toggleRef ? [toggleRef] : undefined,
  })

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // Fetch on first open only — an instance that never opens the picker and never
  // types the opener never pays for the dataset at all.
  useEffect(() => {
    if (profile.loader.getLoaded()) return

    let cancelled = false
    void profile.loader.load().then((loaded) => {
      if (cancelled) return
      if (loaded) setIndex(loaded)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [profile])

  const byChar = useMemo(() => {
    if (!index) return new Map<string, CharEntry>()
    return new Map(index.entries.map((entry) => [entry.char, entry]))
  }, [index])

  const sections = useMemo<CharSection[]>(() => {
    if (!index) return []

    const trimmed = query.trim()
    if (trimmed.length > 0) {
      const found = searchChars(index, trimmed, SEARCH_LIMIT)

      // `u+2192` typed into the search field resolves arithmetically, so the
      // picker reaches characters the curation dropped just as the typeahead
      // does.
      const direct = profile.codePointQueries ? findByCodePoint(index, trimmed) : null
      const entries = direct
        ? [direct, ...found.filter((entry) => entry.char !== direct.char)]
        : found

      return entries.length > 0 ? [{ key: 'results', label: 'Results', entries }] : []
    }

    const result: CharSection[] = []

    const recentEntries = recents
      .map((char) => byChar.get(char))
      .filter((entry): entry is CharEntry => entry !== undefined)
    if (recentEntries.length > 0) {
      result.push({ key: 'recents', label: 'Recently used', entries: recentEntries })
    }

    for (const slug of index.groups) {
      const entries = index.entries.filter((entry) => entry.group === slug)
      if (entries.length > 0) {
        result.push({ key: slug, label: profile.groupLabels[slug] ?? slug, entries })
      }
    }

    return result
  }, [index, query, recents, byChar, profile])

  /** Every cell in visual order — the coordinate space arrow keys move through. */
  const flatEntries = useMemo(() => sections.flatMap((section) => section.entries), [sections])

  useEffect(() => {
    cellRefs.current.length = flatEntries.length
  }, [flatEntries.length])

  const commit = useCallback(
    (entry: CharEntry) => {
      insertCharAtSelection(editor, profile, entry.char)
      setRecents(readRecents(profile))
      onClose()
    },
    [editor, onClose, profile],
  )

  const focusCell = useCallback((next: number) => {
    setActiveIndex(next)
    cellRefs.current[next]?.focus()
  }, [])

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent, current: number) => {
      const last = flatEntries.length - 1
      let next: number | null = null

      if (event.key === 'ArrowRight') next = Math.min(current + 1, last)
      else if (event.key === 'ArrowLeft') next = Math.max(current - 1, 0)
      else if (event.key === 'ArrowDown') next = Math.min(current + COLUMNS, last)
      else if (event.key === 'ArrowUp') {
        // Stepping off the top row returns to the search field rather than
        // trapping the keyboard inside the grid.
        if (current - COLUMNS < 0) {
          event.preventDefault()
          searchRef.current?.focus()
          return
        }
        next = current - COLUMNS
      } else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = last

      if (next === null) return
      event.preventDefault()
      focusCell(next)
    },
    [flatEntries.length, focusCell],
  )

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown' && flatEntries.length > 0) {
        event.preventDefault()
        focusCell(0)
        return
      }
      if (event.key === 'Enter' && flatEntries.length > 0) {
        event.preventDefault()
        commit(flatEntries[0])
      }
    },
    [flatEntries, focusCell, commit],
  )

  let cellIndex = -1

  return (
    <div className="absolute bottom-full left-0 z-50 mb-1" ref={containerRef}>
      <div className="qt-popover qt-emoji-picker">
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={handleSearchKeyDown}
          className="qt-input qt-emoji-picker-search"
          placeholder={profile.ui.searchPlaceholder}
          aria-label={profile.ui.searchAriaLabel}
        />

        {failed ? (
          <div className="qt-emoji-picker-message">{profile.ui.failedLabel}</div>
        ) : !index ? (
          <div className="qt-emoji-picker-message">{profile.ui.loadingLabel}</div>
        ) : sections.length === 0 ? (
          <div className="qt-emoji-picker-message">{profile.ui.emptyLabel}</div>
        ) : (
          <div className="qt-emoji-picker-grid" role="grid" aria-label={profile.ui.gridLabel}>
            {sections.map((section) => (
              <div key={section.key} role="rowgroup">
                <div className="qt-emoji-picker-group-header" role="presentation">
                  {section.label}
                </div>
                {chunk(section.entries, COLUMNS).map((row) => (
                  <div
                    key={`${section.key}-${row[0].char}`}
                    role="row"
                    className="qt-emoji-picker-row"
                  >
                    {row.map((entry) => {
                      cellIndex += 1
                      const position = cellIndex
                      return (
                        <button
                          key={entry.char}
                          ref={(node) => {
                            cellRefs.current[position] = node
                          }}
                          type="button"
                          role="gridcell"
                          // Roving tabindex: one stop for the whole grid, then
                          // arrow keys within it.
                          tabIndex={position === activeIndex ? 0 : -1}
                          // The dataset's label is there precisely so screen
                          // readers get it here.
                          aria-label={entry.name}
                          title={entry.name}
                          className="qt-emoji-picker-cell"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => commit(entry)}
                          onFocus={() => setActiveIndex(position)}
                          onKeyDown={(event) => handleGridKeyDown(event, position)}
                        >
                          {entry.char}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default CharPickerPanel
