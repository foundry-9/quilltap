'use client'

/**
 * Shared-container wardrobe loader.
 *
 * Loads the items of one *shared* wardrobe container — Quilltap General, a
 * project's store, or a group's store — without any tier merging: the list is
 * exactly what lives in that container's `Wardrobe/` folder, which is what the
 * wardrobe dialog shows (and lets you edit) when browsing that container
 * directly. The character scope stays with `useCharacterWardrobeItems`, whose
 * job is the opposite: merge every tier a character can reach.
 *
 * Alongside the container's own list, the General archetypes are fetched as a
 * *resolution pool* (`resolutionItems`) so composite rows can display
 * components that bundle a General archetype — those stay read-only in the
 * dialog because they don't live in the viewed container.
 *
 * @module lib/hooks/use-wardrobe-container-items
 */

import { useCallback, useEffect, useState } from 'react'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import {
  wardrobeCollectionUrl,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'

export interface UseWardrobeContainerItemsResult {
  /** Items that live in the container itself — the editable set. */
  items: WardrobeItem[]
  /** `items` plus General archetypes, for resolving composite components. */
  resolutionItems: WardrobeItem[]
  loading: boolean
  /** True once at least one fetch has completed for the current container. */
  fetched: boolean
  reload: () => Promise<void>
}

/**
 * Load a shared container's wardrobe. Pass null (or a character-scoped
 * container) to no-op — the dialog uses `useCharacterWardrobeItems` for the
 * character scope and this hook for everything else.
 */
export function useWardrobeContainerItems(
  container: WardrobeContainer | null,
): UseWardrobeContainerItemsResult {
  const scope = container?.scope ?? null
  const containerId = container?.id ?? null
  const active = scope !== null && scope !== 'character'

  const [items, setItems] = useState<WardrobeItem[]>([])
  const [resolutionItems, setResolutionItems] = useState<WardrobeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    if (!active) {
      setItems([])
      setResolutionItems([])
      setFetched(false)
      return
    }
    setLoading(true)
    try {
      const url = wardrobeCollectionUrl({ scope, id: containerId })
      const [containerRes, generalRes] = await Promise.all([
        fetch(url),
        scope === 'general' ? Promise.resolve(null) : fetch('/api/v1/wardrobe'),
      ])
      if (!containerRes.ok) throw new Error(`HTTP ${containerRes.status}`)
      const data = (await containerRes.json()) as { wardrobeItems?: WardrobeItem[] }
      const own = data.wardrobeItems ?? []
      const pool = [...own]
      if (generalRes && generalRes.ok) {
        const generalData = (await generalRes.json()) as { wardrobeItems?: WardrobeItem[] }
        for (const w of generalData.wardrobeItems ?? []) {
          if (!pool.some((c) => c.id === w.id)) pool.push(w)
        }
      }
      setItems(own)
      setResolutionItems(pool)
    } catch (err) {
      console.warn('[useWardrobeContainerItems] Failed to load container wardrobe', err)
      setItems([])
      setResolutionItems([])
    } finally {
      setLoading(false)
      setFetched(true)
    }
  }, [active, scope, containerId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload wraps an async fetch; the setState lands well after this effect tick
    void reload()
  }, [reload])

  return { items, resolutionItems, loading, fetched, reload }
}
