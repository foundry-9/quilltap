/**
 * Context-Aware Character Appearance Resolution
 *
 * Orchestrates the resolution of character appearances for image generation
 * by analyzing chat context to determine what each character currently looks
 * like and is wearing. Integrates with the Concierge for safety sanitization.
 *
 * @module image-gen/appearance-resolution
 */

import type { PhysicalDescription } from '@/lib/schemas/types'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types'
import { describeOutfit, buildOutfitSlotValues } from '@/lib/wardrobe/outfit-description'
import { resolveEquippedOutfitForCharacter, type ResolveEquippedRepos } from '@/lib/wardrobe/resolve-equipped'
import { sharedWardrobeTiersForCharacter } from '@/lib/wardrobe/shared-tiers'
import {
  resolveAppearance,
  sanitizeAppearance,
  type ChatMessage,
  type CharacterAppearanceInput,
  type AppearanceResolutionItem,
} from '@/lib/memory/cheap-llm-tasks'
import {
  classifyContent,
} from '@/lib/services/dangerous-content/gatekeeper.service'
import { logger } from '@/lib/logger'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of the appearance resolution pipeline, indicating whether the LLM
 * successfully resolved appearances or fell back to defaults
 */
export interface AppearanceResolutionResult {
  appearances: ResolvedCharacterAppearance[]
  /** Whether the LLM successfully resolved appearances (false = used defaults due to failure/content refusal) */
  llmResolved: boolean
}

/**
 * A fully resolved character appearance ready for image generation
 */
export interface ResolvedCharacterAppearance {
  characterId: string
  characterName: string
  /** Selected physical description text */
  physicalDescription: string
  /** The selected physical description's name (for logging) */
  physicalDescriptionName: string
  /** What the character is currently wearing */
  clothingDescription: string
  /** How clothing was determined */
  clothingSource: 'narrative' | 'stored' | 'default'
  /** Whether the Concierge sanitized this appearance */
  wasSanitized: boolean
}

/**
 * Input for the appearance resolution pipeline
 */
export interface AppearanceResolutionInput {
  characterId: string
  characterName: string
  physicalDescription: PhysicalDescription | null
  /** Equipped wardrobe items (from the wardrobe system) */
  equippedWardrobeItems?: Array<{
    slot: string
    title: string
    description?: string | null
    /** Plain-text image cue; preferred over `title` in image prompts. */
    imagePrompt?: string | null
  }>
}

/** Repository surface for {@link equippedWardrobeItemsForAppearance}. */
interface EquippedWardrobeRepos extends ResolveEquippedRepos {
  chats: {
    getEquippedOutfitForCharacter(chatId: string, characterId: string): Promise<EquippedSlots | null>
  }
}

/**
 * Load a character's equipped outfit for a chat and flatten it into the
 * `equippedWardrobeItems` shape of {@link AppearanceResolutionInput}.
 *
 * Equipped slots are arrays-per-slot and may contain composite items;
 * `resolveEquippedOutfitForCharacter` expands composites and returns per-slot
 * leaf items. Returns `undefined` when the character has nothing equipped.
 * Errors propagate — callers own their catch-and-log.
 */
export async function equippedWardrobeItemsForAppearance(
  repos: EquippedWardrobeRepos,
  chatId: string,
  characterId: string,
  projectMountPointIds: string[] | undefined,
): Promise<AppearanceResolutionInput['equippedWardrobeItems']> {
  const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId)
  if (!equippedSlots) return undefined
  const resolved = await resolveEquippedOutfitForCharacter(
    repos,
    characterId,
    equippedSlots,
    await sharedWardrobeTiersForCharacter(characterId, projectMountPointIds),
  )
  const flat: Array<{ slot: string; title: string; description?: string | null; imagePrompt?: string | null }> = []
  for (const slot of WARDROBE_SLOT_TYPES) {
    for (const item of resolved.leafItemsBySlot[slot]) {
      flat.push({ slot, title: item.title, description: item.description, imagePrompt: item.imagePrompt })
    }
  }
  return flat.length > 0 ? flat : undefined
}

