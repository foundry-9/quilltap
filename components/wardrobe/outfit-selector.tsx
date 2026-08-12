'use client'

/**
 * Outfit Selector Component
 *
 * Allows selecting outfit modes and manual slot assignments for
 * LLM-controlled characters when creating a new chat.
 *
 * The `Compose outfit` mode (was `Choose Outfit`) reveals an embedded
 * `<OutfitComposer>` — the same component the wardrobe dialog uses for the
 * Outfit Builder tab — seeded from the character's default-outfit items.
 *
 * @module components/wardrobe/outfit-selector
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type {
  OutfitSelectionMode,
  WardrobeItem,
  WardrobeItemType,
  EquippedSlots,
} from '@/lib/schemas/wardrobe.types'
import { EMPTY_EQUIPPED_SLOTS } from '@/lib/schemas/wardrobe.types'
import { useCharacterWardrobeItems } from '@/lib/hooks/use-character-wardrobe-items'
import { buildDefaultOutfit } from '@/lib/wardrobe/default-outfit'
import { wearItemIntoSlots } from '@/lib/wardrobe/outfit-displacement'
import type { EquippedBundle } from '@/lib/wardrobe/group-equipped'
import {
  breakApartBundleInSlots,
  takeOffBundleFromSlots,
} from '@/lib/wardrobe/bundle-mutations'
import { OutfitComposer } from './outfit-composer'

// ============================================================================
// TYPES
// ============================================================================

export interface OutfitSelection {
  characterId: string
  mode: OutfitSelectionMode
  slots?: EquippedSlots
}

export interface OutfitSelectorCharacter {
  id: string
  name: string
  /**
   * Whether this character is controlled by the human operator (as opposed
   * to an LLM). User-controlled characters don't get the `Let character
   * choose` mode — for them, this dialog *is* the choosing.
   */
  isUserControlled?: boolean
  /**
   * The character's `canChooseOutfit` property (from their vault
   * `properties.json`). When true — and the character is LLM-controlled — a
   * fresh (non-continuation) chat defaults this character's Starting Outfit to
   * `Let character choose` rather than `Use defaults`.
   */
  canChooseOutfit?: boolean
}

// ============================================================================
// MODE SUMMARY LABELS
//
// Short badges shown on a character's collapsed "Starting Outfit" header so the
// chosen mode is legible without expanding the section.
// ============================================================================

const MODE_SUMMARY_LABELS: Record<OutfitSelectionMode, string> = {
  default: 'Defaults',
  manual: 'Composed',
  llm_choose: 'Dress Themselves',
  none: 'Undressed',
  previous_chat: 'Same as Last',
}

/**
 * The Starting Outfit mode a character opens with, computed from what we can
 * know synchronously. Continuation chats carry the previous outfit forward;
 * an LLM-controlled character flagged `canChooseOutfit` defaults to letting
 * the character choose. Everyone else provisionally opens on `default` and is
 * refined to `default`-vs-`manual` once their wardrobe loads (see
 * {@link CharacterOutfitSection}) — a character with no usable default outfit
 * lands on `manual` with the section expanded.
 */
function computeSyncInitialMode(
  char: OutfitSelectorCharacter,
  sourceChatId?: string | null,
): OutfitSelectionMode {
  if (sourceChatId) return 'previous_chat'
  if (char.canChooseOutfit && !char.isUserControlled) return 'llm_choose'
  return 'default'
}

/**
 * Per-character per-slot summary of what was equipped at the end of a source
 * chat. Each slot is an array of resolved items (composites already expanded
 * server-side). Surfaced in the UI when the new chat is a "change of venue"
 * continuation.
 */
export type PreviousOutfitSummary = Record<
  string,
  Partial<Record<'top' | 'bottom' | 'footwear' | 'accessories', Array<{ itemId: string; title: string }>>>
>

export interface OutfitSelectorProps {
  /** LLM-controlled characters in this chat */
  characters: OutfitSelectorCharacter[]
  /** Callback when selections change */
  onSelectionsChange: (selections: OutfitSelection[]) => void
  /** Whether the parent form is submitting */
  disabled?: boolean
  /**
   * Continuation mode: when set, exposes a "Same as last conversation" option
   * that copies each character's equipped outfit forward from the source chat.
   */
  sourceChatId?: string | null
  previousOutfitSummary?: PreviousOutfitSummary | null
  /** Project the new chat will belong to — folds the project wardrobe tier into manual pickers. */
  projectId?: string | null
  /** Existing chat (when adding a participant) — the project tier is derived from it. */
  chatId?: string | null
}

