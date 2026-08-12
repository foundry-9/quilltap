'use client'

/**
 * Wardrobe Control Dialog
 *
 * The global wardrobe-management surface. Reachable from a button on the
 * left sidebar (and from any participant card in a chat). Lets the operator:
 *
 *  1. Pick any character (in or out of chat) and view their wardrobe.
 *  2. Create / edit / delete wardrobe items, including composites.
 *  3. Toggle `isDefault` on each item via a star button.
 *  4. When invoked with a chat context: see the chat's "wearing now" outfit
 *     and equip / layer / clear items per slot using the existing
 *     `?action=equip` API.
 *  5. Generate a new avatar — replacing the live chat avatar in chat, or
 *     producing a downloadable preview when out of chat. Either path can
 *     pick a non-default image model for that one generation.
 *
 * Mounted once at the layout level by `WardrobeDialogProvider`.
 *
 * @module components/wardrobe/wardrobe-control-dialog
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWardrobeDialog } from '@/components/providers/wardrobe-dialog-provider'
import { BaseModal } from '@/components/ui/BaseModal'
import { fetchJson } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { WARDROBE_SLOT_TYPES, EMPTY_EQUIPPED_SLOTS } from '@/lib/schemas/wardrobe.types'
import type { EquippedSlots, WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { useOutfit } from '@/lib/hooks/use-outfit'
import { type EquippedBundle } from '@/lib/wardrobe/group-equipped'
import {
  breakApartBundleInSlots,
  cloneSlots,
  takeOffBundleFromSlots,
} from '@/lib/wardrobe/bundle-mutations'
import { buildDefaultOutfit } from '@/lib/wardrobe/default-outfit'
import { wearItemIntoSlots } from '@/lib/wardrobe/outfit-displacement'
import { nextCopyTitle } from '@/lib/wardrobe/next-copy-title'
import { useCharacterWardrobeItems } from '@/lib/hooks/use-character-wardrobe-items'
import { WardrobeItemEditor } from './wardrobe-item-editor'
import { WardrobeItemRow } from './wardrobe-item-row'
import { OutfitComposer } from './outfit-composer'
import { ImportFromImageModal } from './import-from-image-modal'
import { WardrobeTransferDialog } from './WardrobeTransferDialog'

interface CharacterSummary {
  id: string
  name: string
  avatarUrl?: string | null
}

interface ImageProfileSummary {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
}

type SlotFilter = 'all' | WardrobeItemType
const SLOT_FILTERS: SlotFilter[] = ['all', 'top', 'bottom', 'footwear', 'accessories']
type ItemKind = 'items' | 'outfits'
type RightTab = 'live' | 'builder'
type EditorIntent = 'create-single' | 'create-bundle'
type TransferIntent = 'move' | 'copy'

/** Deep array equality on the four EquippedSlots arrays, in order. */
function equippedSlotsEqual(a: EquippedSlots, b: EquippedSlots): boolean {
  for (const slot of WARDROBE_SLOT_TYPES) {
    const av = a[slot]
    const bv = b[slot]
    if (av.length !== bv.length) return false
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false
    }
  }
  return true
}

/**
 * Wrapper component used by the layout. Reads context from the provider and
 * renders the inner dialog only when open.
 */
export function WardrobeControlDialog() {
  const dialog = useWardrobeDialog()
  if (!dialog.isOpen) return null
  return (
    <WardrobeControlDialogInner
      key={`${dialog.context?.characterId ?? 'auto'}|${dialog.context?.chatId ?? 'no-chat'}`}
      initialCharacterId={dialog.context?.characterId ?? null}
      chatId={dialog.context?.chatId ?? null}
      onClose={dialog.close}
    />
  )
}

/**
 * WardrobeView — the Wardrobe as a left-rail workspace tab. Browse/edit only
 * (no `chatId`, so no "wearing now" column). The chat-scoped path keeps the
 * dialog (which can change what a character is actively wearing). Singleton.
 */
export function WardrobeView({ characterId }: { characterId?: string }) {
  return (
    <WardrobeControlDialogInner
      asTab
      initialCharacterId={characterId ?? null}
      chatId={null}
      onClose={() => {}}
    />
  )
}

interface InnerProps {
  initialCharacterId: string | null
  chatId: string | null
  onClose: () => void
  /** Render bare for a workspace tab instead of inside the floating modal. */
  asTab?: boolean
}

/**
 * Renders the wardrobe body inside the floating `BaseModal` (dialog) or bare in
 * a scrollable container (workspace tab). Keeps the wardrobe logic in one place.
 */
function WardrobeShell({
  asTab,
  onClose,
  footer,
  closeOnClickOutside,
  closeOnEscape,
  children,
}: {
  asTab?: boolean
  onClose: () => void
  footer: React.ReactNode
  closeOnClickOutside: boolean
  closeOnEscape: boolean
  children: React.ReactNode
}) {
  if (asTab) {
    return (
      <div className="qt-wardrobe-tab flex flex-col h-full min-h-0 overflow-y-auto p-4">
        {children}
      </div>
    )
  }
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title="Wardrobe"
      maxWidth="4xl"
      showCloseButton
      closeOnClickOutside={closeOnClickOutside}
      closeOnEscape={closeOnEscape}
      footer={footer}
    >
      {children}
    </BaseModal>
  )
}

