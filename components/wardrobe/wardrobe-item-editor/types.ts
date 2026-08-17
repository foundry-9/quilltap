/**
 * Shared types for the WardrobeItemEditor and its subcomponents.
 */

import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'

/** A wardrobe item summary shape used by the components multi-select. */
export interface CandidateItem {
  id: string
  title: string
  types: WardrobeItemType[]
  componentItemIds: string[]
  /** Whether this is a shared archetype (no characterId) */
  isShared: boolean
}

export type CandidateGroup = WardrobeItemType | 'multi'
