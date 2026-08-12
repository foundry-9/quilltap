'use client'

/**
 * Wardrobe Item Row
 *
 * One line in the dialog's wardrobe list. Shows the item title (allowed to
 * wrap to two lines, with a hover tooltip for the full title), slot-color
 * chips, and three controls:
 *
 *  - Primary equip button (`Wear` / `Try on`, label depends on which right-
 *    column tab is active).
 *  - `[+]` icon that adds the item to a slot. For single-slot items this
 *    targets the item's only slot directly; for multi-slot items it opens
 *    a small popover that lets the user pick.
 *  - `⋮` kebab menu with secondary actions: Edit, toggle the default-outfit
 *    flag, Duplicate, Move, Copy, and Delete.
 *
 * Composite items keep a `▶/▼` expander on the left so the user can peek at
 * the components without entering the editor.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'

interface WardrobeItemRowProps {
  item: WardrobeItem
  /** All items in the cache (this character + shared archetypes) — used to render composite components inline. */
  allItems: WardrobeItem[]
  /** When set, equip controls are visible. */
  inChat: boolean
  /** Label for the equip-replace button. Defaults to "Wear". */
  equipLabel?: string
  /**
   * Whether the `[+]` icon should be framed as "layer onto" (Live outfit) or
   * "add to" (Outfit Builder). Affects the tooltip only.
   */
  addAction?: 'layer' | 'add'
  isUpdatingDefault?: boolean
  onToggleDefault: (item: WardrobeItem) => void
  onEdit: (item: WardrobeItem) => void
  onDuplicate: (item: WardrobeItem) => void
  onMove: (item: WardrobeItem) => void
  onCopy: (item: WardrobeItem) => void
  onDelete: (item: WardrobeItem) => void
  onEquip?: (item: WardrobeItem) => void
  onAddToSlot?: (item: WardrobeItem, slot: WardrobeItemType) => void
  /** Nesting depth for composite components — used for indentation. */
  depth?: number
}

const TYPE_BADGE_CLASS: Record<WardrobeItemType, string> = {
  top: 'qt-badge-wardrobe-top',
  bottom: 'qt-badge-wardrobe-bottom',
  footwear: 'qt-badge-wardrobe-footwear',
  accessories: 'qt-badge-wardrobe-accessories',
}

const SLOT_LABEL: Record<WardrobeItemType, string> = {
  top: 'Top',
  bottom: 'Bottom',
  footwear: 'Footwear',
  accessories: 'Accessories',
}

