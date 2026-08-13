/**
 * Staged Live-tab outfit edits
 *
 * The Wardrobe dialog's "Wearing now" tab stages every gesture locally and
 * commits once, on Done. Two moments in that lifecycle have to reckon with a
 * worn snapshot that has not arrived yet, and both live here so they can be
 * reasoned about — and tested — away from the dialog's render logic.
 *
 *  - `rebaseStagedSlots` replays the gestures made during the window before the
 *    snapshot landed onto the true worn slots, so a fast click is neither
 *    overwritten by the first seed nor committed against an empty base.
 *  - `classifyStagedOutfits` separates "nothing changed" from "we never learned
 *    what clean was", which the flush used to treat identically — reporting
 *    success for an outfit it never sent (Bug 61).
 *
 * @module lib/wardrobe/staged-live-outfits
 */

import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types'
import { cloneSlots } from '@/lib/wardrobe/bundle-mutations'

/** A staging gesture: pure, and safe to replay against a different base. */
export type SlotsMutator = (prev: EquippedSlots) => EquippedSlots

/** Deep array equality on the four EquippedSlots arrays, in order. */
export function equippedSlotsEqual(a: EquippedSlots, b: EquippedSlots): boolean {
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
 * Replay gestures staged before the worn snapshot arrived onto that snapshot.
 *
 * With no snapshot to build on, the dialog stages onto an empty fallback purely
 * so the click paints. Committing that would clear every slot the user never
 * touched, so the gestures are recorded and replayed here the moment the real
 * slots land. Mutators are pure, so applying them twice (once for the optimistic
 * paint, once here) is safe.
 */
export function rebaseStagedSlots(
  wornSlots: EquippedSlots,
  pending: readonly SlotsMutator[],
): EquippedSlots {
  return pending.reduce<EquippedSlots>((slots, mutate) => mutate(slots), cloneSlots(wornSlots))
}

/** What the Done flush should do with each character's staged slots. */
export interface StagedOutfitClassification {
  /** Characters whose staged slots differ from their captured baseline. */
  dirty: Array<{ characterId: string; slots: EquippedSlots }>
  /**
   * Characters staged against no baseline at all — their worn snapshot never
   * arrived, so the edit can be neither confirmed as a change nor safely sent
   * (the staged slots were built on an empty fallback). The caller must surface
   * these rather than counting them as clean.
   */
  unresolved: string[]
}

/**
 * Split staged outfits into the ones to commit and the ones we cannot judge.
 *
 * A character with a baseline and matching slots is simply clean and appears in
 * neither list.
 */
export function classifyStagedOutfits(
  staged: Record<string, EquippedSlots>,
  baselines: Record<string, EquippedSlots>,
): StagedOutfitClassification {
  const dirty: Array<{ characterId: string; slots: EquippedSlots }> = []
  const unresolved: string[] = []

  for (const [characterId, slots] of Object.entries(staged)) {
    const baseline = baselines[characterId]
    if (!baseline) {
      unresolved.push(characterId)
      continue
    }
    if (!equippedSlotsEqual(slots, baseline)) {
      dirty.push({ characterId, slots })
    }
  }

  return { dirty, unresolved }
}