// ============================================================================
// APPEARANCE RESOLUTION
// ============================================================================

/**
 * Check whether we can skip the LLM call and use defaults directly.
 *
 * Skip when ALL characters have exactly 1 physical description, 0-1 clothing
 * records, AND there is no chat context to analyze.
 */
function canSkipResolution(
  characters: AppearanceResolutionInput[],
  recentMessages: ChatMessage[]
): boolean {
  if (recentMessages.length > 0) return false

  return characters.every(
    c => (!c.equippedWardrobeItems || c.equippedWardrobeItems.length <= 1)
  )
}

/**
 * Convert an array of equipped wardrobe items into OutfitSlotValues for use
 * with the canonical describeOutfit utility. The input is expected to already
 * be flattened to leaves (callers expand composites before passing in).
 *
 * Multiple entries with the same `slot` represent layering and produce
 * multiple values in that slot's array, in the order they appear.
 *
 * Titles only — image-gen prompts must not carry the prose `description`
 * field, which is written for human eyes and otherwise bloats the prompt.
 */
function wardrobeItemsToSlotValues(
  items: Array<{ slot: string; title: string; description?: string | null; imagePrompt?: string | null }>
): import('@/lib/wardrobe/outfit-description').OutfitSlotValues {
  return buildOutfitSlotValues((slot) =>
    items
      .filter(i => i.slot === slot)
      .map(i => (i.imagePrompt?.trim() ? i.imagePrompt.trim() : i.title)),
  )
}

/**
 * Build default resolved appearances without an LLM call
 */
function buildDefaultAppearances(
  characters: AppearanceResolutionInput[]
): ResolvedCharacterAppearance[] {
  return characters.map(char => {
    const primary = char.physicalDescription

    const physDesc =
      primary?.completePrompt ||
      primary?.longPrompt ||
      primary?.mediumPrompt ||
      primary?.shortPrompt ||
      char.characterName

    const hasWardrobe = char.equippedWardrobeItems && char.equippedWardrobeItems.length > 0

    return {
      characterId: char.characterId,
      characterName: char.characterName,
      physicalDescription: physDesc,
      physicalDescriptionName: primary?.name || 'default',
      clothingDescription: hasWardrobe
        ? describeOutfit(wardrobeItemsToSlotValues(char.equippedWardrobeItems!))
        : '',
      clothingSource: hasWardrobe
        ? 'stored' as const
        : 'default' as const,
      wasSanitized: false,
    }
  })
}

/**
 * Convert an LLM resolution result back into full ResolvedCharacterAppearance
 * objects by matching IDs against the original character data.
 */
function mapResolutionResults(
  characters: AppearanceResolutionInput[],
  items: AppearanceResolutionItem[]
): ResolvedCharacterAppearance[] {
  return characters.map(char => {
    const resolved = items.find(i => i.characterId === char.characterId)

    // Only one physical description per character now; the resolver's
    // selectedDescriptionId is informational only.
    const selectedDesc: PhysicalDescription | null = char.physicalDescription

    const physDesc = selectedDesc
      ? (selectedDesc.completePrompt ||
         selectedDesc.longPrompt ||
         selectedDesc.mediumPrompt ||
         selectedDesc.shortPrompt ||
         char.characterName)
      : char.characterName

    return {
      characterId: char.characterId,
      characterName: char.characterName,
      physicalDescription: physDesc,
      physicalDescriptionName: selectedDesc?.name || 'default',
      clothingDescription: resolved?.clothingDescription || '',
      clothingSource: resolved?.clothingSource || 'default',
      wasSanitized: false,
    }
  })
}

