/**
 * Persist AI-generated wardrobe items (from the AI Wizard) to a character.
 *
 * Generated composites reference their components by title; this creates leaf
 * garments first, collects the ids the API mints, then creates composites with
 * the resolved `componentItemIds`. Shared by the new-character and
 * edit-character views.
 */

import { orderGeneratedItemsLeafFirst } from '@/lib/wardrobe/generated-items'
import type { GeneratedWardrobeItem } from '@/components/characters/ai-wizard'

export async function saveGeneratedWardrobeItems(
  characterId: string,
  items: GeneratedWardrobeItem[]
): Promise<{ saved: number; outfits: number }> {
  const ordered = orderGeneratedItemsLeafFirst(items)
  const idByTitle = new Map<string, string>()
  let saved = 0
  let outfits = 0

  for (const item of ordered) {
    const componentItemIds = (item.components ?? [])
      .map((title) => idByTitle.get(title.trim().toLowerCase()))
      .filter((id): id is string => Boolean(id))

    try {
      const res = await fetch(`/api/v1/characters/${characterId}/wardrobe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          description: item.description || null,
          imagePrompt: item.imagePrompt || null,
          types: item.types,
          appropriateness: item.appropriateness || null,
          isDefault: item.isDefault === true,
          componentItemIds,
          replace: item.replace === true,
        }),
      })
      if (res.ok) {
        saved++
        if (componentItemIds.length > 0) outfits++
        const data = await res.json().catch(() => null)
        const createdId = data?.wardrobeItem?.id
        if (typeof createdId === 'string') {
          idByTitle.set(item.title.trim().toLowerCase(), createdId)
        }
      } else {
        console.error('Failed to save generated wardrobe item', { title: item.title, status: res.status })
      }
    } catch (err) {
      console.error('Error saving generated wardrobe item', err instanceof Error ? err.message : String(err))
    }
  }

  return { saved, outfits }
}
