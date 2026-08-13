'use client'

/**
 * useOutfit Hook
 *
 * Manages outfit state for characters in a chat session.
 * Fetches equipped outfit slots from the server, resolves item details
 * from each character's wardrobe, and provides equip primitives that
 * mirror the `wardrobe_wear`/`wardrobe_take_off` LLM tools surface.
 *
 * Each slot is an array of wardrobe item IDs (multi-item slots support
 * layering: t-shirt + sweater). Composite items appear as a single ID
 * and are expanded to their leaves at read time for display.
 *
 * Pass `chatId === null` for chat-less surfaces (e.g. the wardrobe control
 * dialog opened from the Aurora character page) — the equip primitives
 * become no-ops and `refreshOutfit` returns null without firing.
 *
 * @module lib/hooks/use-outfit
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { WARDROBE_SLOT_TYPES, EMPTY_EQUIPPED_SLOTS } from '@/lib/schemas/wardrobe.types'
import { computeDisplacedSlots } from '@/lib/wardrobe/outfit-displacement'

// ============================================================================
// TYPES
// ============================================================================

/** Summary of a wardrobe item (title + slot coverage) for display */
export interface WardrobeItemSummary {
  id: string
  title: string
  types: string[]
  isDefault: boolean
  /** IDs of component items if this item is a composite. */
  componentItemIds: string[]
  /** Composite-only: clear the designated slots on equip instead of layering. */
  replace?: boolean
}

/** Per-slot resolved item details for display (full array form). */
export type ResolvedSlotItems = Record<string, Array<{ itemId: string; title: string }>>

/** Per-character outfit state including equipped slots and resolved item details */
export interface CharacterOutfitState {
  slots: EquippedSlots
  /** Full per-slot array view: each slot is layered leaf items, in order. */
  itemsBySlot: ResolvedSlotItems
}

/** Full outfit state for the hook, keyed by character ID */
export type OutfitState = Record<string, CharacterOutfitState>

/** Per-character wardrobe items cache, keyed by character ID */
export type WardrobeCache = Record<string, WardrobeItemSummary[]>

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Walk composites down to leaves using the cached wardrobe-summary list.
 * Mirrors `expandComposites` in `lib/wardrobe/expand-composites.ts` but works
 * off the lighter `WardrobeItemSummary` shape that the hook keeps in memory.
 * Cycle-tolerant; unknown ids are surfaced as-is so the caller can ignore
 * them.
 */
function expandSummaryComposites(
  rootIds: readonly string[],
  itemsById: Map<string, WardrobeItemSummary>,
  maxDepth = 4,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const visit = (id: string, path: string[], depth: number): void => {
    const item = itemsById.get(id)
    if (!item) {
      if (!seen.has(id)) { seen.add(id); out.push(id) }
      return
    }
    if (path.includes(id)) return // cycle, drop branch
    if (depth >= maxDepth) {
      if (!seen.has(id)) { seen.add(id); out.push(id) }
      return
    }
    if (item.componentItemIds.length === 0) {
      if (!seen.has(id)) { seen.add(id); out.push(id) }
      return
    }
    const nextPath = [...path, id]
    for (const child of item.componentItemIds) {
      visit(child, nextPath, depth + 1)
    }
  }

  for (const root of rootIds) visit(root, [], 0)
  return out
}

// ============================================================================
// HOOK
// ============================================================================

