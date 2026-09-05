/**
 * Wardrobe Type Definitions
 *
 * Contains schemas for the modular wardrobe system: wardrobe items,
 * equipped outfit slots, and per-chat equipped state.
 *
 * Slots hold arrays of wardrobe item IDs — multiple items per slot are allowed
 * (e.g. a t-shirt under a sweater). Wardrobe items can also be composites
 * (referencing other items via `componentItemIds`); composites are stored
 * as their own ID in equipped state and expanded only at read time.
 *
 * @module schemas/wardrobe.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';
// ============================================================================
// WARDROBE ITEM TYPES
// ============================================================================

/**
 * All valid wardrobe slot types, in canonical order (types arrays, frontmatter,
 * bundle sorting, and UI slot rows all follow this order). Append new slots at
 * the END — inserting mid-list rewrites every serialized `types` array and
 * reorders existing UI.
 */
export const WARDROBE_SLOT_TYPES = ['top', 'bottom', 'footwear', 'accessories', 'hair'] as const;

/** Coverage slot types for wardrobe items (derived — never restate the list) */
export const WardrobeItemTypeEnum = z.enum(WARDROBE_SLOT_TYPES);
export type WardrobeItemType = z.infer<typeof WardrobeItemTypeEnum>;

/** Per-slot presentation and semantics metadata. One place to describe a slot. */
export interface WardrobeSlotMeta {
  /** Singular display label ("Hair") */
  label: string;
  /** Group-header label in the item editor ("Tops", "Hair") */
  groupLabel: string;
  /** qt-* badge class for this slot's chip */
  badgeClass: string;
  /**
   * True for garment slots that participate in nudity semantics; false for
   * styling slots (hair). Drives naked collapses and deliberate-unclothed
   * detection.
   */
  isClothing: boolean;
  /**
   * Whether an EMPTY slot is reported at all — to an LLM, to an image model, or
   * to the user.
   *
   * True for garment slots, where emptiness is real information: an empty top
   * means "topless", an empty footwear slot means "barefoot".
   *
   * False for styling slots ("unreported-if-blank"). An empty `hair` slot does
   * NOT mean the character has no hair — it means their hair is in its natural,
   * unstyled state, which the physical description already covers. Saying
   * anything at all about it invites a model to render a bald character or to
   * narrate the absence. Every surface that lists slots must SKIP an empty
   * unreported-if-blank slot entirely rather than emitting a phrase, a label,
   * or an "(empty)" marker for it.
   *
   * Use {@link isSlotReportedWhenEmpty} at reporting sites rather than testing
   * slot names.
   */
  reportWhenEmpty: boolean;
  /**
   * Phrase rendered when a *reported* slot is empty. Non-null exactly when
   * `reportWhenEmpty` is true; null for unreported-if-blank slots, which
   * render nothing.
   */
  emptyFallback: string | null;
}

export const WARDROBE_SLOT_META: Record<WardrobeItemType, WardrobeSlotMeta> = {
  top:         { label: 'Top',         groupLabel: 'Tops',        badgeClass: 'qt-badge-wardrobe-top',         isClothing: true,  reportWhenEmpty: true,  emptyFallback: 'topless' },
  bottom:      { label: 'Bottom',      groupLabel: 'Bottoms',     badgeClass: 'qt-badge-wardrobe-bottom',      isClothing: true,  reportWhenEmpty: true,  emptyFallback: 'bottomless' },
  footwear:    { label: 'Footwear',    groupLabel: 'Footwear',    badgeClass: 'qt-badge-wardrobe-footwear',    isClothing: true,  reportWhenEmpty: true,  emptyFallback: 'barefoot' },
  accessories: { label: 'Accessories', groupLabel: 'Accessories', badgeClass: 'qt-badge-wardrobe-accessories', isClothing: true,  reportWhenEmpty: true,  emptyFallback: 'no accessories' },
  hair:        { label: 'Hair',        groupLabel: 'Hair',        badgeClass: 'qt-badge-wardrobe-hair',        isClothing: false, reportWhenEmpty: false, emptyFallback: null },
};

/** Slots that count as clothing for nudity/undress semantics. */
export const CLOTHING_SLOT_TYPES: readonly WardrobeItemType[] =
  WARDROBE_SLOT_TYPES.filter((s) => WARDROBE_SLOT_META[s].isClothing);