export function WardrobeItemRow({
  item,
  allItems,
  inChat,
  equipLabel = 'Wear',
  addAction = 'layer',
  isUpdatingDefault,
  onToggleDefault,
  onEdit,
  onDuplicate,
  onMove,
  onCopy,
  onDelete,
  onEquip,
  onAddToSlot,
  depth = 0,
}: WardrobeItemRowProps) {
  const isComposite = item.componentItemIds.length > 0
  const [expanded, setExpanded] = useState(false)
  const isShared = !item.characterId

  const [slotPickerOpen, setSlotPickerOpen] = useState(false)
  const [kebabOpen, setKebabOpen] = useState(false)
  const slotPickerRef = useRef<HTMLDivElement>(null)
  const kebabRef = useRef<HTMLDivElement>(null)

  // Close popovers on outside click
  useEffect(() => {
    if (!slotPickerOpen && !kebabOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (
        slotPickerOpen &&
        slotPickerRef.current &&
        !slotPickerRef.current.contains(e.target as Node)
      ) {
        setSlotPickerOpen(false)
      }
      if (
        kebabOpen &&
        kebabRef.current &&
        !kebabRef.current.contains(e.target as Node)
      ) {
        setKebabOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [slotPickerOpen, kebabOpen])

  // Close popovers on Escape — capture phase + stopPropagation so the parent
  // dialog's Escape handler doesn't dismiss the entire modal.
  useEffect(() => {
    if (!slotPickerOpen && !kebabOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (slotPickerOpen) {
        e.stopPropagation()
        e.preventDefault()
        setSlotPickerOpen(false)
      }
      if (kebabOpen) {
        e.stopPropagation()
        e.preventDefault()
        setKebabOpen(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [slotPickerOpen, kebabOpen])

  const components = useMemo(() => {
    if (!isComposite) return []
    const byId = new Map(allItems.map((i) => [i.id, i]))
    return item.componentItemIds
      .map((id) => byId.get(id))
      .filter((c): c is WardrobeItem => Boolean(c))
  }, [allItems, item.componentItemIds, isComposite])

  const handleAddClick = (): void => {
    if (!onAddToSlot) return
    if (item.types.length === 1) {
      onAddToSlot(item, item.types[0])
      return
    }
    setSlotPickerOpen((v) => !v)
  }

  const addTooltip =
    item.types.length === 1
      ? `${addAction === 'layer' ? 'Layer onto' : 'Add to'} ${SLOT_LABEL[item.types[0]].toLowerCase()}`
      : addAction === 'layer'
        ? 'Layer onto a slot'
        : 'Add to a slot'

  return (
    <div
      className="qt-card-interactive py-2 px-3"
      style={{ marginLeft: depth > 0 ? `${depth * 12}px` : undefined }}
    >
      <div className="flex items-start gap-2">
        {isComposite ? (
          <button
            type="button"
            className="qt-text-secondary hover:text-foreground mt-0.5"
            aria-label={expanded ? 'Collapse components' : 'Expand components'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="inline-block w-3" aria-hidden />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="qt-text-sm text-foreground"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
                maxWidth: '100%',
                minWidth: 0,
              }}
              title={item.title}
            >
              {item.title}
            </span>
            {isComposite && (
              <span className="qt-text-xs qt-text-secondary">· bundle</span>
            )}
            {isShared && <span className="qt-text-xs qt-text-secondary">· shared</span>}
            {item.isDefault && (
              <span className="qt-text-xs qt-text-secondary">· default</span>
            )}
            {item.types.map((t) => (
              <span key={t} className={`qt-badge ${TYPE_BADGE_CLASS[t]}`}>
                {t}
              </span>
            ))}
          </div>
          {item.appropriateness && (
            <div className="qt-text-xs qt-text-secondary truncate mt-0.5">
              {item.appropriateness}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Primary equip button — label depends on the active right-column
              tab (Wear in Live outfit, Try on in Outfit Builder). */}
          {inChat && onEquip && (
            <button
              type="button"
              onClick={() => onEquip(item)}
              className="qt-button-ghost qt-button-sm"
              title="Puts it on across every slot it covers — layers or replaces per the item's setting"
            >
              {equipLabel}
            </button>
          )}

          {/* Single-icon add button. For single-typed items it adds directly;
              for multi-typed it opens a slot picker. */}
          {inChat && onAddToSlot && (
            <div className="relative">
              <button
                type="button"
                onClick={handleAddClick}
                className="qt-button-ghost qt-button-sm"
                title={addTooltip}
                aria-label={addTooltip}
              >
                +
              </button>
              {slotPickerOpen && item.types.length > 1 && (
                <div
                  ref={slotPickerRef}
                  className="absolute right-0 top-full mt-1 z-30 min-w-[10rem] rounded border qt-border-default qt-bg-default shadow-md"
                >
                  <ul className="divide-y qt-border-default">
                    {item.types.map((slot) => (
                      <li key={slot}>
                        <button
                          type="button"
                          onClick={() => {
                            onAddToSlot(item, slot)
                            setSlotPickerOpen(false)
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:qt-bg-muted"
                        >
                          <span>{SLOT_LABEL[slot]}</span>
                          <span className={`qt-badge ${TYPE_BADGE_CLASS[slot]}`}>
                            {slot}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Kebab menu — item actions */}
          <div className="relative" ref={kebabRef}>
              <button
                type="button"
                onClick={() => setKebabOpen((v) => !v)}
                className="qt-button-ghost qt-button-sm"
                aria-label="More actions"
                title="More actions"
                aria-haspopup="menu"
                aria-expanded={kebabOpen}
              >
                ⋮
              </button>
              {kebabOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 z-30 min-w-[14rem] rounded border qt-border-default qt-bg-default shadow-md"
                >
                  <ul className="divide-y qt-border-default">
                    {!isShared && (
                      <>
                        <li>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setKebabOpen(false)
                              onEdit(item)
                            }}
                            className="block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted"
                          >
                            Edit
                          </button>
                        </li>
                        <li>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={isUpdatingDefault}
                            onClick={() => {
                              setKebabOpen(false)
                              onToggleDefault(item)
                            }}
                            className="block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted disabled:opacity-50"
                          >
                            {item.isDefault
                              ? '☆ Unmark as default'
                              : '★ Mark as default outfit item'}
                          </button>
                        </li>
                        <li>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setKebabOpen(false)
                              onDuplicate(item)
                            }}
                            className="block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted"
                          >
                            Duplicate
                          </button>
                        </li>
                      </>
                    )}
                    <li>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setKebabOpen(false)
                          onMove(item)
                        }}
                        className="block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted"
                      >
                        Move
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setKebabOpen(false)
                          onCopy(item)
                        }}
                        className="block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted"
                      >
                        Copy
                      </button>
                    </li>
                    {!isShared && (
                      <li>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setKebabOpen(false)
                            onDelete(item)
                          }}
                          className="block w-full text-left px-3 py-2 text-sm qt-text-destructive hover:qt-bg-muted"
                        >
                          Delete
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
        </div>
      </div>

      {/* Nested components (read-only here; click Edit to change) */}
      {isComposite && expanded && (
        <div className="mt-2 border-l-2 qt-border-default pl-2 space-y-1">
          {components.length === 0 ? (
            <div className="qt-text-xs qt-text-secondary px-2 py-1">
              Components missing from this wardrobe.
            </div>
          ) : (
            components.map((c) => (
              <WardrobeItemRow
                key={c.id}
                item={c}
                allItems={allItems}
                inChat={false}
                onToggleDefault={onToggleDefault}
                onEdit={onEdit}
                onDuplicate={onDuplicate}
                onMove={onMove}
                onCopy={onCopy}
                onDelete={onDelete}
                depth={depth + 1}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
