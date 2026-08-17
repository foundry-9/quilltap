/**
 * Back-compat folding for pre-rework backup shapes. Pure data transforms with
 * no DB or filesystem access: legacy outfit presets become composite wardrobe
 * items, and legacy per-character equipped-slot maps (single UUID-or-null) are
 * upgraded to the array shape the current restore path consumes.
 *
 * @module backup/restore/legacy-migrations
 */

import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItemType, EquippedSlots } from '@/lib/schemas/wardrobe.types';

/**
 * Legacy outfit preset shape — only used to fold old backups into composites.
 * Kept local since the type is otherwise gone from the data model.
 */
export interface LegacyOutfitPreset {
  id: string;
  characterId: string | null;
  name: string;
  description: string | null;
  slots: {
    top: string | null;
    bottom: string | null;
    footwear: string | null;
    accessories: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Legacy per-character equipped slot shape from pre-rework backups: each slot
 * holds a single UUID or null instead of an array of UUIDs.
 */
export interface LegacyEquippedSlots {
  top: string | null;
  bottom: string | null;
  footwear: string | null;
  accessories: string | null;
}

/**
 * Slot-order for stable componentItemIds derivation when folding legacy presets.
 */
const LEGACY_SLOT_ORDER: ReadonlyArray<keyof LegacyOutfitPreset['slots']> = [
  'top',
  'bottom',
  'footwear',
  'accessories',
];

/**
 * Compute the deduped, ordered list of slot types covered by the non-null
 * components of a legacy preset. Order follows LEGACY_SLOT_ORDER.
 */
export function dedupeAndOrderSlotTypes(
  slots: LegacyOutfitPreset['slots']
): WardrobeItemType[] {
  const seen = new Set<WardrobeItemType>();
  const out: WardrobeItemType[] = [];
  for (const slot of LEGACY_SLOT_ORDER) {
    if (slots[slot] && !seen.has(slot)) {
      seen.add(slot);
      out.push(slot);
    }
  }
  // A composite must always declare at least one type. If every slot is null
  // (a malformed legacy preset), fall back to "accessories" so the schema
  // validation still passes.
  if (out.length === 0) out.push('accessories');
  return out;
}

/**
 * Collect non-null component IDs from the legacy slot map in slot order.
 */
export function orderedComponentIds(slots: LegacyOutfitPreset['slots']): string[] {
  const ids: string[] = [];
  for (const slot of LEGACY_SLOT_ORDER) {
    const id = slots[slot];
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Detect the per-character equipped-slot shape and upgrade legacy `id|null`
 * shapes to `id ? [id] : []`. Idempotent: already-array shapes pass through.
 */
export function upgradeLegacyEquippedSlots(
  raw: LegacyEquippedSlots | EquippedSlots | null | undefined
): EquippedSlots | null {
  if (!raw) return null;
  const upgrade = (val: unknown): string[] => {
    if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
    if (typeof val === 'string') return [val];
    return [];
  };
  // Built over the live slot list rather than the four legacy names: slots the
  // legacy shape never had (hair) simply upgrade to `[]`, which is the correct
  // reading of a backup written before they existed.
  return Object.fromEntries(
    WARDROBE_SLOT_TYPES.map((slot) => [slot, upgrade((raw as Record<string, unknown>)[slot])]),
  ) as unknown as EquippedSlots;
}
