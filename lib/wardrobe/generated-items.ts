/**
 * LLM-generated wardrobe items — the shared shape, generation prompt, and
 * sanitizer used by every system that generates wardrobe content with AI
 * (the AI Wizard and Summon From Lore; the character optimizer reuses the
 * same item shape for its wardrobe suggestions).
 *
 * Generated composites reference their components by *title* (the LLM has no
 * ids); each persistence path resolves titles to real item ids after creation.
 *
 * @module lib/wardrobe/generated-items
 */

import { WARDROBE_SEMANTICS } from '@/lib/services/character-field-semantics';
import { WardrobeItemTypeEnum } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types';

export interface GeneratedWardrobeItem {
  title: string;
  description: string;
  /** Terse literal visual cue for image generation; never Markdown. */
  imagePrompt?: string;
  types: WardrobeItemType[];
  appropriateness?: string;
  /** Part of the character's default outfit. */
  isDefault?: boolean;
  /**
   * Composite outfit: titles of other items from the same generation batch
   * that this entry bundles. The persistence layer resolves titles to the
   * created items' ids (componentItemIds). Empty/absent = leaf garment.
   */
  components?: string[];
  /** Composite-only: clear the designated slots on equip instead of layering. */
  replace?: boolean;
}

export const WARDROBE_ITEMS_GENERATION_PROMPT = `${WARDROBE_SEMANTICS}

Generate this character's wardrobe based on the context provided and their typical clothing and style.
Each item must cover one or more of these slot types: "top" (shirts, jackets, dresses that cover the torso), "bottom" (pants, skirts, shorts), "footwear" (shoes, boots, sandals), "accessories" (jewelry, hats, belts, scarves, bags), "hair" (a hairstyle or hairdo — braided, permed, an updo, a wig; the styling, not the hair itself).

A single item can cover multiple slots — for example, a full-length dress would have types ["top", "bottom"].

Respond with ONLY valid JSON, no markdown fences:
[
  {
    "title": "Short descriptive name for the item",
    "description": "A sentence or two describing the item's appearance in detail",
    "imagePrompt": "Terse literal visual cue for image generation, e.g. 'worn brown leather duster with brass buttons'",
    "types": ["top"],
    "appropriateness": "casual, everyday",
    "isDefault": false
  },
  {
    "title": "Name for a complete outfit",
    "description": "One sentence describing the ensemble as a whole",
    "types": ["top", "bottom", "footwear"],
    "appropriateness": "casual, everyday",
    "isDefault": true,
    "components": ["exact title of item 1", "exact title of item 2", "exact title of item 3"],
    "replace": true
  }
]

Rules:
- Generate 4-8 individual garments/accessories representing this character's typical wardrobe — a mix of everyday and situational items, plus optionally ONE signature hairstyle item (types: ["hair"]) if the character's look calls for a deliberate hairdo.
- Then add 1-2 composite OUTFITS: entries whose "components" array lists the exact titles of items from THIS response that are worn together. An outfit's "types" is the union of its components' slot types. Set "replace": true so equipping the outfit swaps out whatever was worn before; individual garments never need "components" or "replace".
- Mark the character's everyday outfit as the default: set "isDefault": true on the everyday composite outfit if you made one (preferred), otherwise on each everyday individual item. Everything else gets "isDefault": false.
- "imagePrompt" is fed directly to an image-generation model: short, literal, comma-friendly, never Markdown. Omit it only when the title already says everything visual.
- "appropriateness" is a comma-separated list of context tags describing when the item is appropriate (e.g., "casual", "formal", "combat", "sleepwear", "intimate").
- The wardrobe holds only removable things. Permanent bodily features (scars, tattoos, fur, anatomy) belong to the physical description and must never appear as wardrobe items — with one deliberate exception: a hairSTYLE goes in the "hair" slot, while the hair's natural colour, length, and texture stay in the physical description.`;

/**
 * Validate and normalize LLM-generated wardrobe items: drop invalid slot
 * types, coerce optional fields, and keep composite `components` references
 * only when they resolve to another item's title in the same batch.
 */
export function sanitizeGeneratedWardrobeItems(items: GeneratedWardrobeItem[]): GeneratedWardrobeItem[] {
  const validTypes = new Set<string>(WardrobeItemTypeEnum.options);
  const typed = (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item.title === 'string' && item.title.trim() && Array.isArray(item.types))
    .map((item) => ({
      title: item.title.trim(),
      description: typeof item.description === 'string' ? item.description : '',
      imagePrompt:
        typeof item.imagePrompt === 'string' && item.imagePrompt.trim() ? item.imagePrompt.trim() : undefined,
      types: item.types.filter((t) => validTypes.has(t)) as WardrobeItemType[],
      appropriateness: typeof item.appropriateness === 'string' ? item.appropriateness : undefined,
      isDefault: item.isDefault === true,
      components: Array.isArray(item.components)
        ? item.components.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        : undefined,
      replace: item.replace === true ? true : undefined,
    }))
    .filter((item) => item.types.length > 0);

  // Composite components must reference other titles from this same batch.
  const titles = new Set(typed.map((item) => item.title.toLowerCase()));
  return typed.map((item) => {
    if (!item.components || item.components.length === 0) {
      return { ...item, components: undefined, replace: undefined };
    }
    const resolvable = item.components.filter(
      (c) => titles.has(c.trim().toLowerCase()) && c.trim().toLowerCase() !== item.title.toLowerCase()
    );
    return resolvable.length > 0
      ? { ...item, components: resolvable }
      : { ...item, components: undefined, replace: undefined };
  });
}

/**
 * Order generated items so that leaf garments come before the composites that
 * reference them (and shallower composites before deeper ones), so persistence
 * paths that create items one at a time never write a composite ahead of its
 * components. Generic over the item shape so both the server (typed slots) and
 * client (string slots) representations can use it.
 */
export function orderGeneratedItemsLeafFirst<T extends { title: string; components?: string[] }>(
  items: T[]
): T[] {
  const depth = (item: T, seen: Set<string>): number => {
    if (!item.components || item.components.length === 0) return 0;
    if (seen.has(item.title.toLowerCase())) return 0; // defensive: sanitizer already rejects self-reference
    seen.add(item.title.toLowerCase());
    let max = 0;
    for (const title of item.components) {
      const component = items.find((i) => i.title.toLowerCase() === title.trim().toLowerCase());
      if (component) max = Math.max(max, depth(component, seen) + 1);
    }
    return max;
  };
  return [...items].sort((a, b) => depth(a, new Set()) - depth(b, new Set()));
}
