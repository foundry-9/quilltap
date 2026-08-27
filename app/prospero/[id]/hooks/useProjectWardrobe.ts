'use client'

/**
 * useProjectWardrobe — fetch and mutate the project's `Wardrobe/*.md` files via
 * `/api/v1/projects/[id]/wardrobe/...`.
 *
 * Project wardrobe is the project tier of the tri-tier wardrobe model: items
 * stored here are wearable by every character in chats belonging to this
 * project, alongside the character's own vault items and the Quilltap General
 * archetypes.
 *
 * @module app/prospero/[id]/hooks/useProjectWardrobe
 */

import { useCallback, useEffect, useState } from 'react'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { wardrobeCollectionUrl, wardrobeItemUrl } from '@/lib/wardrobe/wardrobe-container'

export interface CreateProjectWardrobeInput {
  title: string
  description?: string | null
  /** Plain-text image-generation cue; preferred over the title in image prompts. */
  imagePrompt?: string | null
  types: WardrobeItemType[]
  appropriateness?: string | null
  isDefault?: boolean
  componentItemIds?: string[]
  replace?: boolean
}

export type UpdateProjectWardrobeInput = Partial<CreateProjectWardrobeInput> & {
  /** Archive (true) or restore (false). Maps to `archivedAt` server-side. */
  archived?: boolean
}

export interface UseProjectWardrobeReturn {
  items: WardrobeItem[]
  loading: boolean
  error: string | null
  /**
   * "Show archived" state. Flipping it re-fetches with
   * `?includeArchived=true` rather than filtering `items` client-side.
   */
  showArchived: boolean
  setShowArchived: (next: boolean) => void
  refresh: () => Promise<void>
  createItem: (
    input: CreateProjectWardrobeInput,
  ) => Promise<{ ok: true; item: WardrobeItem } | { ok: false; error: string }>
  updateItem: (
    id: string,
    patch: UpdateProjectWardrobeInput,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  deleteItem: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Archive an active garment, or restore an archived one. */
  setItemArchived: (
    id: string,
    archived: boolean,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function useProjectWardrobe(projectId: string): UseProjectWardrobeReturn {
  const [items, setItems] = useState<WardrobeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const collectionUrl = wardrobeCollectionUrl(
    { scope: 'project', id: projectId },
    { includeArchived: showArchived },
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(collectionUrl)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Failed to load project wardrobe (${res.status})`)
      }
      const data = (await res.json()) as { wardrobeItems: WardrobeItem[] }
      setItems(data.wardrobeItems || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [collectionUrl])

  useEffect(() => {
    // Initial fetch, and a refetch whenever "Show archived" flips — the server
    // decides what's visible, so the toggle is a new request, not a filter.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState lands inside async refresh()
    void refresh()
  }, [refresh])

  const createItem = useCallback<UseProjectWardrobeReturn['createItem']>(
    async (input) => {
      try {
        const res = await fetch(collectionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to create (${res.status})` }
        }
        if (Array.isArray(body.wardrobeItems)) setItems(body.wardrobeItems as WardrobeItem[])
        return { ok: true, item: body.wardrobeItem as WardrobeItem }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [collectionUrl],
  )

  const updateItem = useCallback<UseProjectWardrobeReturn['updateItem']>(
    async (id, patch) => {
      try {
        const res = await fetch(wardrobeItemUrl({ scope: 'project', id: projectId }, id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to update (${res.status})` }
        }
        await refresh()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [projectId, refresh],
  )

  const deleteItem = useCallback<UseProjectWardrobeReturn['deleteItem']>(
    async (id) => {
      try {
        const res = await fetch(wardrobeItemUrl({ scope: 'project', id: projectId }, id), {
          method: 'DELETE',
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { ok: false, error: body?.error || `Failed to delete (${res.status})` }
        }
        await refresh()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [projectId, refresh],
  )

  const setItemArchived = useCallback<UseProjectWardrobeReturn['setItemArchived']>(
    (id, archived) => updateItem(id, { archived }),
    [updateItem],
  )

  return {
    items,
    loading,
    error,
    showArchived,
    setShowArchived,
    refresh,
    createItem,
    updateItem,
    deleteItem,
    setItemArchived,
  }
}
