/**
 * The one mapping from a validated wardrobe create body to the stored shape
 * of a wardrobe item (everything but `id` / `createdAt` / `updatedAt`).
 *
 * Every create endpoint — character, General, project, group — and the
 * transfer route's "land a copy here" write build their item through this,
 * so the defaults (`componentItemIds: []`, `isDefault: false`, `replace:
 * false`, nulls for the optional prose fields, no clothing-record provenance)
 * can't drift between tiers.
 *
 * Client-safe: type-only imports.
 *
 * @module lib/wardrobe/create-body
 */

import type { z } from 'zod';
import type { createWardrobeSchema, WardrobeItem } from '@/lib/schemas/wardrobe.types';

/** A parsed `createWardrobeSchema` body. A full `WardrobeItem` satisfies it too. */
export type WardrobeCreateBody = z.infer<typeof createWardrobeSchema>;

/** What the repository's `create` takes: an item minus its id and timestamps. */
export type WardrobeCreateData = Omit<WardrobeItem, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Map a validated create body onto the stored item fields for `characterId`
 * (`null` for a shared item). Optional body fields resolve to their storage
 * defaults; `migratedFromClothingRecordId` is always `null` for a fresh item.
 */
export function wardrobeItemFromCreateBody(
  body: WardrobeCreateBody,
  characterId: string | null,
): WardrobeCreateData {
  return {
    characterId,
    title: body.title,
    description: body.description ?? null,
    imagePrompt: body.imagePrompt ?? null,
    types: body.types,
    componentItemIds: body.componentItemIds ?? [],
    appropriateness: body.appropriateness ?? null,
    isDefault: body.isDefault ?? false,
    replace: body.replace ?? false,
    migratedFromClothingRecordId: null,
  };
}