/**
 * True when an empty `slot` should still be reported (as a phrase, a label, or
 * an "(empty)" marker). False for unreported-if-blank slots — skip them.
 *
 * Call this at every site that enumerates slots for an LLM, an image model, or
 * the reader. See {@link WardrobeSlotMeta.reportWhenEmpty}.
 */
export function isSlotReportedWhenEmpty(slot: WardrobeItemType): boolean {
  return WARDROBE_SLOT_META[slot].reportWhenEmpty;
}

/**
 * Slots that vanish from every report when empty (today: `hair`).
 */
export const UNREPORTED_IF_BLANK_SLOT_TYPES: readonly WardrobeItemType[] =
  WARDROBE_SLOT_TYPES.filter((s) => !WARDROBE_SLOT_META[s].reportWhenEmpty);

// ============================================================================
// WARDROBE ITEM API SCHEMAS (single source for create + update routes)
// ============================================================================

/**
 * The editable field set shared by the project-wardrobe create and update
 * endpoints. `createWardrobeSchema` uses these required fields as-is;
 * `updateWardrobeSchema` is `.partial()` of this so every field becomes
 * optional for PATCH/PUT-style updates.
 */
export const wardrobeItemFieldsSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().nullable().optional(),
  /** Plain-text image-generation cue; preferred over title in image prompts. */
  imagePrompt: z.string().nullable().optional(),
  types: z.array(WardrobeItemTypeEnum).min(1, 'At least one type is required'),
  appropriateness: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  /** IDs of other items this composite bundles. Empty/omitted = leaf item. */
  componentItemIds: z.array(z.string()).optional(),
  /** Composite-only: clear the designated slots on equip instead of layering. */
  replace: z.boolean().optional(),
});

/** Body schema for creating a project wardrobe item (required fields). */
export const createWardrobeSchema = wardrobeItemFieldsSchema;

/**
 * Body schema for updating a project or group wardrobe item (all fields
 * optional), plus the `archived` boolean the item routes translate into
 * `archivedAt` via `lib/wardrobe/archived-patch`.
 */
export const updateWardrobeSchema = wardrobeItemFieldsSchema.partial().extend({
  archived: z.boolean().optional(),
});

// ============================================================================
// WARDROBE ITEM
// ============================================================================

