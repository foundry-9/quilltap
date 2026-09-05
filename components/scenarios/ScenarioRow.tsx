'use client'

/**
 * ScenarioRow — one width-adaptive row inside {@link ScenariosManager}.
 *
 * Purely presentational: every mutation lives in the manager (which owns the
 * confirm/prompt/error flow). This component only renders a single scenario and
 * owns the local open-state for its kebab menu.
 *
 * The row is **container-query adaptive** (Tailwind v4, no plugin). It renders
 * both control affordances and lets CSS pick one by the row's actual width:
 *
 *   - Wide container (`@lg` and up): inline `Edit / Rename / Archive / Delete`
 *     buttons.
 *   - Narrow container (below `@lg`, e.g. the project ScenariosCard at `xl`):
 *     a single `⋮` kebab menu, so the four actions never wrap.
 *
 * The kebab open-state mechanics (outside-`mousedown` + capture-phase `Escape`)
 * mirror `components/wardrobe/wardrobe-item-row.tsx`, the house pattern; the menu
 * chrome uses the existing `qt-dropdown` / `qt-dropdown-item` semantic classes.
 *
 * @module components/scenarios/ScenarioRow
 */

import { useEffect, useRef, useState } from 'react'
import type { Scenario } from './types'

interface ScenarioRowProps {
  scenario: Scenario
  /** Used in the default radio's title/aria copy. e.g. "project" or "general". */
  scopeLabel: string
  onSetDefault: (scenario: Scenario) => void
  onEdit: (scenario: Scenario) => void
  onRename: (scenario: Scenario) => void
  onDelete: (scenario: Scenario) => void
  /** Archive an active scenario, or restore an archived one. */
  onToggleArchived: (scenario: Scenario) => void
}

export function ScenarioRow({
  scenario,
  scopeLabel,
  onSetDefault,
  onEdit,
  onRename,
  onDelete,
  onToggleArchived,
}: ScenarioRowProps) {
  const [kebabOpen, setKebabOpen] = useState(false)
  const kebabRef = useRef<HTMLDivElement>(null)

  const archiveLabel = scenario.archived ? 'Restore' : 'Archive'

  // Close on outside pointer press while open.
  useEffect(() => {
    if (!kebabOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) {
        setKebabOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [kebabOpen])

  // Close on Escape while open (capture phase, mirroring the wardrobe row).
  useEffect(() => {
    if (!kebabOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      setKebabOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [kebabOpen])

  return (
    <li className="py-3 flex items-start gap-3">
      <input
        type="radio"
        checked={scenario.isDefault}
        onChange={() => onSetDefault(scenario)}
        // An archived scenario is barred from default resolution server-side;
        // offering the radio would just be a control that quietly does nothing.
        disabled={scenario.archived}
        className="qt-radio mt-1"
        title={
          scenario.archived
            ? 'Archived scenarios cannot be the default'
            : scenario.isDefault
              ? `${scopeLabel} default`
              : `Set as ${scopeLabel} default`
        }
        aria-label={`Set ${scenario.name} as ${scopeLabel} default`}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h4 className="qt-label truncate">{scenario.name}</h4>
          <span className="qt-text-xs qt-text-secondary truncate">
            {scenario.filename}.md
          </span>
          {scenario.isDefault && (
            // No qt-text-xs here: the badge already sizes itself via
            // --qt-badge-font-size, and qt-text-xs ALSO forces the muted
            // secondary text colour, which clobbers qt-badge-primary's own
            // foreground and goes illegible on bold-accent themes (e.g. amber
            // text on the amber primary fill in Madman's Box).
            <span className="qt-badge qt-badge-primary">Default</span>
          )}
          {scenario.archived && (
            <span className="qt-badge qt-badge-secondary">Archived</span>
          )}
        </div>
        {scenario.description && (
          <p className="qt-text-small qt-text-secondary mt-1">{scenario.description}</p>
        )}
      </div>

      {/* Wide container: inline action buttons. */}
      <div className="hidden @lg:flex items-center gap-1 shrink-0">
        <button
          onClick={() => onEdit(scenario)}
          className="qt-button qt-button-ghost qt-button-sm"
          title="Edit scenario"
        >
          Edit
        </button>
        <button
          onClick={() => onRename(scenario)}
          className="qt-button qt-button-ghost qt-button-sm"
          title="Rename file"
        >
          Rename
        </button>
        <button
          onClick={() => onToggleArchived(scenario)}
          className="qt-button qt-button-ghost qt-button-sm"
          title={
            scenario.archived
              ? 'Restore this scenario to the pickers'
              : 'Hide this scenario from the pickers'
          }
        >
          {archiveLabel}
        </button>
        <button
          onClick={() => onDelete(scenario)}
          className="qt-button qt-button-ghost qt-button-sm qt-text-destructive"
          title="Delete scenario"
        >
          Delete
        </button>
      </div>

      {/* Narrow container: kebab menu holding the same four actions. */}
      <div className="relative @lg:hidden shrink-0" ref={kebabRef}>
        <button
          type="button"
          onClick={() => setKebabOpen((v) => !v)}
          className="qt-button-ghost qt-button-sm"
          aria-label={`More actions for ${scenario.name}`}
          title="More actions"
          aria-haspopup="menu"
          aria-expanded={kebabOpen}
        >
          ⋮
        </button>
        {kebabOpen && (
          <div role="menu" className="qt-dropdown absolute right-0 top-full mt-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setKebabOpen(false)
                onEdit(scenario)
              }}
              className="qt-dropdown-item w-full text-left"
            >
              Edit
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setKebabOpen(false)
                onRename(scenario)
              }}
              className="qt-dropdown-item w-full text-left"
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setKebabOpen(false)
                onToggleArchived(scenario)
              }}
              className="qt-dropdown-item w-full text-left"
            >
              {archiveLabel}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setKebabOpen(false)
                onDelete(scenario)
              }}
              className="qt-dropdown-item w-full text-left qt-text-destructive"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  )
}