/**
 * Resolve character appearances based on chat context.
 *
 * Analyzes recent chat messages and the image prompt to determine the best
 * physical description and current clothing for each character. Falls back
 * to defaults if the LLM call fails or is unnecessary.
 *
 * @param characters - Characters with available descriptions and clothing
 * @param recentMessages - Recent chat messages for narrative context
 * @param imagePrompt - The image prompt being generated
 * @param cheapLLMSelection - The cheap LLM provider to use
 * @param userId - Current user ID
 * @param chatId - Optional chat ID for logging
 * @param sceneState - Optional scene state with appearance data (avoids redundant LLM call)
 * @returns Resolution result with appearances and whether the LLM succeeded
 */
export async function resolveCharacterAppearances(
  characters: AppearanceResolutionInput[],
  recentMessages: ChatMessage[],
  imagePrompt: string,
  cheapLLMSelection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  sceneState?: { characters: Array<{ characterId: string; characterName: string; appearance: string | null; clothing: string | null }> } | null
): Promise<AppearanceResolutionResult> {
  if (characters.length === 0) {
    return { appearances: [], llmResolved: true }
  }

  // Shortcut: use scene state appearances if provided (avoids redundant LLM call)
  if (sceneState?.characters && sceneState.characters.length > 0) {
    const sceneAppearances: ResolvedCharacterAppearance[] = characters.map(char => {
      const sceneChar = sceneState.characters.find(sc => sc.characterId === char.characterId)
      const primary = char.physicalDescription
      const physDesc = sceneChar?.appearance
        || primary?.completePrompt || primary?.longPrompt || primary?.mediumPrompt || primary?.shortPrompt
        || char.characterName

      return {
        characterId: char.characterId,
        characterName: char.characterName,
        physicalDescription: physDesc,
        physicalDescriptionName: primary?.name || 'scene-state',
        // If scene state has clothing info, use it. If clothing is explicitly null/empty
        // (e.g. character undressed), do NOT fall back — that would incorrectly redress.
        // If the character wasn't found in scene state at all, leave clothing empty.
        clothingDescription: sceneChar
          ? (sceneChar.clothing || '')
          : '',
        clothingSource: sceneChar ? 'narrative' as const : 'default' as const,
        wasSanitized: false,
      }
    })

    logger.info('[AppearanceResolution] Using scene state for character appearances', {
      context: 'image-gen.appearance-resolution',
      chatId,
      characterCount: sceneAppearances.length,
    })

    return { appearances: sceneAppearances, llmResolved: true }
  }

  // Skip optimization: no LLM call needed when context is trivial
  if (canSkipResolution(characters, recentMessages)) {
    return { appearances: buildDefaultAppearances(characters), llmResolved: true }
  }

  // Build the LLM input
  const llmInput: CharacterAppearanceInput[] = characters.map(char => ({
    characterId: char.characterId,
    characterName: char.characterName,
    physicalDescriptions: char.physicalDescription
      ? [{
          id: char.physicalDescription.id,
          name: char.physicalDescription.name,
          usageContext: char.physicalDescription.usageContext,
          shortPrompt: char.physicalDescription.shortPrompt,
          mediumPrompt: char.physicalDescription.mediumPrompt,
        }]
      : [],
    ...(char.equippedWardrobeItems && char.equippedWardrobeItems.length > 0
      ? { equippedWardrobeItems: char.equippedWardrobeItems }
      : {}),
  }))

  const result = await resolveAppearance(
    llmInput,
    recentMessages,
    imagePrompt,
    cheapLLMSelection,
    userId,
    chatId
  )

  if (!result.success || !result.result || result.result.length === 0) {
    logger.warn('[AppearanceResolution] LLM resolution failed or returned empty, falling back to defaults', {
      context: 'image-gen.appearance-resolution',
      error: result.error,
      emptyResult: result.success && (!result.result || result.result.length === 0),
      chatId,
    })
    return { appearances: buildDefaultAppearances(characters), llmResolved: false }
  }

  const resolved = mapResolutionResults(characters, result.result)

  return { appearances: resolved, llmResolved: true }
}

// ============================================================================
// CONCIERGE APPEARANCE SANITIZATION
// ============================================================================