export const WardrobeItemSchema = z.object({
  id: UUIDSchema,
  /** Character this item belongs to. Null = archetype (shared across characters). */
  characterId: UUIDSchema.nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  /**
   * Optional plain-text phrase fed to image-generation pipelines (avatar +
   * Lantern scene) IN PLACE OF the title when present; falls back to `title`
   * when absent/empty. Unlike `description` (human prose / Markdown, stripped
   * from image prompts), this is a short, literal visual cue meant for a
   * diffusion model — e.g. "intricate dense burnished-gold circular rank glyph
   * on the shoulder". Keep it terse; it is joined into a comma-separated outfit
   * list. Never Markdown.
   */
  imagePrompt: z.string().nullable().optional(),
  /** Coverage tags — which slots this item covers (e.g., ["top"], ["top","bottom"] for a dress) */
  types: z.array(WardrobeItemTypeEnum).min(1),
  /**
   * Other wardrobe items this item is composed of. Empty = leaf item.
   * Cycles (direct or transitive self-reference) are rejected at save time
   * by `WardrobeRepository.create`/`update` and the vault overlay materializer.
   */
  componentItemIds: z.array(UUIDSchema).default([]),
  /** Context tags for when this item is appropriate (e.g., "casual", "formal", "intimate") */
  appropriateness: z.string().nullable().optional(),
  /** Whether this item is part of the character's default outfit */
  isDefault: z.boolean().default(false),
  /**
   * Composite behaviour on equip. `false`/absent (the default) = additive:
   * the composite's components layer onto whatever already occupies the slots
   * it designates, clearing nothing. `true` = the composite clears every slot
   * it designates (its `types`) and then places only its own components — used
   * for full-outfit swaps and "clear everything" composites like Naked. Has no
   * effect on leaf (non-composite) items, which always replace their slots.
   */
  replace: z.boolean().default(false),
  /** Provenance tracking for items migrated from legacy clothingRecords */
  migratedFromClothingRecordId: UUIDSchema.nullable().optional(),
  /** When the item was archived (null = active) */
  archivedAt: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type WardrobeItem = z.infer<typeof WardrobeItemSchema>;

// ============================================================================
// EQUIPPED OUTFIT STATE
// ============================================================================

/**
 * Per-character equipped slots. Each slot holds an array of wardrobe item IDs;
 * multiple items per slot represent layering (t-shirt + sweater). Composite
 * items appear as a single ID and are expanded at read time.
 */
const equippedSlotArray = () => z.array(UUIDSchema).default([]);

export const EquippedSlotsSchema = z.object({
  top: equippedSlotArray(),
  bottom: equippedSlotArray(),
  footwear: equippedSlotArray(),
  accessories: equippedSlotArray(),
  hair: equippedSlotArray(),
} satisfies Record<WardrobeItemType, ReturnType<typeof equippedSlotArray>>);

export type EquippedSlots = z.infer<typeof EquippedSlotsSchema>;

/** Per-chat equipped outfit state, keyed by characterId */
export type EquippedOutfitState = Record<string, EquippedSlots>;

// ============================================================================
// OUTFIT SELECTION (for new chat creation)
// ============================================================================

export const OutfitSelectionModeEnum = z.enum(['default', 'manual', 'llm_choose', 'none', 'previous_chat']);
export type OutfitSelectionMode = z.infer<typeof OutfitSelectionModeEnum>;

export const OutfitSelectionSchema = z.object({
  characterId: UUIDSchema,
  mode: OutfitSelectionModeEnum,
  /** Manual slot selections — only used when mode is 'manual' */
  slots: EquippedSlotsSchema.optional(),
});

export type OutfitSelection = z.infer<typeof OutfitSelectionSchema>;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build a full per-slot record by asking `fn` for each slot's value, in
 * canonical slot order. The one place a `Record<WardrobeItemType, T>` is
 * assembled — every "empty slots" / "clone slots" / "titles per slot" builder
 * is a one-line call to this, so a new slot appears everywhere at once.
 */
export function bySlot<T>(fn: (slot: WardrobeItemType) => T): Record<WardrobeItemType, T> {
  return Object.fromEntries(WARDROBE_SLOT_TYPES.map((s) => [s, fn(s)])) as Record<WardrobeItemType, T>;
}

/** Fresh all-empty equipped slots. Prefer this over spreading EMPTY_EQUIPPED_SLOTS. */
export function makeEmptyEquippedSlots(): EquippedSlots {
  return bySlot<string[]>(() => []);
}

/** Empty equipped slots (all empty arrays) — kept for existing call sites. */
export const EMPTY_EQUIPPED_SLOTS: EquippedSlots = makeEmptyEquippedSlots();

/** Deep-ish clone (fresh arrays per slot). Tolerates missing keys on raw JSON. */
export function cloneEquippedSlots(slots: EquippedSlots): EquippedSlots {
  return bySlot((s) => [...(slots[s] ?? [])]);
}

/** Every item id equipped in any slot, deduplicated. Tolerates missing keys. */
export function allEquippedItemIds(slots: EquippedSlots): string[] {
  return Array.from(new Set(WARDROBE_SLOT_TYPES.flatMap((s) => slots[s] ?? [])));
}

/**
 * Coerce a raw stored slot bag into a full five-slot `EquippedSlots`.
 *
 * `equippedOutfit` is unconstrained JSON and slots were added over time (the
 * hair slot arrived after real instances were already writing four-key rows),
 * so anything read back off a chat row may be missing keys entirely. Every
 * slot in `EquippedSlotsSchema` is `.default([])`, which makes the parse the
 * canonical repair — this is the one place that performs it, so a legacy row
 * reads as an empty slot rather than an `undefined` the readers then iterate.
 *
 * Malformed values (a non-array slot, a non-string entry) fall back to a
 * key-by-key salvage rather than discarding the whole bag: what is still
 * legible survives, the rest becomes an empty slot.
 */
export function normalizeEquippedSlots(raw: unknown): EquippedSlots {
  const parsed = EquippedSlotsSchema.safeParse(raw ?? {});
  if (parsed.success) {
    return parsed.data;
  }

  const bag = (raw ?? {}) as Record<string, unknown>;
  return bySlot((slot) => {
    const value = bag[slot];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  });
}

