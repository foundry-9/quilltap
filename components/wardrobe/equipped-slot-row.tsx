'use client'

/**
 * Equipped Slot Row
 *
 * One slot in the dialog's "Wearing now" column. Lists the items currently
 * occupying the slot (as removable chips) and exposes a "+" picker that
 * adds another item from the wardrobe. Composite items in the equipped state
 * are rendered as a single chip with a `· composite` note.
 *
 * The chip removes the **stored** id (which may be a composite) — leaf
 * expansion is purely for display labels.
 */

import { useMemo, useState, useRef, useEffect } from 'react'
import { WARDROBE_SLOT_META } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'

interface EquippedSlotRowProps {
  slot: WardrobeItemType
  /** IDs currently in this slot (may include composites). */
  equippedIds: string[]
  /** All wardrobe items for the selected character (incl. archetypes). */
  allItems: WardrobeItem[]
  onAdd: (slot: WardrobeItemType, itemId: string) => void
  onRemove: (slot: WardrobeItemType, itemId: string) => void
  onClear: (slot: WardrobeItemType) => void
}

export function EquippedSlotRow({
  slot,
  equippedIds,
  allItems,
  onAdd,
  onRemove,
  onClear,
}: EquippedSlotRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])

  // Close picker on Escape — capture phase + stopPropagation so the parent
  // dialog's Escape handler doesn't also fire and dismiss the whole modal.
  useEffect(() => {
    if (!pickerOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        setPickerOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [pickerOpen])

  const itemsById = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems])

  const equippedItems = useMemo(
    () => equippedIds.map((id) => ({ id, item: itemsById.get(id) ?? null })),
    [equippedIds, itemsById],
  )

  const candidates = useMemo(() => {
    const equipped = new Set(equippedIds)
    const term = search.trim().toLowerCase()
    return allItems
      .filter((i) => i.types.includes(slot))
      .filter((i) => !equipped.has(i.id))
      .filter((i) => (term ? i.title.toLowerCase().includes(term) : true))
  }, [allItems, slot, equippedIds, search])

  return (
    <div className="qt-card py-2 px-3">
      <div className="flex items-center justify-between mb-1">
        <span className={`qt-badge ${WARDROBE_SLOT_META[slot].badgeClass}`}>{WARDROBE_SLOT_META[slot].label}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="qt-button-ghost qt-button-sm"
            title={`Wear something in ${WARDROBE_SLOT_META[slot].label.toLowerCase()} (fills every slot it covers)`}
          >
            +
          </button>
          {equippedIds.length > 0 && (
            <button
              type="button"
              onClick={() => onClear(slot)}
              className="qt-button-ghost qt-button-sm qt-text-secondary"
              title={`Clear ${WARDROBE_SLOT_META[slot].label.toLowerCase()}`}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {equippedItems.length === 0 ? (
        <div className="qt-text-xs qt-text-secondary italic">Empty</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {equippedItems.map(({ id, item }) => {
            const isComposite = item ? item.componentItemIds.length > 0 : false
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full qt-bg-muted border qt-border-default px-2 py-0.5 qt-text-xs"
              >
                {item?.title ?? <span className="qt-text-secondary italic">unknown</span>}
                {isComposite && <span className="qt-text-secondary">· bundle</span>}
                <button
                  type="button"
                  aria-label={`Remove ${item?.title ?? 'item'}`}
                  onClick={() => onRemove(slot, id)}
                  className="qt-text-secondary hover:text-foreground"
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}

      {pickerOpen && (
        <div
          ref={pickerRef}
          className="mt-2 rounded border qt-border-default qt-bg-muted/40 max-h-64 overflow-y-auto"
        >
          <div className="p-2">
            <input
              type="search"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${WARDROBE_SLOT_META[slot].label.toLowerCase()} items…`}
              className="qt-input qt-input-sm w-full"
            />
          </div>
          {candidates.length === 0 ? (
            <div className="px-3 py-2 qt-text-xs qt-text-secondary">
              No matching items.
            </div>
          ) : (
            <ul className="divide-y qt-border-default">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onAdd(slot, c.id)
                      setPickerOpen(false)
                      setSearch('')
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:qt-bg-muted"
                  >
                    <span className="truncate text-sm text-foreground">{c.title}</span>
                    <span className="qt-text-xs qt-text-secondary">
                      {c.types.join(', ')}
                      {c.componentItemIds.length > 0 ? ' · composite' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