/**
 * Sanitize resolved appearances through the Concierge if needed.
 *
 * Logic:
 * 1. If the Concierge mode is OFF → return unchanged
 * 2. If chat is marked dangerous AND an uncensored image provider exists → return unchanged
 * 3. Classify concatenated appearance text; if safe → return unchanged
 * 4. If dangerous AND uncensored provider available → return unchanged (will route there)
 * 5. If dangerous AND NO uncensored provider → sanitize via cheap LLM
 *
 * @param appearances - Resolved character appearances
 * @param dangerSettings - the Concierge settings
 * @param isDangerousChat - Whether the chat is marked as dangerous
 * @param hasUncensoredImageProvider - Whether an uncensored image provider is available
 * @param cheapLLMSelection - Cheap LLM provider for classification/sanitization
 * @param userId - Current user ID
 * @param chatId - Optional chat ID for logging
 * @returns Possibly-sanitized appearances (same array reference if unchanged)
 */
export async function sanitizeAppearancesIfNeeded(
  appearances: ResolvedCharacterAppearance[],
  dangerSettings: DangerousContentSettings,
  isDangerousChat: boolean,
  hasUncensoredImageProvider: boolean,
  cheapLLMSelection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<ResolvedCharacterAppearance[]> {
  // 1. The Concierge off → pass through
  if (dangerSettings.mode === 'OFF') {
    return appearances
  }

  // 2. Dangerous chat with uncensored provider → accurate appearances are fine
  if (isDangerousChat && hasUncensoredImageProvider) {
    return appearances
  }

  // 3. Classify concatenated appearance text
  const combinedText = appearances
    .map(a => `${a.physicalDescription} ${a.clothingDescription}`)
    .join(' | ')

  let classification
  try {
    classification = await classifyContent(
      combinedText,
      cheapLLMSelection,
      userId,
      dangerSettings,
      chatId
    )
  } catch (error) {
    // Fail safe — never block
    logger.error('[AppearanceResolution] Appearance classification failed, passing through', {
      context: 'image-gen.appearance-resolution',
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
    return appearances
  }

  // Not dangerous → pass through
  if (!classification.isDangerous) {
    return appearances
  }

  logger.info('[AppearanceResolution] Appearance text classified as dangerous', {
    context: 'image-gen.appearance-resolution',
    chatId,
    score: classification.score,
    categories: classification.categories.map(c => c.category),
    hasUncensoredImageProvider,
  })

  // 4. Dangerous but uncensored provider available → will be routed there
  if (hasUncensoredImageProvider) {
    return appearances
  }

  // 5. Dangerous with NO uncensored provider → sanitize
  logger.info('[AppearanceResolution] Sanitizing dangerous appearance descriptions', {
    context: 'image-gen.appearance-resolution',
    chatId,
    characterCount: appearances.length,
  })

  const toSanitize = appearances.map(a => ({
    characterId: a.characterId,
    appearanceText: `${a.physicalDescription}. ${a.clothingDescription}`.trim(),
  }))

  const sanitizeResult = await sanitizeAppearance(
    toSanitize,
    cheapLLMSelection,
    userId,
    chatId
  )

  if (!sanitizeResult.success || !sanitizeResult.result) {
    logger.warn('[AppearanceResolution] Sanitization failed, passing through original', {
      context: 'image-gen.appearance-resolution',
      chatId,
      error: sanitizeResult.error,
    })
    return appearances
  }

  // Merge sanitized text back into appearances
  return appearances.map(appearance => {
    const sanitized = sanitizeResult.result!.find(
      s => s.characterId === appearance.characterId
    )
    if (sanitized && sanitized.appearanceText !== `${appearance.physicalDescription}. ${appearance.clothingDescription}`.trim()) {
      return {
        ...appearance,
        // Use sanitized text as both physical + clothing combined
        physicalDescription: sanitized.appearanceText,
        clothingDescription: '',
        wasSanitized: true,
      }
    }
    return appearance
  })
}
