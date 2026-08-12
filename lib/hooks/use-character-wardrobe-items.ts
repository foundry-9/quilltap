'use client'

/**
 * Unified character wardrobe loader.
 *
 * Loads a character's wearable garments across the tri-tier wardrobe model and
 * merges them (de-duped by id, nearer tier winning on collision):
 *   1. the character's personal vault items
 *   2. the active project's shared wardrobe (when a `projectId`/`chatId` is given)
 *   3. the Quilltap General shared archetype library
 *
 * Used by:
 *  - The global wardrobe dialog (`WardrobeControlDialogInner`) — passes `chatId`,
 *    from which the project tier is resolved.
 *  - The chat-start outfit composer (`OutfitSelector`'s `manual` mode) — passes
 *    `projectId` directly when the new chat belongs to a project.
 *
 * @module lib/hooks/use-character-wardrobe-items
 */

import { useCallback, useEffect, useState } from 'react'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

export interface UseCharacterWardrobeItemsResult {
  items: WardrobeItem[]
  loading: boolean
  /**
   * True once at least one fetch has completed for the current character —
   * even when it resolved to an empty list. Distinct from `!loading`, which is
   * also true in the initial pre-fetch tick. Lets callers tell "no items yet
   * because we haven't looked" apart from "looked, found none".
   */
  fetched: boolean
  /**
   * The project tier this loader resolved (from an explicit `projectId` or
   * derived from `chatId`), or null when there is none. Lets callers offer a
   * "create in this project" affordance without re-resolving the chat.
   */
  projectId: string | null
  /** Re-fetch personal + project + archetype items. */
  reload: () => Promise<void>
}

export interface UseCharacterWardrobeItemsOptions {
  /** Project whose shared wardrobe should be folded in (the project tier). */
  projectId?: string | null
  /**
   * Chat to derive the project tier from when `projectId` isn't known directly
   * (the in-chat wardrobe dialog has a chat id but not the project id).
   */
  chatId?: string | null
}

export function useCharacterWardrobeItems(
  characterId: string | null | undefined,
  opts?: UseCharacterWardrobeItemsOptions,
): UseCharacterWardrobeItemsResult {
  const projectId = opts?.projectId ?? null
  const chatId = opts?.chatId ?? null
  const [items, setItems] = useState<WardrobeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [resolvedProjectId, setResolvedProjectId] = useState<string | null>(projectId)

  const reload = useCallback(async (): Promise<void> => {
    if (!characterId) {
      setItems([])
      setFetched(false)
      return
    }
    setLoading(true)
    try {
      // Resolve the project tier: an explicit projectId wins; otherwise derive
      // it from the chat (the dialog only carries a chat id).
      let projectTierId = projectId
      if (!projectTierId && chatId) {
        try {
          const chatRes = await fetch(`/api/v1/chats/${chatId}`)
          if (chatRes.ok) {
            const data = (await chatRes.json()) as { chat?: { projectId?: string | null } }
            projectTierId = data.chat?.projectId ?? null
          }
        } catch {
          /* project tier simply won't be folded in */
        }
      }
      setResolvedProjectId(projectTierId)

      const [personalRes, projectRes, archetypeRes] = await Promise.all([
        fetch(`/api/v1/characters/${characterId}/wardrobe`),
        projectTierId
          ? fetch(`/api/v1/projects/${projectTierId}/wardrobe`)
          : Promise.resolve(null),
        fetch('/api/v1/wardrobe'),
      ])

      // Merge with precedence: personal > project > general.
      const collected: WardrobeItem[] = []
      const push = (list: WardrobeItem[] | undefined) => {
        for (const w of list ?? []) {
          if (!collected.some((c) => c.id === w.id)) collected.push(w)
        }
      }
      if (personalRes.ok) {
        const data = (await personalRes.json()) as { wardrobeItems?: WardrobeItem[] }
        push(data.wardrobeItems)
      }
      if (projectRes && projectRes.ok) {
        const data = (await projectRes.json()) as { wardrobeItems?: WardrobeItem[] }
        push(data.wardrobeItems)
      }
      if (archetypeRes.ok) {
        const data = (await archetypeRes.json()) as { wardrobeItems?: WardrobeItem[] }
        push(data.wardrobeItems)
      }
      setItems(collected)
    } catch (err) {
      console.warn('[useCharacterWardrobeItems] Failed to load wardrobe', err)
      setItems([])
    } finally {
      setLoading(false)
      setFetched(true)
    }
  }, [characterId, projectId, chatId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload wraps an async fetch; the setState lands well after this effect tick
    void reload()
  }, [reload])

  return { items, loading, fetched, projectId: resolvedProjectId, reload }
}