// ============================================================================
// SLOT LABELS
// ============================================================================

const SLOT_LABELS: Record<WardrobeItemType, string> = {
  top: 'Top',
  bottom: 'Bottom',
  footwear: 'Footwear',
  accessories: 'Accessories',
}

// ============================================================================
// PER-CHARACTER SECTION
// ============================================================================

interface CharacterOutfitSectionProps {
  character: OutfitSelectorCharacter
  selection: OutfitSelection
  onChange: (selection: OutfitSelection) => void
  disabled?: boolean
  /** Whether to show the character name header (hidden for single character) */
  showHeader: boolean
  /**
   * Continuation mode flag for this character. When true (source chat present),
   * the section never auto-resolves its mode against the wardrobe — the parent
   * has already seeded `previous_chat`.
   */
  isContinuation?: boolean
  /**
   * Continuation mode: enables the "Same as last conversation" radio option
   * for this character.
   */
  showPreviousChatOption?: boolean
  /**
   * Continuation mode: per-slot summary of what this character was wearing
   * at the end of the source chat. Rendered as a small preview under the
   * "Same as last conversation" option.
   */
  previousChatSlots?: Partial<Record<'top' | 'bottom' | 'footwear' | 'accessories', Array<{ itemId: string; title: string }>>> | null
  /** Project this chat will belong to — folds the project wardrobe tier into the picker. */
  projectId?: string | null
  /** Existing chat (when adding a participant) — the project tier is derived from it. */
  chatId?: string | null
}

