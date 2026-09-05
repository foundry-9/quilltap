/**
 * Shared LLM-facing wording for the wardrobe slots.
 *
 * The `hair` slot is the one that needs explaining every time it is offered to
 * a model: it holds a *hairdo*, not hair. Keeping the sentence in one place
 * means the wardrobe tools, the outfit-choosing prompt, the character
 * generators, and the image analyser all draw the wardrobe/physical line the
 * same way — a model that reads two different versions of this rule files
 * hair colour as a garment.
 *
 * @module wardrobe/slot-guidance
 */

/**
 * The wardrobe/physical boundary for hair, phrased for a tool parameter
 * description. Append to any `types`/`slot` parameter gloss.
 */
export const HAIR_SLOT_GUIDANCE =
  'The "hair" slot holds a hairstyle or hairdo (braided, permed, an updo, a ' +
  'wig) — the styling, not the hair itself; natural hair colour and length ' +
  "belong in the character's physical description, and an empty hair slot " +
  'simply means unstyled hair.';

/**
 * The same boundary phrased for a prose prompt paragraph (the character
 * generators and optimizer), where it reads as an exception to the
 * "permanent body features are physical description" rule.
 */
export const HAIR_PHYSICAL_BOUNDARY =
  'Anything permanently part of the body (scars, tattoos, fur) is PHYSICAL ' +
  'DESCRIPTION, not wardrobe — with one deliberate exception: a hairSTYLE ' +
  'goes in the wardrobe\'s "hair" slot, while the hair\'s natural colour, ' +
  'length, and texture stay in the physical description.';

/**
 * The complement of {@link HAIR_PHYSICAL_BOUNDARY}, for physical-description
 * prompts that would otherwise claim all hair.
 */
export const HAIR_PHYSICAL_DESCRIPTION_NOTE =
  'Natural hair — colour, length, texture — belongs here; a deliberate ' +
  'hairSTYLE (braids, an updo, a wig) belongs in the WARDROBE\'s "hair" slot ' +
  'instead. Describe the hair itself, not its styling.';
