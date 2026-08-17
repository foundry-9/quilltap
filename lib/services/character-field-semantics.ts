/**
 * Character Field Semantics
 *
 * Single source of truth for the prose definitions of every character-data
 * bucket that an AI generation/editing system may read or write: the
 * vantage-point text fields (identity / description / personality / title),
 * the foundational manifesto, system prompts, properties (pronouns, aliases),
 * the physical description, and the wardrobe.
 *
 * Used by:
 * - the character optimizer (lib/services/character-optimizer.service.ts)
 * - the AI Wizard (lib/services/character-wizard.service.ts)
 * - Summon From Lore (lib/services/ai-import.service.ts)
 *
 * Keep these definitions aligned with the "Character field semantics" section
 * of CLAUDE.md and the doc comments on CharacterSchema
 * (lib/schemas/character.types.ts) and WardrobeItemSchema
 * (lib/schemas/wardrobe.types.ts).
 */

export const FIELD_SEMANTICS_PREAMBLE = `Quilltap distinguishes four character fields by *vantage point*, plus a fifth foundational field (manifesto) that is not a vantage point. Use these definitions to label which field each pattern belongs to — they are not interchangeable.

- MANIFESTO — the basic tenets, the most important facts of the character's existence. The axiomatic core that every other field should remain consistent with. Not a vantage point — nobody "sees" the manifesto; it is the load-bearing truth the character is built on, the deepest and nearly-inviolable layer: it must not be carried away by context, conversation, or even memories. Short, declarative, foundational. If a fact would be devastating to contradict, it belongs here.
- IDENTITY — the most surface-level knowledge of the character, from outside. What strangers can know on sight or by reputation: name, station, occupation, public reputation, signifying outward facts. Never internal motivation, never private mannerisms.
- DESCRIPTION — what someone talking to or acquainted with the character perceives. Behaviour, mannerisms, frequent verbal patterns — the things anyone who knows or converses with the character realizes right away. NOT physical appearance (that lives elsewhere) and NOT internal monologue.
- PERSONALITY — what the character knows about themselves. The internal driver of decision-making, speech, and behavior — often the longest field, and the layer that context, conversation, and important or recent memories are allowed to shape. Other characters don't see this unless she shares it.
- TITLE — the user's or character's own private label/framing for them. Not how others refer to them; not in scope for the optimizer to edit.`;

/**
 * The system-prompt bucket ("Prompt"): named, sometimes model-specific
 * instruction documents that tell the LLM how to roleplay the character.
 */
export const PROMPT_SEMANTICS = `- SYSTEM PROMPTS ("Prompt") — named instruction documents, written in second person ("You are…", "You always…"), that tell the roleplaying model HOW to perform the character: voice, pacing, formatting, boundaries, interaction style. A character can carry several named prompts (e.g. tuned for different models or moods) with one marked default. Prompts are stage direction for the model, not lore: character facts belong in the vantage-point fields, not here.`;

/**
 * The properties bucket: small structured facts (pronouns, aliases) stored as
 * data, not prose. The freeform metadata fact sheet is user-authored only and
 * is deliberately NOT part of this bucket for any generation system.
 */
export const PROPERTIES_SEMANTICS = `- PROPERTIES — small structured facts stored as data, not prose: PRONOUNS (subject/object/possessive, e.g. she/her/hers) and ALIASES (nicknames and alternate names others actually call the character — distinct from TITLE, which is the user's private framing). Only record pronouns and aliases the source material or established memories actually support; never invent placeholders. Note: pronouns also anchor image generation, so they must match the physical description.`;

/**
 * The physical-description bucket: the person with nothing removable —
 * anything wearable belongs to the wardrobe instead.
 */
export const PHYSICAL_DESCRIPTION_SEMANTICS = `- PHYSICAL DESCRIPTION — every physical detail of the character's person: face, hair, eyes, skin, build, distinctive features. Describe the person as if nothing removable were part of the description: NO clothing, outfits, jewelry, or accessories — anything that can be taken off belongs in the WARDROBE. Natural hair — colour, length, texture — belongs here; a deliberate hairSTYLE (braids, an updo, a wig) belongs in the WARDROBE's "hair" slot instead. Describe the hair itself, not its styling. Alongside the prose document, this bucket carries tiered image-generation prompt variants (head-and-shoulders / short / medium / long / complete).`;

/**
 * The wardrobe bucket: slot-typed clothing/accessory items and composite
 * outfits, per lib/schemas/wardrobe.types.ts.
 */
export const WARDROBE_SEMANTICS = `- WARDROBE — the clothing, outfits, and accessories the character can and does wear. Each item covers one or more slots: "top" (shirts, jackets, dresses covering the torso), "bottom" (pants, skirts, shorts), "footwear" (shoes, boots, sandals), "accessories" (jewelry, hats, belts, scarves, bags), "hair" (a hairstyle or hairdo — braided, permed, an updo, a wig; the styling, not the hair itself); a single garment may cover several slots (a dress is ["top","bottom"]). Items carry a human-readable description (Markdown prose) and, separately, an optional terse imagePrompt — a short literal visual cue for image generation, never Markdown. Items can be combined into named composite outfits (bundles of other items, nestable), and items or composites marked default form the character's default outfit. Anything permanently part of the body (scars, tattoos, fur) is PHYSICAL DESCRIPTION, not wardrobe — with one deliberate exception: a hairSTYLE goes in the wardrobe's "hair" slot, while the hair's natural colour, length, and texture stay in the physical description.`;

/**
 * The complete bucket map — the vantage-point preamble plus every other
 * bucket. Use this where a system needs the whole taxonomy at once (e.g. the
 * optimizer's analysis pass, Summon From Lore's extraction) so the model can
 * route each fact to the bucket it belongs to.
 */
export const FULL_FIELD_SEMANTICS = `${FIELD_SEMANTICS_PREAMBLE}

Beyond the vantage-point fields, a character has these further buckets — route content to the right one and never let them bleed into each other:

${PROMPT_SEMANTICS}
${PROPERTIES_SEMANTICS}
${PHYSICAL_DESCRIPTION_SEMANTICS}
${WARDROBE_SEMANTICS}`;
