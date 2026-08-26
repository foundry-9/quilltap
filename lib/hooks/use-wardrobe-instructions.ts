'use client'

/**
 * Per-container dressing-instructions loader/saver.
 *
 * Loads (and saves) the optional `Wardrobe/instructions.md` of one wardrobe
 * container — a character's vault, Quilltap General, a project's store, or a
 * group's store — via that container's `?action=instructions` endpoint. No
 * tier merging here: the editor shows each container exactly its own file;
 * the character > group > project > general cascade is applied server-side
 * only when a character dresses themselves.
 *
 * Follows the wardrobe convention of plain `useState` + `fetch` (no React
 * Query) so it composes with the rest of the dialog's manual reloads.
 *
 * @module lib/hooks/use-wardrobe-instructions
 */

import { useCallback, useEffect, useState } from 'react'
import {
  wardrobeCollectionUrl,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'

export interface UseWardrobeInstructionsResult {
  /** The container's own instructions, or null when absent. */
  instructions: string | null
  loading: boolean
  /** True once at least one fetch has completed for the current container. */
  fetched: boolean
  saving: boolean
  /** Write (non-blank) or clear (null/blank) the file. Resolves true on success. */
  save: (value: string | null) => Promise<boolean>
  reload: () => Promise<void>
}

function instructionsUrl(container: WardrobeContainer): string {
  return `${wardrobeCollectionUrl(container)}?action=instructions`
}

export function useWardrobeInstructions(
  container: WardrobeContainer | null,
): UseWardrobeInstructionsResult {
  const scope = container?.scope ?? null
  const containerId = container?.id ?? null

  const [instructions, setInstructions] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    if (!scope) {
      setInstructions(null)
      setFetched(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(instructionsUrl({ scope, id: containerId }))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { instructions?: string | null }
      setInstructions(data.instructions ?? null)
    } catch (err) {
      console.warn('[useWardrobeInstructions] Failed to load dressing instructions', err)
      setInstructions(null)
    } finally {
      setLoading(false)
      setFetched(true)
    }
  }, [scope, containerId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload wraps an async fetch; the setState lands well after this effect tick
    void reload()
  }, [reload])

  const save = useCallback(
    async (value: string | null): Promise<boolean> => {
      if (!scope) return false
      setSaving(true)
      try {
        const res = await fetch(instructionsUrl({ scope, id: containerId }), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions: value }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { instructions?: string | null }
        setInstructions(data.instructions ?? null)
        return true
      } catch (err) {
        console.warn('[useWardrobeInstructions] Failed to save dressing instructions', err)
        return false
      } finally {
        setSaving(false)
      }
    },
    [scope, containerId],
  )

  return { instructions, loading, fetched, saving, save, reload }
}