function CharacterOutfitSection({
  character,
  selection,
  onChange,
  disabled,
  showHeader,
  isContinuation,
  showPreviousChatOption,
  previousChatSlots,
  projectId,
  chatId,
}: CharacterOutfitSectionProps) {
  const [internalMode, setInternalMode] = useState<OutfitSelectionMode>(selection.mode)

  // Does this character's opening mode still need to be resolved against their
  // wardrobe? Continuation chats (previous_chat) and LLM-choose characters are
  // settled synchronously by the parent; everyone else provisionally opens on
  // `default` and must be refined to `default`-vs-`manual` here — a character
  // with no usable default outfit lands on `manual`, expanded.
  const needsDefaultResolution =
    !isContinuation && !(character.canChooseOutfit && !character.isUserControlled)
  const [autoResolved, setAutoResolved] = useState(!needsDefaultResolution)

  // Open expanded when we already know the character has to compose from
  // scratch; otherwise start collapsed. Auto-resolution below expands the
  // section if it lands on `manual`.
  const [expanded, setExpanded] = useState(false)

  // Load wardrobe (personal + project + archetypes) when we're in manual mode
  // OR while we still owe this character a default-vs-manual resolution. The
  // hook returns an empty list before items are needed.
  const wardrobeNeeded = internalMode === 'manual' || (needsDefaultResolution && !autoResolved)
  const {
    items: allWardrobeItems,
    loading: loadingWardrobe,
    fetched: wardrobeItemsFetched,
  } = useCharacterWardrobeItems(wardrobeNeeded ? character.id : null, { projectId, chatId })
  const wardrobeFetched = !loadingWardrobe && allWardrobeItems.length > 0

  // Visible items: skip archived and items lacking any of the four slots
  // (defensive — schemas already enforce non-empty types).
  const wardrobeItems = useMemo(
    () => allWardrobeItems.filter((i) => !i.archivedAt),
    [allWardrobeItems],
  )

  const itemsById = useMemo(
    () => new Map(wardrobeItems.map((i) => [i.id, i])),
    [wardrobeItems],
  )

  // Resolve the provisional opening mode once the wardrobe has been read. A
  // character with a usable default outfit (any non-archived default item —
  // someone deliberately configured defaults) opens on `Use defaults`; one
  // with none opens on `Compose outfit`, expanded, so the empty slots are
  // visible. Runs at most once and never after the user has touched the radio
  // (handleModeChange pins `autoResolved`).
  useEffect(() => {
    if (autoResolved) return
    if (!wardrobeItemsFetched) return
    const defaults = buildDefaultOutfit(allWardrobeItems)
    const hasUsableDefault = (['top', 'bottom', 'footwear', 'accessories'] as const).some(
      (slot) => defaults[slot].length > 0,
    )
    const resolved: OutfitSelectionMode = hasUsableDefault ? 'default' : 'manual'
    /* eslint-disable react-hooks/set-state-in-effect -- a one-time latch that
       reacts to the async wardrobe load (guarded by wardrobeItemsFetched and
       autoResolved); the state lands after the fetch tick, not on every render. */
    setAutoResolved(true)
    setInternalMode(resolved)
    if (resolved === 'manual') setExpanded(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    onChange({ characterId: character.id, mode: resolved })
  }, [autoResolved, wardrobeItemsFetched, allWardrobeItems, character.id, onChange])

  // Track whether we've already seeded the manual slots from defaults — once
  // seeded, subsequent edits stay user-driven.
  const seededRef = useRef(false)
  useEffect(() => {
    if (internalMode !== 'manual') return
    if (seededRef.current) return
    if (wardrobeItems.length === 0) return
    if (selection.slots && Object.values(selection.slots).some((arr) => arr.length > 0)) {
      seededRef.current = true
      return
    }
    const defaults = buildDefaultOutfit(wardrobeItems)
    seededRef.current = true
    onChange({ characterId: character.id, mode: 'manual', slots: defaults })
  }, [internalMode, wardrobeItems, selection.slots, character.id, onChange])

  const handleModeChange = useCallback(
    (mode: OutfitSelectionMode) => {
      // A deliberate pick pins the mode so the wardrobe-driven auto-resolution
      // can't come back and clobber it a tick later.
      setAutoResolved(true)
      setInternalMode(mode)
      const updated: OutfitSelection = {
        characterId: character.id,
        mode,
        slots:
          mode === 'manual'
            ? selection.slots ?? { ...EMPTY_EQUIPPED_SLOTS }
            : undefined,
      }
      onChange(updated)
    },
    [character.id, selection.slots, onChange],
  )

  // Wearing an item from the per-slot picker fills *every* slot it covers,
  // honoring its `replace` flag (layer when off, replace when on) — the same
  // rule the live chat uses. Picking a dress (top+bottom) or an outfit bundle
  // no longer lands in just the one slot the picker was opened from.
  const handleAddToSlot = useCallback(
    (slot: WardrobeItemType, itemId: string) => {
      const currentSlots = selection.slots ?? { ...EMPTY_EQUIPPED_SLOTS }
      const item = itemsById.get(itemId)
      const next = item
        ? wearItemIntoSlots(currentSlots, item)
        : { ...currentSlots, [slot]: [...(currentSlots[slot] ?? []), itemId] }
      onChange({ characterId: character.id, mode: 'manual', slots: next })
    },
    [character.id, selection.slots, itemsById, onChange],
  )

  const handleRemoveFromSlot = useCallback(
    (slot: WardrobeItemType, itemId: string) => {
      const currentSlots = selection.slots ?? { ...EMPTY_EQUIPPED_SLOTS }
      const next = {
        ...currentSlots,
        [slot]: (currentSlots[slot] ?? []).filter((id) => id !== itemId),
      }
      onChange({ characterId: character.id, mode: 'manual', slots: next })
    },
    [character.id, selection.slots, onChange],
  )

  const handleClearSlot = useCallback(
    (slot: WardrobeItemType) => {
      const currentSlots = selection.slots ?? { ...EMPTY_EQUIPPED_SLOTS }
      const next = { ...currentSlots, [slot]: [] }
      onChange({ characterId: character.id, mode: 'manual', slots: next })
    },
    [character.id, selection.slots, onChange],
  )

  const handleTakeOffBundle = useCallback(
    (bundle: EquippedBundle) => {
      const currentSlots = selection.slots ?? { ...EMPTY_EQUIPPED_SLOTS }
      const next = takeOffBundleFromSlots(currentSlots, bundle)
      onChange({ characterId: character.id, mode: 'manual', slots: next })
    },
    [character.id, selection.slots, onChange],
  )

  const handleBreakApartBundle = useCallback(
    (bundle: EquippedBundle) => {
      const currentSlots = selection.slots ?? { ...EMPTY_EQUIPPED_SLOTS }
      const next = breakApartBundleInSlots(currentSlots, bundle, itemsById)
      onChange({ characterId: character.id, mode: 'manual', slots: next })
    },
    [character.id, selection.slots, itemsById, onChange],
  )

  const handleClearAll = useCallback(() => {
    onChange({
      characterId: character.id,
      mode: 'manual',
      slots: { ...EMPTY_EQUIPPED_SLOTS },
    })
  }, [character.id, onChange])

  const modeOptions: Array<{
    value: OutfitSelectionMode
    label: string
    description?: string
  }> = [
    ...(showPreviousChatOption
      ? [
          {
            value: 'previous_chat' as OutfitSelectionMode,
            label: 'Same as last conversation',
            description:
              'Carry forward whatever they were wearing at the end of the source chat',
          },
        ]
      : []),
    {
      value: 'default',
      label: 'Use defaults',
      description: 'Items marked default in their wardrobe.',
    },
    {
      value: 'manual',
      label: 'Compose outfit',
      description: 'Pick the starting outfit slot by slot.',
    },
    ...(character.isUserControlled
      ? []
      : [
          {
            value: 'llm_choose' as OutfitSelectionMode,
            label: 'Let character choose',
            description: 'The character picks based on the scenario.',
          },
        ]),
    {
      value: 'none',
      label: 'Start undressed',
      description: 'Character will start undressed.',
    },
  ]

  const previousChatPreview = (() => {
    if (!previousChatSlots) return null
    const equipped = (['top', 'bottom', 'footwear', 'accessories'] as const)
      .map((slot) => {
        const items = previousChatSlots[slot] ?? []
        if (items.length === 0) return null
        return { slot, titles: items.map((i) => i.title) }
      })
      .filter(
        (entry): entry is {
          slot: 'top' | 'bottom' | 'footwear' | 'accessories'
          titles: string[]
        } => entry !== null,
      )
    if (equipped.length === 0) {
      return 'Nothing equipped at the end of the source chat — defaults will be used.'
    }
    return equipped
      .map((e) => `${SLOT_LABELS[e.slot]}: ${e.titles.join(', ')}`)
      .join(' · ')
  })()

  const stagedSlots = selection.slots ?? EMPTY_EQUIPPED_SLOTS

  return (
    <div className="rounded-lg border qt-border-default qt-bg-muted/20 p-3">
      {showHeader && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between text-left cursor-pointer"
          disabled={disabled}
        >
          <span className="text-sm font-medium qt-text-primary">{character.name}</span>
          <span className="flex items-center gap-2">
            <span className="text-xs qt-text-secondary">{MODE_SUMMARY_LABELS[internalMode]}</span>
            <Icon name="chevron-down" className={`w-4 h-4 qt-text-secondary transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </span>
        </button>
      )}

      {(expanded || !showHeader) && (
        <div className={showHeader ? 'mt-3' : ''}>
          {/* Mode selector */}
          <div className="space-y-1.5">
            {modeOptions.map((opt) => (
              <label
                key={opt.value}
                className="flex items-start gap-2 rounded px-2 py-1.5 text-sm transition cursor-pointer hover:qt-bg-muted/40"
              >
                <input
                  type="radio"
                  name={`outfit-mode-${character.id}`}
                  value={opt.value}
                  checked={internalMode === opt.value}
                  onChange={() => handleModeChange(opt.value)}
                  disabled={disabled}
                  className="mt-0.5 accent-[var(--primary)]"
                />
                <div className="flex-1 min-w-0">
                  <span className="qt-text-primary">{opt.label}</span>
                  {opt.description && (
                    <span className="ml-1.5 text-xs qt-text-secondary italic">
                      {opt.description}
                    </span>
                  )}
                </div>
              </label>
            ))}
          </div>

          {/* Compose outfit — embedded composer, with bundle actions and a
              `Clear all` escape hatch so the user isn't stuck with whatever
              the defaults seeded (e.g. a `Work` bundle they want to replace). */}
          {internalMode === 'manual' && (
            <div className="mt-3 pl-6">
              {loadingWardrobe ? (
                <p className="text-xs qt-text-secondary">Loading wardrobe…</p>
              ) : wardrobeItems.length === 0 && wardrobeFetched ? (
                <p className="text-xs qt-text-secondary italic">
                  No wardrobe items found. Add items in the character&apos;s wardrobe tab.
                </p>
              ) : (
                <>
                  <div className="flex justify-end mb-2">
                    <button
                      type="button"
                      onClick={handleClearAll}
                      disabled={disabled}
                      className="qt-button-ghost qt-button-sm"
                      title="Empty every slot and start from scratch"
                    >
                      Clear all
                    </button>
                  </div>
                  <OutfitComposer
                    items={wardrobeItems}
                    slots={stagedSlots}
                    onAddToSlot={handleAddToSlot}
                    onRemoveFromSlot={handleRemoveFromSlot}
                    onClearSlot={handleClearSlot}
                    showBundleActions
                    onTakeOffBundle={handleTakeOffBundle}
                    onBreakApartBundle={handleBreakApartBundle}
                  />
                </>
              )}
            </div>
          )}

          {/* Warning for "Start undressed" */}
          {internalMode === 'none' && (
            <div className="mt-2 ml-6 rounded border qt-border-warning/50 qt-bg-warning/10 px-2 py-1.5 text-xs qt-text-warning">
              Character will start undressed
            </div>
          )}

          {/* Continuation mode preview */}
          {internalMode === 'previous_chat' && previousChatPreview && (
            <div className="mt-2 ml-6 rounded border qt-border-default qt-bg-muted/40 px-2 py-1.5 text-xs qt-text-secondary">
              {previousChatPreview}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function OutfitSelector({
  characters,
  onSelectionsChange,
  disabled,
  sourceChatId,
  previousOutfitSummary,
  projectId,
  chatId,
}: OutfitSelectorProps) {
  // Seed each character's opening mode from what we can know synchronously
  // (see computeSyncInitialMode): continuation chats carry the previous outfit
  // forward; a `canChooseOutfit` character lets the character choose; everyone
  // else opens provisionally on `default` and each section refines that to
  // `default`-vs-`manual` once its wardrobe loads.
  const [selections, setSelections] = useState<Map<string, OutfitSelection>>(
    () => {
      const map = new Map<string, OutfitSelection>()
      for (const char of characters) {
        map.set(char.id, { characterId: char.id, mode: computeSyncInitialMode(char, sourceChatId) })
      }
      return map
    }
  )

  // Keep the selection map in step with the cast: characters added after the
  // dialog opened get their synchronous default seeded (so the form reports a
  // choice for them), and characters removed from the cast are dropped.
  // Existing entries are never overwritten, so a section's own resolution and
  // any user pick both survive.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing the selection map to a changed cast; the updater is a no-op (returns prev) once stable, so no cascading renders.
    setSelections((prev) => {
      let changed = false
      const next = new Map(prev)
      const liveIds = new Set(characters.map((c) => c.id))
      for (const char of characters) {
        if (!next.has(char.id)) {
          next.set(char.id, { characterId: char.id, mode: computeSyncInitialMode(char, sourceChatId) })
          changed = true
        }
      }
      for (const id of Array.from(next.keys())) {
        if (!liveIds.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [characters, sourceChatId])

  // Notify parent when selections change
  useEffect(() => {
    onSelectionsChange(Array.from(selections.values()))
  }, [selections, onSelectionsChange])

  const handleSelectionChange = useCallback(
    (selection: OutfitSelection) => {
      setSelections((prev) => {
        const next = new Map(prev)
        next.set(selection.characterId, selection)
        return next
      })
    },
    [],
  )

  if (characters.length === 0) return null

  const showHeaders = characters.length > 1

  return (
    <div className="space-y-2">
      <label className="mb-2 block text-sm qt-text-primary">Starting Outfit</label>
      {characters.map((char) => (
        <CharacterOutfitSection
          key={char.id}
          character={char}
          selection={
            selections.get(char.id) || {
              characterId: char.id,
              mode: computeSyncInitialMode(char, sourceChatId),
            }
          }
          onChange={handleSelectionChange}
          disabled={disabled}
          showHeader={showHeaders}
          isContinuation={Boolean(sourceChatId)}
          showPreviousChatOption={Boolean(sourceChatId)}
          previousChatSlots={previousOutfitSummary?.[char.id] ?? null}
          projectId={projectId}
          chatId={chatId}
        />
      ))}
    </div>
  )
}
