/**
 * Shared constants and the candidate-grouping helper for the WardrobeItemEditor
 * component picker.
 */

import { WARDROBE_SLOT_TYPES, WARDROBE_SLOT_META } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import type { CandidateItem, CandidateGroup } from './types'

export const GROUP_LABEL: Record<CandidateGroup, string> = {
  ...(Object.fromEntries(
    WARDROBE_SLOT_TYPES.map((slot) => [slot, WARDROBE_SLOT_META[slot].groupLabel]),
  ) as Record<WardrobeItemType, string>),
  multi: 'Multi-slot',
}

/** Slot groups in canonical order; the multi-slot catch-all always sits last. */
export const GROUP_ORDER: CandidateGroup[] = [...WARDROBE_SLOT_TYPES, 'multi']

export function getCandidateGroup(c: CandidateItem): CandidateGroup {
  if (c.types.length > 1) return 'multi'
  return (c.types[0] as CandidateGroup) ?? 'multi'
}
