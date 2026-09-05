/**
 * Outfit Selection via Cheap LLM
 *
 * Asks an LLM to choose an appropriate outfit for a character based on
 * their available wardrobe items and the scenario/context. Used during
 * chat initialization when the user selects "Let Character Choose" mode.
 *
 * Follows the same pattern as resolveAppearance() in image-scene-tasks.ts.
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { WardrobeItem, EquippedSlots } from '@/lib/schemas/wardrobe.types'
import { WARDROBE_SLOT_TYPES, makeEmptyEquippedSlots } from '@/lib/schemas/wardrobe.types'
import { stripCodeFences } from '@/lib/llm/llm-json'
import { executeCheapLLMTask } from './core-execution'
import type { CheapLLMTaskResult } from './types'
import { logger } from '@/lib/logger'

const OUTFIT_SELECTION_PROMPT = `You are a wardrobe assistant for a roleplay character. Your job is to choose what a character should wear at the start of a scene, based on:
- The character's available wardrobe items
- The scenario/setting description
- The character's personality
- The character's own dressing instructions, when provided — these describe what the character prefers to wear and under what circumstances; weigh them heavily, above general appropriateness guesses

Choose items that are contextually appropriate. For example, formal wear for a business meeting, casual clothes for relaxing at home, or era-appropriate costume for a historical setting.

You MUST respond with ONLY a JSON object mapping slot names to ARRAYS of wardrobe item IDs. Valid slots are: "top", "bottom", "footwear", "accessories", "hair". Use an empty array [] for any slot you want to leave empty. The "hair" slot holds a hairstyle or hairdo (braided, permed, elegantly coiffed, a wig) — not the hair itself. Leave "hair" empty for the character's natural, unstyled hair.

You may put multiple items in the same slot to layer them (e.g. a t-shirt under a sweater); list them inner-to-outer.

If the available wardrobe contains a composite item (its description mentions it bundles other items, or its title implies an outfit set), you may pick that composite directly — equipping it places it in all the slots it covers.

Example response:
{"top": ["uuid-tshirt", "uuid-sweater"], "bottom": ["uuid-jeans"], "footwear": ["uuid-boots"], "accessories": [], "hair": []}

Wearing nothing at all is a legitimate choice, but you must mark it as a choice. If the character genuinely should be unclothed — a nudist at home, a bath or swim scene, a setting where clothing would be absurd — leave every slot empty AND include "deliberate": true:

{"deliberate": true, "top": [], "bottom": [], "footwear": [], "accessories": [], "hair": []}

Deliberate nudity is about the clothing slots — an unclothed character may still keep a styled hairdo, so fill or empty "hair" on its own merits.

An all-empty response WITHOUT "deliberate": true is read as a failure to choose, and the character will be dressed in their default outfit instead. Do not use the empty response to opt out of the task — if you are unsure, pick something.

Do not include any other text, explanation, or markdown formatting. Just the JSON object.`

/**
 * What the model decided.
 *
 * `deliberatelyUnclothed` separates "the character should be naked" from "the
 * model produced nothing usable" — two states that were previously identical on
 * the wire (all-empty slots) and therefore indistinguishable to the caller.
 */
export interface LLMOutfitChoice {
  slots: EquippedSlots
  /** The model explicitly flagged its empty answer as intentional. */
  deliberatelyUnclothed: boolean
}

/**
 * Ask an LLM to choose an outfit for a character based on context.
 *
 * @param characterName The character's display name
 * @param characterDescription What an interlocutor perceives — behaviour, mannerisms (may be null)
 * @param characterPersonality Internal driver of speech and behaviour (may be null)
 * @param characterManifesto Foundational tenets the character is built on (may be null)
 * @param wardrobeItems Available wardrobe items the LLM can choose from
 * @param scenarioText The scenario or setting for the chat (may be null)
 * @param dressingInstructions Second-person dressing preferences from the
 *   nearest `Wardrobe/instructions.md` in the tier cascade (may be null)
 * @param selection The cheap LLM provider selection to use
 * @param userId User ID for logging
 * @param chatId Chat ID for logging
 * @returns Equipped slots chosen by the LLM, or failure result
 */
