'use client'

import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import type { CandidateItem, CandidateGroup } from './types'
import { GROUP_LABEL, GROUP_ORDER } from './constants'
import { WARDROBE_SLOT_META } from '@/lib/schemas/wardrobe.types'

interface WardrobeComponentPickerProps {
  effectiveTypes: WardrobeItemType[]
  selectedComponents: CandidateItem[]
  componentSearch: string
  candidatesLoading: boolean
  /** Full candidate list, for the empty-state message ("none to bundle" vs "no match"). */
  candidates: CandidateItem[]
  eligibleCandidates: CandidateItem[]
  groupedCandidates: Map<CandidateGroup, CandidateItem[]>
  expandedGroups: Set<CandidateGroup>
  componentItemIds: string[]
  replace: boolean
  computedTypes: WardrobeItemType[]
  showComponentsError: boolean
  onComponentSearchChange: (value: string) => void
  onComponentsBlur: () => void
  onToggleComponent: (id: string) => void
  onToggleGroup: (group: CandidateGroup) => void
  onToggleType: (type: WardrobeItemType) => void
  onReplaceChange: (checked: boolean) => void
}

/**
 * The bundle-mode components section: the auto-derived coverage badges, the
 * currently-selected component chips, the searchable grouped candidate list, and
 * the replace-slots designation. Purely presentational — all state lives in the
 * parent {@link ../../wardrobe-item-editor WardrobeItemEditor}.
 */
export function WardrobeComponentPicker({
  effectiveTypes,
  selectedComponents,
  componentSearch,
  candidatesLoading,
  candidates,
  eligibleCandidates,
  groupedCandidates,
  expandedGroups,
  componentItemIds,
  replace,
  computedTypes,
  showComponentsError,
  onComponentSearchChange,
  onComponentsBlur,
  onToggleComponent,
  onToggleGroup,
  onToggleType,
  onReplaceChange,
}: WardrobeComponentPickerProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1 gap-2">
        <span className="qt-label">
          Components <span className="qt-text-xs qt-text-secondary">(auto types)</span>
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          {effectiveTypes.length === 0 ? (
            <span className="qt-text-xs qt-text-secondary italic">
              no slots covered yet
            </span>
          ) : (
            effectiveTypes.map((t) => (
              <span
                key={t}
                className={`qt-badge ${WARDROBE_SLOT_META[t].badgeClass} uppercase`}
              >
                {t}
              </span>
            ))
          )}
        </div>
      </div>
      <p className="qt-text-xs qt-text-small mb-2">
        Pick the items this outfit bundles together.
      </p>

      {selectedComponents.length > 0 && (
        <div className="mb-2">
          <p className="qt-text-xs qt-text-secondary mb-1">
            Currently in this outfit:
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedComponents.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded-full qt-bg-muted border qt-border-default px-2 py-0.5 qt-text-xs"
              >
                {c.title}
                {c.isShared ? (
                  <span className="qt-badge qt-badge-info ml-1">
                    shared
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={`Remove ${c.title}`}
                  onClick={() => onToggleComponent(c.id)}
                  className="qt-text-secondary hover:text-foreground"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <input
        type="search"
        value={componentSearch}
        onChange={(e) => onComponentSearchChange(e.target.value)}
        onBlur={onComponentsBlur}
        placeholder="Search items to add as components…"
        className="qt-input mb-2"
      />

      <div className="max-h-64 overflow-y-auto rounded border qt-border-default qt-bg-muted/40">
        {candidatesLoading ? (
          <div className="px-3 py-2 qt-text-small qt-text-secondary">
            Loading…
          </div>
        ) : eligibleCandidates.length === 0 ? (
          <div className="px-3 py-2 qt-text-small qt-text-secondary">
            {candidates.length === 0
              ? 'No other wardrobe items to bundle.'
              : 'No candidates match your filter.'}
          </div>
        ) : (
          GROUP_ORDER.map((group) => {
            const items = groupedCandidates.get(group) ?? []
            if (items.length === 0) return null
            const expanded = expandedGroups.has(group)
            return (
              <div key={group}>
                <button
                  type="button"
                  onClick={() => onToggleGroup(group)}
                  className="w-full flex items-center justify-between px-3 py-1.5 qt-bg-muted/60 hover:qt-bg-muted text-sm font-medium qt-text-primary"
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true">{expanded ? '▼' : '▶'}</span>
                    <span>{GROUP_LABEL[group]}</span>
                    <span className="qt-text-xs qt-text-secondary">
                      ({items.length})
                    </span>
                  </span>
                </button>
                {expanded && (
                  <ul className="divide-y qt-border-default">
                    {items.map((c) => {
                      const checked = componentItemIds.includes(c.id)
                      return (
                        <li key={c.id}>
                          <label className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:qt-bg-muted">
                            <input
                              type="checkbox"
                              className="qt-checkbox"
                              checked={checked}
                              onChange={() => onToggleComponent(c.id)}
                            />
                            <span className="flex-1 truncate text-sm text-foreground">
                              {c.title}
                              {c.isShared ? (
                                <span className="ml-1 qt-badge qt-badge-info">
                                  shared
                                </span>
                              ) : null}
                            </span>
                            <span className="qt-text-xs qt-text-secondary">
                              {c.types.join(', ')}
                              {c.componentItemIds.length > 0 ? ' · bundle' : ''}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })
        )}
      </div>
      {showComponentsError && (
        <p className="mt-1 text-xs qt-text-destructive">
          Add at least one component
        </p>
      )}

      {/* Composite equip behaviour: additive (default) vs replace. */}
      <div className="mt-3 border-t qt-border-default pt-3">
        <label
          className="inline-flex items-start gap-2 cursor-pointer"
          title="Check this if the outfit should replace everything in its designated slots."
        >
          <input
            type="checkbox"
            className="qt-checkbox mt-0.5"
            checked={replace}
            onChange={(e) => onReplaceChange(e.target.checked)}
          />
          <span className="text-sm text-foreground">
            Replace everything in its designated slots
            <span className="block qt-text-xs qt-text-muted">
              Off by default this outfit layers onto whatever&apos;s already worn.
              Check it to clear its designated slots first.
            </span>
          </span>
        </label>

        {replace && (
          <div className="mt-2">
            <p className="qt-text-xs qt-text-secondary mb-1">
              Slots this outfit clears (its components&apos; slots are always included):
            </p>
            <div className="flex flex-wrap gap-3">
              {WARDROBE_SLOT_TYPES.map((slot) => {
                const locked = computedTypes.includes(slot)
                const checked = effectiveTypes.includes(slot)
                return (
                  <label
                    key={slot}
                    className={`inline-flex items-center gap-1.5 ${
                      locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                    title={locked ? 'Covered by a component — always cleared' : undefined}
                  >
                    <input
                      type="checkbox"
                      className="qt-checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={() => onToggleType(slot)}
                    />
                    <span className="text-sm capitalize text-foreground">{slot}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
