/**
 * Outfit Description Utility
 *
 * Single source of truth for converting equipped wardrobe slot values
 * into a human-readable description of what a character is wearing.
 *
 * Each slot holds an array of item titles. An empty array means nothing is
 * worn in that slot. Multiple titles in a slot represent layering (e.g.
 * t-shirt + sweater); they're listed in the order callers provided them
 * and the LLM is expected to figure out what shows.
 *
 * @module wardrobe/outfit-description
 */

import {
  WARDROBE_SLOT_TYPES,
  WARDROBE_SLOT_META,
  bySlot,
  isSlotReportedWhenEmpty,
} from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'

/**
 * Slot values for describing an outfit. Each slot is an array of human-readable
 * item titles. Empty array means the slot is empty.
 */
export type OutfitSlotValues = Record<WardrobeItemType, string[]>

export type OutfitSlotName = keyof OutfitSlotValues

/** Build a full OutfitSlotValues by asking fn for each slot's strings. */
export function buildOutfitSlotValues(
  fn: (slot: WardrobeItemType) => string[],
): OutfitSlotValues {
  return bySlot(fn)
}

/**
 * Format resolved wardrobe leaf items as the title/description strings that
 * {@link describeOutfit} expects. Each item collapses to `"title"` or
 * `"title (description)"` depending on whether a description is present.
 *
 * Pass `titleOnly: true` for image-generation pipelines — wardrobe item
 * `description` is human prose (style commentary, narrative voice) that
 * bloats image prompts and confuses cheap LLMs into echoing it verbatim.
 *
 * In the `titleOnly` (image) path, an item's optional `imagePrompt` is
 * preferred over its `title` when present and non-blank. `imagePrompt` is a
 * short plain-text visual cue authored specifically for a diffusion model
 * (e.g. a literal description of a rank glyph), letting the picture carry a
 * cue the bare title can't convey while the title stays human-readable.
 * It has no effect on the non-`titleOnly` (prose) path.
 */
export function decorateOutfitItems(
  items: ReadonlyArray<{ title: string; description?: string | null; imagePrompt?: string | null }>,
  options: { titleOnly?: boolean } = {},
): string[] {
  if (options.titleOnly) {
    return items.map(i => {
      const cue = i.imagePrompt?.trim()
      return cue && cue.length > 0 ? cue : i.title
    })
  }
  return items.map(i => (i.description ? `${i.title} (${i.description})` : i.title))
}

export interface DescribeOutfitOptions {
  /**
   * Slots to leave out of the rendered description entirely. Omitted slots
   * produce no line and don't participate in the "all empty → naked" or
   * "top + bottom both empty → naked" fallbacks. Useful for portrait/avatar
   * prompts that only describe the upper body.
   */
  omit?: ReadonlyArray<OutfitSlotName>
}

/**
 * Produce a markdown description of what a character is wearing
 * based on their equipped wardrobe slots.
 *
 * Rules (apply only to non-omitted slots):
 * - All visible slots empty (clothing AND hair) → "- completely naked and unadorned"
 * - Top AND bottom both visible and empty → "- naked" (footwear/accessories listed separately)
 * - Only top empty → "- **top:** topless"
 * - Only bottom empty → "- **bottom:** bottomless"
 * - Footwear empty → "- **footwear:** barefoot"
 * - Accessories empty → "- **accessories:** no accessories"
 * - An empty slot whose `reportWhenEmpty` is false (hair) → nothing at all. A
 *   hairdo is styling, not a garment: an empty hair slot means the character's
 *   hair is in its natural state, which the physical description already
 *   covers. Such a slot never contributes a negative-space line — a character
 *   with no hair item must never read as bald — and never blocks the "naked"
 *   collapse.
 * - Multiple items in a slot → comma-joined under the slot label
 *
 * Slots that share the same value (e.g. a single multi-slot item equipped
 * across top/bottom/footwear/accessories) are collapsed to one line.
 */
export function describeOutfit(slots: OutfitSlotValues, options: DescribeOutfitOptions = {}): string {
  const omit = new Set<OutfitSlotName>(options.omit ?? [])
  /** Slot → titles, or null when the slot is omitted from this rendering. */
  const visible = Object.fromEntries(
    WARDROBE_SLOT_TYPES.map((slot) => [slot, omit.has(slot) ? null : (slots[slot] ?? [])]),
  ) as Record<WardrobeItemType, string[] | null>

  const allVisibleEmpty = WARDROBE_SLOT_TYPES
    .every((slot) => visible[slot] === null || visible[slot]!.length === 0)

  if (allVisibleEmpty) {
    return '- completely naked and unadorned\n'
  }

  const lines: string[] = []
  const groups = new Map<string, string[]>()
  const addSlot = (slot: string, value: string) => {
    const existing = groups.get(value)
    if (existing) existing.push(slot)
    else groups.set(value, [slot])
  }

  // The "naked" collapse only applies when both top and bottom are visible.
  const topVisible = visible.top !== null
  const bottomVisible = visible.bottom !== null
  const nakedCollapse =
    topVisible && bottomVisible && visible.top!.length === 0 && visible.bottom!.length === 0
  if (nakedCollapse) {
    lines.push('- naked')
  }

  for (const slot of WARDROBE_SLOT_TYPES) {
    if (nakedCollapse && (slot === 'top' || slot === 'bottom')) continue
    const items = visible[slot]
    if (items === null) continue
    if (items.length > 0) {
      addSlot(slot, items.join(', '))
      continue
    }
    // Empty slot: render its negative-space phrase, unless the slot is
    // unreported-if-blank (hair) — those vanish entirely rather than telling a
    // reader or an image model that something is missing.
    if (!isSlotReportedWhenEmpty(slot)) continue
    const fallback = WARDROBE_SLOT_META[slot].emptyFallback
    if (fallback !== null) addSlot(slot, fallback)
  }

  for (const [value, slotsForValue] of groups) {
    lines.push(`- **${slotsForValue.join(', ')}:** ${value}`)
  }

  return lines.join('\n') + '\n'
}