function WardrobeControlDialogInner({
  initialCharacterId,
  chatId,
  onClose,
  asTab = false,
}: InnerProps) {
  const [characters, setCharacters] = useState<CharacterSummary[]>([])
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(initialCharacterId)
  const { items, loading: itemsLoading, reload: reloadItems, projectId: dialogProjectId } =
    useCharacterWardrobeItems(selectedCharacterId, { chatId })
  const [editingItem, setEditingItem] = useState<WardrobeItem | null>(null)
  const [transferringItem, setTransferringItem] = useState<WardrobeItem | null>(null)
  const [transferIntent, setTransferIntent] = useState<TransferIntent | null>(null)
  /** null = no editor open; 'create-single' / 'create-bundle' = new item in that mode */
  const [creatingNew, setCreatingNew] = useState<EditorIntent | null>(null)
  /** Pre-populated component ids when Save-as-outfit opens the editor in bundle mode. */
  const [createBundleComponents, setCreateBundleComponents] = useState<string[]>([])
  const [importFromImageOpen, setImportFromImageOpen] = useState(false)
  const [slotFilter, setSlotFilter] = useState<SlotFilter>('all')
  const [kindFilter, setKindFilter] = useState<ItemKind>('items')
  const [titleFilter, setTitleFilter] = useState('')
  const [updatingDefaultId, setUpdatingDefaultId] = useState<string | null>(null)

  // Image profiles + avatar gen state
  const [imageProfiles, setImageProfiles] = useState<ImageProfileSummary[]>([])
  const [selectedImageProfileId, setSelectedImageProfileId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewFilename, setPreviewFilename] = useState<string | null>(null)

  // Fitting room — a transient outfit composition used as the avatar source.
  // Distinct from the chat's stored `equippedOutfit` (the "Wearing now" tab):
  // changes here never hit the equip API. Seeded from Wearing now (in chat)
  // or from the character's defaults (out of chat) when the character loads.
  const [fittingSlots, setFittingSlots] = useState<EquippedSlots>(() => ({
    ...EMPTY_EQUIPPED_SLOTS,
  }))
  const isInChat = chatId !== null
  const [rightTab, setRightTab] = useState<RightTab>(
    isInChat ? 'live' : 'builder',
  )
  const [resetMenuOpen, setResetMenuOpen] = useState(false)
  const resetMenuRef = useRef<HTMLDivElement>(null)
  const fittingSeedKeyRef = useRef<string | null>(null)

  // True while an imperative confirmation dialog is up. That dialog renders into
  // document.body (outside this modal's ref), so a click on its buttons bubbles
  // to BaseModal's click-outside listener and would otherwise be read as a click
  // outside the wardrobe — closing it the instant you confirm a delete/reset.
  // Routing every confirmation through `requestConfirmation` flips this flag so
  // we can suspend click-outside/Escape closing while the dialog is open.
  const [confirming, setConfirming] = useState(false)
  const requestConfirmation = useCallback(async (message: string): Promise<boolean> => {
    setConfirming(true)
    try {
      return await showConfirmation(message)
    } finally {
      setConfirming(false)
    }
  }, [])

  // -------- Staged Live-outfit edits --------
  //
  // Per-slot tweaks on the Live tab used to call the equip API one at a time,
  // and the server fired a fresh avatar regen + Aurora announcement on every
  // call. A few clicks in the dialog meant a flurry of jobs and surprise
  // portrait turns. Now: every Live-tab mutation stages here, keyed by
  // character. On Done, each character whose staged slots differ from their
  // baseline gets one `set_all` — so at most one announcement and one regen
  // per character per dialog session.
  const [liveStagedByChar, setLiveStagedByChar] = useState<Record<string, EquippedSlots>>({})
  const liveBaselineByCharRef = useRef<Record<string, EquippedSlots>>({})
  const liveSeededByCharRef = useRef<Set<string>>(new Set())

  const characterIdsForOutfit = useMemo(
    () => (selectedCharacterId ? [selectedCharacterId] : []),
    [selectedCharacterId],
  )
  const outfit = useOutfit(chatId, characterIdsForOutfit)

  // ---------------------------------------------------------------------------
  // Load characters once when the dialog opens
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/api/v1/characters')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { characters?: CharacterSummary[] }
        if (cancelled) return
        const sorted = [...(data.characters ?? [])].sort((a, b) => a.name.localeCompare(b.name))
        setCharacters(sorted)
        // Auto-select if nothing was specified
        setSelectedCharacterId((prev) => prev ?? sorted[0]?.id ?? null)
      } catch (err) {
        console.warn('[WardrobeControlDialog] Failed to load characters', err)
        if (!cancelled) setCharacters([])
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Load image profiles (for the avatar generator)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/api/v1/image-profiles')
        if (!res.ok) return
        const data = (await res.json()) as { profiles?: ImageProfileSummary[] }
        if (cancelled) return
        const profiles = data.profiles ?? []
        setImageProfiles(profiles)
        // Preselect the system default for first-render convenience
        const def = profiles.find((p) => p.isDefault) ?? profiles[0]
        setSelectedImageProfileId((prev) => prev ?? def?.id ?? null)
      } catch (err) {
        console.warn('[WardrobeControlDialog] Failed to load image profiles', err)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Fitting-room seeding
  //
  // Seed once per character. In chat we wait for both `outfit.outfitState`
  // and `items` to be populated so the seed reflects what the character is
  // actually wearing; out of chat we wait for `items` so we can pick out the
  // defaults. The ref prevents reseeding on every render.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!selectedCharacterId) return
    const wornSlots = isInChat ? outfit.outfitState[selectedCharacterId]?.slots : undefined
    if (isInChat && !wornSlots) return
    if (items.length === 0 && !wornSlots) return

    const seedKey = `${selectedCharacterId}|${chatId ?? 'no-chat'}`
    if (fittingSeedKeyRef.current === seedKey) return
    fittingSeedKeyRef.current = seedKey

    const seed = isInChat && wornSlots
      ? cloneSlots(wornSlots)
      : buildDefaultOutfit(items)
    setFittingSlots(seed)
  }, [selectedCharacterId, chatId, isInChat, outfit.outfitState, items])

  // Seed staged Live slots once we have a worn snapshot for this character.
  // The baseline is captured separately so the Done flush can skip no-op
  // commits. Re-seeding is gated by `liveSeededByCharRef` so refreshOutfit
  // round-trips don't blow away in-progress edits.
  useEffect(() => {
    if (!isInChat || !selectedCharacterId) return
    const wornSlots = outfit.outfitState[selectedCharacterId]?.slots
    if (!wornSlots) return
    const seedKey = `${selectedCharacterId}|${chatId ?? 'no-chat'}`
    if (liveSeededByCharRef.current.has(seedKey)) return
    liveSeededByCharRef.current.add(seedKey)
    liveBaselineByCharRef.current[selectedCharacterId] = cloneSlots(wornSlots)
    setLiveStagedByChar((prev) => ({ ...prev, [selectedCharacterId]: cloneSlots(wornSlots) }))
  }, [selectedCharacterId, chatId, isInChat, outfit.outfitState])

  // ---------------------------------------------------------------------------
  // Filtered items for display
  // ---------------------------------------------------------------------------
  const filteredItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.title.localeCompare(b.title))
    const term = titleFilter.trim().toLowerCase()
    return sorted.filter((i) => {
      if (i.archivedAt) return false
      const isComposite = i.componentItemIds.length > 0
      if (kindFilter === 'items' && isComposite) return false
      if (kindFilter === 'outfits' && !isComposite) return false
      if (slotFilter !== 'all' && !i.types.includes(slotFilter)) return false
      if (term && !i.title.toLowerCase().includes(term)) return false
      return true
    })
  }, [items, slotFilter, kindFilter, titleFilter])

  // ---------------------------------------------------------------------------
  // Item action handlers
  // ---------------------------------------------------------------------------
  const handleToggleDefault = useCallback(
    async (item: WardrobeItem) => {
      if (!selectedCharacterId) return
      const url = item.characterId
        ? `/api/v1/characters/${item.characterId}/wardrobe/${item.id}`
        : `/api/v1/wardrobe/${item.id}`
      setUpdatingDefaultId(item.id)
      try {
        const result = await fetchJson<{ wardrobeItem: WardrobeItem }>(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isDefault: !item.isDefault }),
        })
        if (!result.ok) {
          showErrorToast(result.error || 'Failed to update item')
          return
        }
        await reloadItems()
      } finally {
        setUpdatingDefaultId(null)
      }
    },
    [selectedCharacterId, reloadItems],
  )

  const handleDelete = useCallback(
    async (item: WardrobeItem) => {
      if (!selectedCharacterId) return
      if (!(await requestConfirmation(`Delete "${item.title}"? This cannot be undone.`))) return
      const url = item.characterId
        ? `/api/v1/characters/${item.characterId}/wardrobe/${item.id}`
        : `/api/v1/wardrobe/${item.id}`
      const result = await fetchJson(url, { method: 'DELETE' })
      if (!result.ok) {
        showErrorToast(result.error || 'Failed to delete item')
        return
      }
      showSuccessToast(`Deleted "${item.title}"`)
      await reloadItems()
      if (isInChat) {
        outfit.invalidateWardrobe(selectedCharacterId)
        await outfit.refreshOutfit()
      }
    },
    [selectedCharacterId, reloadItems, isInChat, outfit, requestConfirmation],
  )

  const handleDuplicate = useCallback(
    async (item: WardrobeItem) => {
      if (!selectedCharacterId) return
      // Duplicate is only offered for character-owned items (the kebab is
      // hidden for shared archetypes), so always POST to the character route.
      const title = nextCopyTitle(
        item.title,
        items.map((i) => i.title),
      )
      console.debug('[WardrobeControlDialog] Duplicating wardrobe item', {
        sourceId: item.id,
        characterId: selectedCharacterId,
        newTitle: title,
        // Composite references are copied verbatim — member items are not cloned.
        componentItemIds: item.componentItemIds,
      })
      const result = await fetchJson<{ wardrobeItem: WardrobeItem }>(
        `/api/v1/characters/${selectedCharacterId}/wardrobe`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            description: item.description ?? null,
            types: item.types,
            appropriateness: item.appropriateness ?? null,
            isDefault: item.isDefault,
            componentItemIds: item.componentItemIds,
            replace: item.replace,
          }),
        },
      )
      if (!result.ok) {
        showErrorToast(result.error || 'Failed to duplicate item')
        return
      }
      showSuccessToast(`Duplicated "${item.title}"`)
      await reloadItems()
      if (isInChat) {
        outfit.invalidateWardrobe(selectedCharacterId)
        await outfit.refreshOutfit()
      }
    },
    [selectedCharacterId, items, reloadItems, isInChat, outfit],
  )

  // Lookup map shared between Live-tab staging mutators and Builder-tab
  // fitting-room mutators below. Declared once up here so both can reference
  // it without ordering surprises.
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  // -------- Live-tab staging mutators --------
  //
  // Every Live-tab gesture goes through `updateLiveStaged`, which mutates the
  // staged slots for the current character. None of these touch the server.
  const updateLiveStaged = useCallback(
    (mutator: (prev: EquippedSlots) => EquippedSlots) => {
      if (!selectedCharacterId) return
      setLiveStagedByChar((prev) => {
        const wornFallback = outfit.outfitState[selectedCharacterId]?.slots
        const current =
          prev[selectedCharacterId] ??
          (wornFallback ? cloneSlots(wornFallback) : { ...EMPTY_EQUIPPED_SLOTS })
        return { ...prev, [selectedCharacterId]: mutator(current) }
      })
    },
    [selectedCharacterId, outfit.outfitState],
  )

  // The "Wear" button honors the item's `replace` flag (layer when off,
  // replace when on) across every slot it covers — the same rule as the live
  // equip path. To force a swap, clear the slot first.
  const handleEquipItem = useCallback(
    (item: WardrobeItem) => {
      if (!isInChat) return
      updateLiveStaged((prev) => wearItemIntoSlots(prev, item))
    },
    [isInChat, updateLiveStaged],
  )

  const handleAddToSlot = useCallback(
    (item: WardrobeItem, slot: WardrobeItemType) => {
      if (!isInChat) return
      if (!item.types.includes(slot)) return
      updateLiveStaged((prev) => {
        if (prev[slot].includes(item.id)) return prev
        return { ...prev, [slot]: [...prev[slot], item.id] }
      })
    },
    [isInChat, updateLiveStaged],
  )

  // Picking an item from a slot row wears it (fills every slot it covers,
  // layering or replacing per the item's flag) rather than dropping it into
  // the one row the picker was opened from.
  const handleSlotAdd = useCallback(
    (slot: WardrobeItemType, itemId: string) => {
      if (!isInChat) return
      const item = itemsById.get(itemId)
      updateLiveStaged((prev) =>
        item
          ? wearItemIntoSlots(prev, item)
          : prev[slot].includes(itemId)
            ? prev
            : { ...prev, [slot]: [...prev[slot], itemId] },
      )
    },
    [isInChat, itemsById, updateLiveStaged],
  )

  const handleSlotRemove = useCallback(
    (slot: WardrobeItemType, itemId: string) => {
      if (!isInChat) return
      updateLiveStaged((prev) => ({ ...prev, [slot]: prev[slot].filter((id) => id !== itemId) }))
    },
    [isInChat, updateLiveStaged],
  )

  const handleSlotClear = useCallback(
    (slot: WardrobeItemType) => {
      if (!isInChat) return
      updateLiveStaged((prev) => ({ ...prev, [slot]: [] }))
    },
    [isInChat, updateLiveStaged],
  )

  // ---------------------------------------------------------------------------
  // Fitting-room mutations — transient; never hit the equip API.
  // ---------------------------------------------------------------------------
  const fittingAdd = useCallback(
    (slot: WardrobeItemType, itemId: string) => {
      const item = itemsById.get(itemId)
      if (!item) return
      // Wear it across every slot it covers, honoring the `replace` flag.
      setFittingSlots((prev) => wearItemIntoSlots(prev, item))
    },
    [itemsById],
  )

  const fittingRemove = useCallback((slot: WardrobeItemType, itemId: string) => {
    setFittingSlots((prev) => ({ ...prev, [slot]: prev[slot].filter((id) => id !== itemId) }))
  }, [])

  const fittingClear = useCallback((slot: WardrobeItemType) => {
    setFittingSlots((prev) => ({ ...prev, [slot]: [] }))
  }, [])

  const fittingResetToWorn = useCallback(async () => {
    if (!selectedCharacterId) return
    const wornSlots = outfit.outfitState[selectedCharacterId]?.slots
    const target = wornSlots ? cloneSlots(wornSlots) : { ...EMPTY_EQUIPPED_SLOTS }
    if (
      !equippedSlotsEqual(fittingSlots, target) &&
      !(await requestConfirmation(
        'Discard your composition and start from what’s currently worn?',
      ))
    ) {
      return
    }
    setFittingSlots(target)
  }, [selectedCharacterId, outfit.outfitState, fittingSlots, requestConfirmation])

  const fittingResetToDefaults = useCallback(async () => {
    const target = buildDefaultOutfit(items)
    if (
      !equippedSlotsEqual(fittingSlots, target) &&
      !(await requestConfirmation(
        'Discard your composition and start from this character’s default outfit?',
      ))
    ) {
      return
    }
    setFittingSlots(target)
  }, [items, fittingSlots, requestConfirmation])

  const fittingClearAll = useCallback(async () => {
    if (
      !equippedSlotsEqual(fittingSlots, EMPTY_EQUIPPED_SLOTS) &&
      !(await requestConfirmation('Empty every slot in the Outfit Builder?'))
    ) {
      return
    }
    setFittingSlots({ ...EMPTY_EQUIPPED_SLOTS })
  }, [fittingSlots, requestConfirmation])

  /**
   * Open the editor in `Outfit bundle` mode with `componentItemIds`
   * pre-populated from the staged slots. Composite ids are preserved by
   * reference (per the spec's §5 default 1) — the server's cycle detection
   * + union-of-types computation handles the resulting outfit correctly.
   */
  const handleSaveAsOutfit = useCallback(() => {
    if (!selectedCharacterId) return
    const seen = new Set<string>()
    const components: string[] = []
    for (const slot of WARDROBE_SLOT_TYPES) {
      for (const id of fittingSlots[slot]) {
        if (!seen.has(id)) {
          seen.add(id)
          components.push(id)
        }
      }
    }
    setCreateBundleComponents(components)
    setCreatingNew('create-bundle')
  }, [selectedCharacterId, fittingSlots])

  const handleLiveTakeOffBundle = useCallback(
    (bundle: EquippedBundle) => {
      updateLiveStaged((prev) => takeOffBundleFromSlots(prev, bundle))
    },
    [updateLiveStaged],
  )

  const handleLiveBreakApartBundle = useCallback(
    (bundle: EquippedBundle) => {
      updateLiveStaged((prev) => breakApartBundleInSlots(prev, bundle, itemsById))
    },
    [itemsById, updateLiveStaged],
  )

  const handleFittingTakeOffBundle = useCallback(
    (bundle: EquippedBundle) => {
      setFittingSlots((prev) => takeOffBundleFromSlots(prev, bundle))
    },
    [],
  )

  const handleFittingBreakApartBundle = useCallback(
    (bundle: EquippedBundle) => {
      setFittingSlots((prev) => breakApartBundleInSlots(prev, bundle, itemsById))
    },
    [itemsById],
  )

  /**
   * Flush staged Live-tab edits on close. For each character whose staged
   * slots differ from their baseline, fire one `set_all` (which is what
   * triggers a single avatar regen + Aurora announcement on the server). If
   * nothing is dirty, no requests go out.
   *
   * Returns `true` if every commit succeeded (or there was nothing to
   * commit), so the caller can decide whether to actually close the dialog.
   */
  const flushStagedLiveOutfits = useCallback(async (): Promise<boolean> => {
    if (!chatId) return true
    const baselines = liveBaselineByCharRef.current
    const dirty: Array<{ characterId: string; slots: EquippedSlots }> = []
    for (const [characterId, slots] of Object.entries(liveStagedByChar)) {
      const baseline = baselines[characterId]
      if (!baseline) continue
      if (!equippedSlotsEqual(slots, baseline)) {
        dirty.push({ characterId, slots })
      }
    }
    if (dirty.length === 0) return true

    let allOk = true
    for (const { characterId, slots } of dirty) {
      const result = await fetchJson<{ equippedSlots: EquippedSlots }>(
        `/api/v1/chats/${chatId}?action=equip`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            characterId,
            mode: 'set_all',
            slots,
          }),
        },
      )
      if (!result.ok) {
        showErrorToast(result.error || 'Failed to update outfit')
        allOk = false
      } else {
        outfit.invalidateWardrobe(characterId)
        liveBaselineByCharRef.current[characterId] = cloneSlots(slots)
      }
    }
    await outfit.refreshOutfit()
    return allOk
  }, [chatId, liveStagedByChar, outfit])

  const requestClose = useCallback(() => {
    void (async () => {
      const ok = await flushStagedLiveOutfits()
      if (ok) onClose()
    })()
  }, [flushStagedLiveOutfits, onClose])

  /**
   * Wear this fitting room composition: atomic replace via `mode: 'set_all'`.
   * On success the dialog closes — the operator's intent ("put it on and let
   * me see") is complete, and Aurora + avatar gen fire immediately on the
   * server side.
   */
  const wearFitting = useCallback(async () => {
    if (!selectedCharacterId || !chatId) return
    const result = await fetchJson<{ equippedSlots: EquippedSlots }>(
      `/api/v1/chats/${chatId}?action=equip`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: selectedCharacterId,
          mode: 'set_all',
          slots: fittingSlots,
        }),
      },
    )
    if (!result.ok) {
      showErrorToast(result.error || 'Failed to wear this outfit')
      return
    }
    showSuccessToast('Worn!')
    outfit.invalidateWardrobe(selectedCharacterId)
    await outfit.refreshOutfit()
    onClose()
  }, [selectedCharacterId, chatId, fittingSlots, outfit, onClose])

  /**
   * Add an item via the wardrobe row's primary buttons. Routes to the
   * Outfit Builder's transient state when the builder tab is active (or
   * always out of chat), or to the Live-tab staging map otherwise. Both
   * paths defer the server commit until Done / Try on.
   */
  const useFittingActions = !isInChat || rightTab === 'builder'

  const rowEquip = useCallback(
    (item: WardrobeItem) => {
      if (useFittingActions) {
        // Honor the item's `replace` flag across every slot it covers,
        // matching `wearItemIntoSlots` / the live equip path.
        setFittingSlots((prev) => wearItemIntoSlots(prev, item))
        return
      }
      handleEquipItem(item)
    },
    [useFittingActions, handleEquipItem],
  )

  const rowAddToSlot = useCallback(
    (item: WardrobeItem, slot: WardrobeItemType) => {
      if (useFittingActions) {
        fittingAdd(slot, item.id)
        return
      }
      handleAddToSlot(item, slot)
    },
    [useFittingActions, fittingAdd, handleAddToSlot],
  )

  // ---------------------------------------------------------------------------
  // Avatar generation
  // ---------------------------------------------------------------------------
  const handleGenerateAvatar = useCallback(async () => {
    if (!selectedCharacterId) return
    setPreviewUrl(null)
    setPreviewFilename(null)
    setGenerating(true)

    try {
      if (isInChat && chatId) {
        // The fitting-room slots flow through as a one-shot override; the
        // chat's stored `equippedOutfit` is unaffected.
        const result = await fetchJson<{ queued: boolean }>(
          `/api/v1/chats/${chatId}?action=regenerate-avatar`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              characterId: selectedCharacterId,
              equippedSlots: fittingSlots,
              ...(selectedImageProfileId ? { imageProfileId: selectedImageProfileId } : {}),
            }),
          },
        )
        if (!result.ok) {
          showErrorToast(result.error || 'Failed to queue avatar generation')
        } else {
          showSuccessToast('Avatar generation queued — the new portrait will appear shortly.')
        }
      } else {
        const result = await fetchJson<{ fileId: string; url: string }>(
          '/api/v1/wardrobe/preview-avatar',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              characterId: selectedCharacterId,
              equippedSlots: fittingSlots,
              ...(selectedImageProfileId ? { imageProfileId: selectedImageProfileId } : {}),
            }),
          },
        )
        if (!result.ok || !result.data) {
          showErrorToast(result.error || 'Failed to generate preview')
        } else {
          setPreviewUrl(result.data.url)
          const character = characters.find((c) => c.id === selectedCharacterId)
          setPreviewFilename(`${character?.name.replace(/[^a-zA-Z0-9]/g, '_') ?? 'avatar'}_preview.webp`)
        }
      }
    } finally {
      setGenerating(false)
    }
  }, [
    selectedCharacterId,
    isInChat,
    chatId,
    selectedImageProfileId,
    fittingSlots,
    characters,
  ])

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  const equippedSlots = selectedCharacterId
    ? outfit.outfitState[selectedCharacterId]?.slots ?? null
    : null

  // What the Live tab actually paints. We prefer staged slots once seeding
  // has captured a baseline; otherwise fall back to the worn snapshot so the
  // tab isn't blank on first paint.
  const liveDisplaySlots: EquippedSlots = selectedCharacterId
    ? liveStagedByChar[selectedCharacterId] ?? equippedSlots ?? EMPTY_EQUIPPED_SLOTS
    : EMPTY_EQUIPPED_SLOTS

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === selectedCharacterId) ?? null,
    [characters, selectedCharacterId],
  )

  // While the editor or import modal is up, don't let a click inside them
  // (rendered as siblings) close the outer dialog via BaseModal's
  // click-outside handler.
  const editorOpen = Boolean(
    editingItem || creatingNew || importFromImageOpen || (transferringItem && transferIntent),
  )

  // Close Reset menu on outside click + Escape
  useEffect(() => {
    if (!resetMenuOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (resetMenuRef.current && !resetMenuRef.current.contains(e.target as Node)) {
        setResetMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        setResetMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [resetMenuOpen])

  return (
    <>
      <WardrobeShell
        asTab={asTab}
        onClose={requestClose}
        closeOnClickOutside={!editorOpen && !confirming}
        closeOnEscape={!editorOpen && !confirming}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              onClick={requestClose}
              className="qt-button-secondary qt-button-sm"
            >
              Done
            </button>
          </div>
        }
      >
        {/* Character selector */}
        <div className="flex flex-col gap-3 mb-3">
          <div className="flex items-center gap-2">
            <label htmlFor="wardrobe-char-select" className="qt-text-sm qt-text-secondary">
              Character:
            </label>
            {selectedCharacter?.avatarUrl && (
              <img
                src={selectedCharacter.avatarUrl}
                alt=""
                className="w-6 h-6 rounded-full object-cover qt-bg-muted border qt-border-default flex-shrink-0"
              />
            )}
            <select
              id="wardrobe-char-select"
              className="qt-select flex-1 max-w-md"
              value={selectedCharacterId ?? ''}
              onChange={(e) => setSelectedCharacterId(e.target.value || null)}
            >
              {characters.length === 0 && (
                <option value="" disabled>
                  No characters available
                </option>
              )}
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* LEFT: Wardrobe list */}
          <section className="flex flex-col min-h-0 relative">
            <div className="flex flex-col gap-2 mb-2">
              <input
                type="search"
                value={titleFilter}
                onChange={(e) => setTitleFilter(e.target.value)}
                placeholder="Search wardrobe…"
                className="qt-input qt-input-sm"
                aria-label="Search wardrobe by title"
              />
              <div
                role="tablist"
                aria-label="Item kind"
                className="inline-flex gap-1 qt-bg-muted/50 rounded-lg p-1 self-start"
              >
                {(['items', 'outfits'] as ItemKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={kindFilter === k}
                    onClick={() => setKindFilter(k)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      kindFilter === k
                        ? 'qt-bg-default text-foreground shadow-sm'
                        : 'qt-text-secondary hover:text-foreground'
                    }`}
                  >
                    {k === 'items' ? 'Items' : 'Outfits'}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {SLOT_FILTERS.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setSlotFilter(slot)}
                    className={`qt-button-sm ${slotFilter === slot ? 'qt-button-secondary' : 'qt-button-ghost'}`}
                  >
                    {slot === 'all' ? 'All' : slot[0].toUpperCase() + slot.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 max-h-[55vh] pb-12">
              {!selectedCharacterId ? (
                <div className="qt-text-sm qt-text-secondary px-3 py-4">
                  Select a character to see their wardrobe.
                </div>
              ) : itemsLoading ? (
                <div className="qt-text-sm qt-text-secondary px-3 py-4">Loading…</div>
              ) : filteredItems.length === 0 ? (
                <div className="qt-text-sm qt-text-secondary px-3 py-4">
                  No items match this filter.
                </div>
              ) : (
                filteredItems.map((item) => (
                  <WardrobeItemRow
                    key={item.id}
                    item={item}
                    allItems={items}
                    // `inChat` here gates the visibility of the row's
                    // Wear/+Layer buttons; we want them visible whenever
                    // the dialog is showing equip-able state — that's any
                    // time (in chat → live or builder; out of chat → builder).
                    inChat
                    equipLabel={useFittingActions ? 'Try on' : 'Wear'}
                    addAction={useFittingActions ? 'add' : 'layer'}
                    isUpdatingDefault={updatingDefaultId === item.id}
                    onToggleDefault={handleToggleDefault}
                    onEdit={(it) => setEditingItem(it)}
                    onDuplicate={handleDuplicate}
                    onMove={(it) => {
                      setTransferringItem(it)
                      setTransferIntent('move')
                    }}
                    onCopy={(it) => {
                      setTransferringItem(it)
                      setTransferIntent('copy')
                    }}
                    onDelete={handleDelete}
                    onEquip={rowEquip}
                    onAddToSlot={rowAddToSlot}
                  />
                ))
              )}
            </div>

            {/* Sticky create / import controls */}
            <div className="sticky bottom-0 -mx-1 px-1 pt-2 pb-1 qt-bg-default border-t qt-border-default flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setImportFromImageOpen(true)}
                disabled={!selectedCharacterId}
                className="qt-button-ghost qt-button-sm"
                title="Import wardrobe items from a reference image"
              >
                Import from image
              </button>
              <button
                type="button"
                className="qt-button-primary qt-button-sm"
                disabled={!selectedCharacterId}
                onClick={() => setCreatingNew('create-single')}
              >
                + New Item
              </button>
            </div>
          </section>

          {/* RIGHT: Live outfit / Outfit Builder — Builder always present;
              Live outfit only when there's a chat to mutate against. */}
          {selectedCharacterId && (
            <section className="flex flex-col min-h-0">
              <div className="flex items-center gap-1 mb-2 qt-tab-group">
                {isInChat && (
                  <button
                    type="button"
                    onClick={() => setRightTab('live')}
                    className={`qt-tab ${rightTab === 'live' ? 'qt-tab-active' : ''}`}
                  >
                    Live outfit
                    {selectedCharacter && (
                      <span className="qt-text-xs qt-text-secondary ml-1">
                        · {selectedCharacter.name} in this chat
                      </span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRightTab('builder')}
                  className={`qt-tab ${rightTab === 'builder' ? 'qt-tab-active' : ''}`}
                >
                  Outfit Builder
                </button>
              </div>

              {rightTab === 'live' && isInChat ? (
                <div className="space-y-2 mb-3">
                  <p className="qt-text-xs qt-text-secondary px-1">
                    Edits stage here and apply when you click Done. Nothing happens until then.
                  </p>
                  <OutfitComposer
                    items={items}
                    slots={liveDisplaySlots}
                    onAddToSlot={handleSlotAdd}
                    onRemoveFromSlot={handleSlotRemove}
                    onClearSlot={handleSlotClear}
                    showBundleActions
                    onTakeOffBundle={handleLiveTakeOffBundle}
                    onBreakApartBundle={handleLiveBreakApartBundle}
                  />
                </div>
              ) : (
                <div className="space-y-2 mb-3">
                  <p className="qt-text-xs qt-text-secondary px-1">
                    Compose an outfit. Save it as a reusable bundle, try it on, or
                    generate a preview avatar.
                  </p>
                  <div className="flex flex-wrap gap-1 px-1 items-center">
                    <button
                      type="button"
                      onClick={handleSaveAsOutfit}
                      className="qt-button-primary qt-button-sm"
                      title="Save this composition as a new outfit bundle"
                    >
                      Save as outfit
                    </button>
                    {isInChat && (
                      <button
                        type="button"
                        onClick={wearFitting}
                        className="qt-button-secondary qt-button-sm"
                        title="Replace what the character is wearing with this composition"
                      >
                        Try on
                      </button>
                    )}
                    <div className="relative" ref={resetMenuRef}>
                      <button
                        type="button"
                        onClick={() => setResetMenuOpen((v) => !v)}
                        className="qt-button-ghost qt-button-sm"
                        aria-haspopup="menu"
                        aria-expanded={resetMenuOpen}
                        title="Reset the staged composition"
                      >
                        Reset…
                      </button>
                      {resetMenuOpen && (
                        <div
                          role="menu"
                          className="absolute left-0 top-full mt-1 z-30 min-w-[14rem] rounded border qt-border-default qt-bg-default shadow-md"
                        >
                          <ul className="divide-y qt-border-default">
                            {isInChat && (
                              <li>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setResetMenuOpen(false)
                                    fittingResetToWorn()
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted"
                                >
                                  Reset to worn
                                </button>
                              </li>
                            )}
                            <li>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setResetMenuOpen(false)
                                  fittingResetToDefaults()
                                }}
                                className="block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted"
                              >
                                Reset to defaults
                              </button>
                            </li>
                            <li>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setResetMenuOpen(false)
                                  fittingClearAll()
                                }}
                                className="block w-full text-left px-3 py-2 text-sm qt-text-secondary hover:qt-bg-muted"
                              >
                                Clear all
                              </button>
                            </li>
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                  <OutfitComposer
                    items={items}
                    slots={fittingSlots}
                    onAddToSlot={fittingAdd}
                    onRemoveFromSlot={fittingRemove}
                    onClearSlot={fittingClear}
                    showBundleActions
                    onTakeOffBundle={handleFittingTakeOffBundle}
                    onBreakApartBundle={handleFittingBreakApartBundle}
                  />
                </div>
              )}

              {rightTab === 'builder' && (
                <AvatarGenerationPane
                  selectedCharacterName={selectedCharacter?.name ?? ''}
                  imageProfiles={imageProfiles}
                  selectedImageProfileId={selectedImageProfileId}
                  onSelectImageProfile={setSelectedImageProfileId}
                  generating={generating}
                  onGenerate={handleGenerateAvatar}
                  inChat={isInChat}
                  previewUrl={isInChat ? null : previewUrl}
                  previewFilename={isInChat ? null : previewFilename}
                  onDiscardPreview={() => {
                    setPreviewUrl(null)
                    setPreviewFilename(null)
                  }}
                />
              )}
            </section>
          )}
        </div>
      </WardrobeShell>

      {/* Import-from-image modal — stacked on top of the dialog */}
      {importFromImageOpen && selectedCharacterId && (
        <ImportFromImageModal
          characterId={selectedCharacterId}
          onClose={() => setImportFromImageOpen(false)}
          onImported={() => {
            void reloadItems()
          }}
        />
      )}

      {/* Inline editor — stacked on top of the dialog */}
      {(editingItem || creatingNew) && selectedCharacterId && (
        <WardrobeItemEditor
          characterId={selectedCharacterId}
          item={editingItem}
          isShared={false}
          projectId={dialogProjectId}
          initialMode={
            creatingNew === 'create-bundle'
              ? 'bundle'
              : creatingNew === 'create-single'
                ? 'single'
                : undefined
          }
          initialComponentItemIds={
            creatingNew === 'create-bundle' ? createBundleComponents : undefined
          }
          autoFocusTitle={creatingNew === 'create-bundle'}
          onClose={() => {
            setEditingItem(null)
            setCreatingNew(null)
            setCreateBundleComponents([])
          }}
          onSave={async () => {
            setEditingItem(null)
            setCreatingNew(null)
            setCreateBundleComponents([])
            await reloadItems()
            if (isInChat) {
              outfit.invalidateWardrobe(selectedCharacterId)
              await outfit.refreshOutfit()
            }
          }}
        />
      )}

      {transferringItem && transferIntent && selectedCharacterId && (
        <WardrobeTransferDialog
          isOpen
          mode={transferIntent}
          item={transferringItem}
          sourceCharacterId={selectedCharacterId}
          sourceProjectId={dialogProjectId}
          onClose={() => {
            setTransferringItem(null)
            setTransferIntent(null)
          }}
          onTransferred={async () => {
            setTransferringItem(null)
            setTransferIntent(null)
            await reloadItems()
            if (isInChat) {
              outfit.invalidateWardrobe(selectedCharacterId)
              await outfit.refreshOutfit()
            }
          }}
        />
      )}
    </>
  )
}

// =============================================================================
// Avatar generation pane
// =============================================================================

interface AvatarGenerationPaneProps {
  selectedCharacterName: string
  imageProfiles: ImageProfileSummary[]
  selectedImageProfileId: string | null
  onSelectImageProfile: (id: string | null) => void
  generating: boolean
  onGenerate: () => void
  inChat: boolean
  previewUrl: string | null
  previewFilename: string | null
  onDiscardPreview: () => void
}

function AvatarGenerationPane({
  selectedCharacterName,
  imageProfiles,
  selectedImageProfileId,
  onSelectImageProfile,
  generating,
  onGenerate,
  inChat,
  previewUrl,
  previewFilename,
  onDiscardPreview,
}: AvatarGenerationPaneProps) {
  const downloadRef = useRef<HTMLAnchorElement>(null)

  const handleDownload = useCallback(() => {
    downloadRef.current?.click()
  }, [])

  return (
    <div className="qt-card py-3 px-3 qt-bg-muted/30">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="wardrobe-image-profile"
          className="qt-text-sm qt-text-secondary"
        >
          Image model
        </label>
        <select
          id="wardrobe-image-profile"
          className="qt-select flex-1 min-w-[12rem]"
          value={selectedImageProfileId ?? ''}
          onChange={(e) => onSelectImageProfile(e.target.value || null)}
        >
          {imageProfiles.length === 0 && (
            <option value="" disabled>
              No image profiles configured
            </option>
          )}
          {imageProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? ' (default)' : ''} — {p.provider}/{p.modelName}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="qt-button-secondary qt-button-sm"
          onClick={onGenerate}
          disabled={generating || imageProfiles.length === 0}
        >
          {generating ? 'Generating…' : inChat ? 'Generate avatar' : 'Preview'}
        </button>
      </div>

      <p className="mt-2 qt-text-xs qt-text-small">
        {inChat
          ? `Replaces this chat's avatar with the staged outfit.`
          : `Generates a one-off preview. Download to keep.`}
      </p>

      {!inChat && previewUrl && (
        <div className="mt-3 flex flex-col sm:flex-row gap-3 items-start">
          <div className="relative">
            <img
              src={previewUrl}
              alt={`Preview of ${selectedCharacterName}`}
              className="qt-bg-muted rounded border qt-border-default max-h-[40vh]"
            />
            <button
              type="button"
              onClick={onDiscardPreview}
              aria-label="Discard preview"
              title="Discard preview"
              className="absolute top-1 right-1 w-6 h-6 rounded-full qt-bg-default border qt-border-default flex items-center justify-center qt-text-secondary hover:text-foreground shadow-sm"
            >
              ×
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <a
              ref={downloadRef}
              href={previewUrl}
              download={previewFilename ?? 'avatar-preview.webp'}
              className="hidden"
            >
              download
            </a>
            <button
              type="button"
              onClick={handleDownload}
              className="qt-button-primary qt-button-sm"
            >
              Download
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