export function useOutfit(chatId: string | null, characterIds: string[] = []) {
  const [outfitState, setOutfitState] = useState<OutfitState>({})
  const [wardrobeCache, setWardrobeCache] = useState<WardrobeCache>({})
  const [loading, setLoading] = useState(false)

  // Track which character wardrobes we've already fetched
  const fetchedWardrobesRef = useRef<Set<string>>(new Set())
  // Mirror of wardrobeCache for reads inside callbacks. The state copy still
  // drives renders; the ref keeps fetchWardrobeForCharacter's identity stable
  // so effects depending on refreshOutfit don't cascade-refire every time a
  // wardrobe fetch completes.
  const wardrobeCacheRef = useRef<WardrobeCache>({})

  /**
   * Fetch wardrobe items for a single character and cache them.
   */
  const fetchWardrobeForCharacter = useCallback(async (characterId: string): Promise<WardrobeItemSummary[]> => {
    if (fetchedWardrobesRef.current.has(characterId)) {
      return wardrobeCacheRef.current[characterId] ?? []
    }

    try {
      // Fetch personal wardrobe and shared archetypes in parallel
      const [personalRes, archetypeRes] = await Promise.all([
        fetch(`/api/v1/characters/${characterId}/wardrobe`),
        fetch('/api/v1/wardrobe'),
      ])

      const personalItems: WardrobeItemSummary[] = []
      if (personalRes.ok) {
        const data = await personalRes.json()
        for (const item of (data.wardrobeItems || [])) {
          personalItems.push({
            id: item.id,
            title: item.title,
            types: item.types,
            isDefault: item.isDefault,
            componentItemIds: Array.isArray(item.componentItemIds) ? item.componentItemIds : [],
            replace: item.replace === true,
          })
        }
      } else {
        console.warn('[useOutfit] Failed to fetch wardrobe for character', characterId, personalRes.status)
      }

      if (archetypeRes.ok) {
        const data = await archetypeRes.json()
        for (const item of (data.wardrobeItems || [])) {
          // Avoid duplicates (shouldn't happen, but safety check)
          if (!personalItems.some(p => p.id === item.id)) {
            personalItems.push({
              id: item.id,
              title: `${item.title} (shared)`,
              types: item.types,
              isDefault: false,
              componentItemIds: Array.isArray(item.componentItemIds) ? item.componentItemIds : [],
              replace: item.replace === true,
            })
          }
        }
      }

      fetchedWardrobesRef.current.add(characterId)
      const next = { ...wardrobeCacheRef.current, [characterId]: personalItems }
      wardrobeCacheRef.current = next
      setWardrobeCache(next)
      return personalItems
    } catch (err) {
      console.error('[useOutfit] Error fetching wardrobe', { characterId, error: err })
      return []
    }
  }, [])

  /**
   * Resolve item titles for equipped slots using the wardrobe cache. Each
   * slot's array of equipped IDs is expanded through composites and mapped
   * to leaf titles, projected back into the slots their own types cover.
   */
  const resolveItemDetails = useCallback((
    slots: EquippedSlots,
    items: WardrobeItemSummary[]
  ): ResolvedSlotItems => {
    const itemsById = new Map<string, WardrobeItemSummary>()
    for (const item of items) itemsById.set(item.id, item)

    const bySlot: ResolvedSlotItems = {
      top: [], bottom: [], footwear: [], accessories: [],
    }

    for (const slot of WARDROBE_SLOT_TYPES) {
      const equippedIds = slots[slot] ?? []
      if (equippedIds.length === 0) continue

      const leafIds = expandSummaryComposites(equippedIds, itemsById)
      const seen = new Set<string>()
      for (const leafId of leafIds) {
        if (seen.has(leafId)) continue
        const leaf = itemsById.get(leafId)
        if (!leaf) continue
        if (!leaf.types.includes(slot)) continue
        bySlot[slot].push({ itemId: leaf.id, title: leaf.title })
        seen.add(leafId)
      }
    }

    return bySlot
  }, [])

  /**
   * Fetch the full equipped outfit state for this chat and resolve item details.
   * Returns the new outfit state, or null on failure (or when chatId is null).
   */
  const refreshOutfit = useCallback(async (): Promise<OutfitState | null> => {
    if (!chatId) return null

    setLoading(true)
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=outfit`, { cache: 'no-store' })
      if (!res.ok) {
        console.warn('[useOutfit] Failed to fetch outfit state', res.status)
        return null
      }

      const data = await res.json()
      const equippedOutfit: Record<string, EquippedSlots> = data.equippedOutfit || {}

      // Merge character IDs from equipped outfit with all known character IDs
      const allCharacterIds = new Set([
        ...Object.keys(equippedOutfit),
        ...characterIds,
      ])
      const newOutfitState: OutfitState = {}

      await Promise.all(
        Array.from(allCharacterIds).map(async (characterId) => {
          const slots = equippedOutfit[characterId] ?? { ...EMPTY_EQUIPPED_SLOTS }
          const wardrobeItems = await fetchWardrobeForCharacter(characterId)
          // Only include characters that actually have wardrobe items
          if (wardrobeItems.length > 0 || equippedOutfit[characterId]) {
            const itemsBySlot = resolveItemDetails(slots, wardrobeItems)
            newOutfitState[characterId] = { slots, itemsBySlot }
          }
        })
      )

      setOutfitState(newOutfitState)
      return newOutfitState
    } catch (err) {
      console.error('[useOutfit] Error refreshing outfit state', { chatId, error: err })
      return null
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- characterIds content is stable after chat load; using array identity would cause unnecessary re-runs
  }, [chatId, characterIds.length, fetchWardrobeForCharacter, resolveItemDetails])

  /**
   * Apply an optimistic update to local state and return the resolved
   * arrays-per-slot view. Returns null if the character has no cached outfit
   * yet (in which case a `refreshOutfit` will pick it up after the server
   * round-trip).
   */
  const applyOptimistic = useCallback(
    (
      characterId: string,
      mutate: (slots: EquippedSlots, items: WardrobeItemSummary[]) => EquippedSlots,
    ): ResolvedSlotItems | null => {
      const items = wardrobeCache[characterId] ?? []
      const currentChar = outfitState[characterId]
      if (!currentChar) return null

      const newSlots = mutate(currentChar.slots, items)
      const itemsBySlot = resolveItemDetails(newSlots, items)

      setOutfitState(prev => ({
        ...prev,
        [characterId]: { slots: newSlots, itemsBySlot },
      }))

      return itemsBySlot
    },
    [wardrobeCache, outfitState, resolveItemDetails],
  )

  /**
   * Wear an item: for each slot the item covers, honor its `replace` flag —
   * layer it in (append) when false, replace the slot when true. The single-
   * call gesture for "put this on".
   */
  const equipItemAction = useCallback(
    async (characterId: string, itemId: string): Promise<ResolvedSlotItems | null> => {
      if (!chatId) return null
      try {
        const res = await fetch(`/api/v1/chats/${chatId}?action=equip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterId, mode: 'wear', itemId }),
        })
        if (!res.ok) {
          console.error('[useOutfit] Failed to wear item', { characterId, itemId, status: res.status })
          return null
        }

        return applyOptimistic(characterId, (slots, items) => {
          const item = items.find(i => i.id === itemId)
          if (!item) return slots
          return computeDisplacedSlots(slots, {
            mode: 'wear',
            item: {
              id: item.id,
              types: item.types,
              componentItemIds: item.componentItemIds,
              replace: item.replace,
            },
            itemsById: new Map(items.map(i => [i.id, i])),
          })
        })
      } catch (err) {
        console.error('[useOutfit] Error wearing item', { characterId, itemId, error: err })
        return null
      }
    },
    [chatId, applyOptimistic],
  )

  /**
   * Force-swap an item: clear each slot it covers, then set it to that item —
   * regardless of the `replace` flag. The "clear the slot, then put this on"
   * gesture.
   */
  const replaceItemAction = useCallback(
    async (characterId: string, itemId: string): Promise<ResolvedSlotItems | null> => {
      if (!chatId) return null
      try {
        const res = await fetch(`/api/v1/chats/${chatId}?action=equip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterId, mode: 'replace', itemId }),
        })
        if (!res.ok) {
          console.error('[useOutfit] Failed to replace item', { characterId, itemId, status: res.status })
          return null
        }

        return applyOptimistic(characterId, (slots, items) => {
          const item = items.find(i => i.id === itemId)
          if (!item) return slots
          return computeDisplacedSlots(slots, {
            mode: 'replace',
            item: {
              id: item.id,
              types: item.types,
              componentItemIds: item.componentItemIds,
            },
            itemsById: new Map(items.map(i => [i.id, i])),
          })
        })
      } catch (err) {
        console.error('[useOutfit] Error replacing item', { characterId, itemId, error: err })
        return null
      }
    },
    [chatId, applyOptimistic],
  )

  /**
   * Add an item to a slot's array (layer it on top of what's already there).
   */
  const addToSlotAction = useCallback(
    async (
      characterId: string,
      slot: WardrobeItemType,
      itemId: string,
    ): Promise<ResolvedSlotItems | null> => {
      if (!chatId) return null
      try {
        const res = await fetch(`/api/v1/chats/${chatId}?action=equip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterId, mode: 'add_to_slot', slot, itemId }),
        })
        if (!res.ok) {
          console.error('[useOutfit] Failed to add to slot', { characterId, slot, itemId, status: res.status })
          return null
        }

        return applyOptimistic(characterId, (slots, items) => {
          const item = items.find(i => i.id === itemId)
          if (!item) return slots
          return computeDisplacedSlots(slots, {
            mode: 'add_to_slot',
            slot,
            item: {
              id: item.id,
              types: item.types,
              componentItemIds: item.componentItemIds,
            },
            itemsById: new Map(items.map(i => [i.id, i])),
          })
        })
      } catch (err) {
        console.error('[useOutfit] Error adding to slot', { characterId, slot, itemId, error: err })
        return null
      }
    },
    [chatId, applyOptimistic],
  )

  /**
   * Remove a specific item from a slot. Pass `null`/omit to clear the slot.
   */
  const removeFromSlotAction = useCallback(
    async (
      characterId: string,
      slot: WardrobeItemType,
      itemId?: string | null,
    ): Promise<ResolvedSlotItems | null> => {
      if (!chatId) return null
      try {
        const isClear = !itemId
        const res = await fetch(`/api/v1/chats/${chatId}?action=equip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            characterId,
            mode: isClear ? 'clear_slot' : 'remove_from_slot',
            slot,
            ...(itemId ? { itemId } : {}),
          }),
        })
        if (!res.ok) {
          console.error('[useOutfit] Failed to remove from slot', { characterId, slot, itemId, status: res.status })
          return null
        }

        return applyOptimistic(characterId, (slots) => {
          return computeDisplacedSlots(slots, {
            mode: isClear ? 'clear_slot' : 'remove_from_slot',
            slot,
            ...(itemId ? { itemId } : {}),
          })
        })
      } catch (err) {
        console.error('[useOutfit] Error removing from slot', { characterId, slot, itemId, error: err })
        return null
      }
    },
    [chatId, applyOptimistic],
  )

  /**
   * Invalidate the wardrobe cache for a specific character (or all characters).
   * Call this before refreshOutfit when items have been added/removed externally
   * (e.g., via the gift modal or character wardrobe page).
   */
  const invalidateWardrobe = useCallback((characterId?: string) => {
    if (characterId) {
      fetchedWardrobesRef.current.delete(characterId)
    } else {
      fetchedWardrobesRef.current.clear()
    }
  }, [])

  // Fetch outfit state on mount (or whenever chatId becomes available)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch triggered on mount; return signature contract predates useSWR migration
    refreshOutfit()
  }, [refreshOutfit])

  return {
    outfitState,
    wardrobeCache,
    loading,
    refreshOutfit,
    invalidateWardrobe,
    fetchWardrobeForCharacter,
    /** Wear an item across every slot it covers, honoring its `replace` flag. */
    equipItem: equipItemAction,
    /** Force-swap an item: clear the slots it covers, then set it to that item. */
    replaceItem: replaceItemAction,
    /** Append an item to a slot's array (layering). */
    addToSlot: addToSlotAction,
    /** Remove a specific item from a slot, or clear the slot when itemId is null. */
    removeFromSlot: removeFromSlotAction,
  }
}