export async function chooseLLMOutfit(
  characterName: string,
  characterDescription: string | null,
  characterPersonality: string | null,
  characterManifesto: string | null,
  wardrobeItems: WardrobeItem[],
  scenarioText: string | null,
  dressingInstructions: string | null,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  characterId?: string,
): Promise<CheapLLMTaskResult<LLMOutfitChoice>> {
  if (wardrobeItems.length === 0) {
    return {
      success: true,
      result: {
        slots: makeEmptyEquippedSlots(),
        deliberatelyUnclothed: false,
      },
    }
  }

  // Build wardrobe listing for the LLM. Composite items (those that bundle
  // other wardrobe items) get a marker so the LLM knows they cover their
  // listed slots in one pick.
  const wardrobeSection = wardrobeItems.map(item => {
    const types = item.types.join(', ')
    const appropriateness = item.appropriateness ? ` [appropriate for: ${item.appropriateness}]` : ''
    const desc = item.description ? ` — ${item.description}` : ''
    const componentCount = item.componentItemIds?.length ?? 0
    const compositeMarker = componentCount > 0
      ? ` [composite — bundles ${componentCount} other item${componentCount === 1 ? '' : 's'}]`
      : ''
    return `  - ID: ${item.id} | "${item.title}"${compositeMarker} (covers: ${types})${appropriateness}${desc}`
  }).join('\n')

  const manifestoNote = characterManifesto && characterManifesto.trim().length > 0
    ? `\nCharacter Manifesto (foundational tenets):\n${characterManifesto}`
    : ''

  const descriptionNote = characterDescription && characterDescription.trim().length > 0
    ? `\nCharacter Description (behaviour and mannerisms):\n${characterDescription}`
    : ''

  const personalityNote = characterPersonality && characterPersonality.trim().length > 0
    ? `\nCharacter Personality (internal drivers):\n${characterPersonality}`
    : ''

  const scenarioNote = scenarioText
    ? `\nScenario: ${scenarioText}`
    : '\nScenario: (general conversation, no specific setting)'

  const instructionsNote = dressingInstructions && dressingInstructions.trim().length > 0
    ? `\nDressing Instructions (addressed to ${characterName} in the second person — "you" is ${characterName}):\n${dressingInstructions.trim()}`
    : ''

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: OUTFIT_SELECTION_PROMPT,
    },
    {
      role: 'user',
      content: `Character: ${characterName}${manifestoNote}${descriptionNote}${personalityNote}${scenarioNote}${instructionsNote}

Available Wardrobe Items:
${wardrobeSection}

Choose what ${characterName} should wear for this scene:`,
    },
  ]

  // Build a lookup of item IDs for validation
  const validItemIds = new Set(wardrobeItems.map(item => item.id))
  // Build a lookup of which slots each item covers
  const itemSlotMap = new Map<string, string[]>()
  for (const item of wardrobeItems) {
    itemSlotMap.set(item.id, item.types)
  }

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): LLMOutfitChoice => {
      const cleanContent = stripCodeFences(content)
      const parsed = JSON.parse(cleanContent)

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        logger.warn('[OutfitSelection] LLM returned non-object response, using empty slots', {
          chatId,
          responsePreview: cleanContent.substring(0, 200),
        })
        return {
          slots: makeEmptyEquippedSlots(),
          deliberatelyUnclothed: false,
        }
      }

      // Only an explicit boolean `true` counts. A model that omits the flag, or
      // sends a stringy "true", has not made the deliberate claim — and the
      // fallback (dress them in their defaults) is the safe reading.
      const deliberatelyUnclothed = parsed.deliberate === true

      // Validate and map the response to EquippedSlots. Each slot is an
      // array; we validate each ID, accept it if the wardrobe contains it
      // and the item covers this slot (composites that cover the slot are
      // accepted as-is — equipping them is the "store-as-composite" path),
      // and drop anything else with a debug log.
      const slots: EquippedSlots = makeEmptyEquippedSlots()

      for (const slot of WARDROBE_SLOT_TYPES) {
        const raw = parsed[slot]

        // Tolerate the legacy single-id-or-null shape so older models that
        // miss the array instruction still produce something usable.
        let candidates: unknown[]
        if (Array.isArray(raw)) {
          candidates = raw
        } else if (raw === null || raw === undefined) {
          candidates = []
        } else {
          candidates = [raw]
        }

        for (const candidate of candidates) {
          if (typeof candidate !== 'string') {
            continue
          }
          if (!validItemIds.has(candidate)) {
            continue
          }
          const itemSlots = itemSlotMap.get(candidate)
          if (!itemSlots || !itemSlots.includes(slot)) {
            continue
          }
          // Avoid emitting the same id twice in one slot.
          if (!slots[slot].includes(candidate)) {
            slots[slot].push(candidate)
          }
        }
      }

      return { slots, deliberatelyUnclothed }
    },
    'outfit-selection',
    chatId,
    undefined,
    undefined,
    undefined,
    characterId,
  )
}
