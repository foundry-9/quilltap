/**
 * Image Prompt Expansion Utilities
 *
 * Handles parsing of placeholders like {{CharacterName}} or {{me}} in image generation prompts
 * and retrieves appropriate physical descriptions from the database.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { PhysicalDescription, ImageProvider } from '@/lib/schemas/types';
import type { Pronouns } from '@/lib/schemas/character.types';
import { genderFromPronouns } from '@/lib/characters/pronoun-gender';
import type { ResolvedCharacterAppearance } from '@/lib/image-gen/appearance-resolution';

/**
 * Placeholder information extracted from a prompt
 */
export interface PlaceholderInfo {
  /** Original placeholder text (e.g., "{{Mirel}}") */
  placeholder: string;
  /** Entity name (e.g., "Mirel") */
  name: string;
  /** Entity type - 'character' for all characters (LLM or user-controlled), 'user' for unknown/default */
  type: 'character' | 'user';
  /** Entity ID if found */
  entityId?: string;
  /** All available physical descriptions for this entity */
  descriptions?: PhysicalDescription[];
  /** Character pronouns (for gender hints in image prompts) */
  pronouns?: Pronouns | null;
}

/**
 * Provider-specific character limits for image prompts
 */
const PROVIDER_LIMITS: Record<ImageProvider, number> = {
  OPENAI: 4000,           // DALL-E 3
  GROK: 1000,             // Grok
  GOOGLE_IMAGEN: 1920,    // ~480 tokens at 4 chars/token
};

/**
 * Parse placeholders from an image prompt
 * Supports {{name}} syntax
 *
 * @param prompt - The prompt containing placeholders
 * @returns Array of placeholder information
 */
export function parsePlaceholders(prompt: string): Array<{ placeholder: string; name: string }> {
  const placeholderRegex = /\{\{([^}]+)\}\}/g;
  const placeholders: Array<{ placeholder: string; name: string }> = [];

  let match;
  while ((match = placeholderRegex.exec(prompt)) !== null) {
    placeholders.push({
      placeholder: match[0],  // Full match: {{Mirel}}
      name: match[1].trim(),  // Captured group: Mirel
    });
  }

  return placeholders;
}

/**
 * Resolve placeholders to entity information
 *
 * @param placeholders - Parsed placeholders
 * @param userId - Current user ID
 * @param chatId - Optional chat ID for context
 * @param callingParticipantId - Optional participant ID of who's calling the tool (for {{me}}/{{I}})
 * @returns Array of resolved placeholder info
 */
export async function resolvePlaceholders(
  placeholders: Array<{ placeholder: string; name: string }>,
  userId: string,
  chatId?: string,
  callingParticipantId?: string
): Promise<PlaceholderInfo[]> {
  const repos = getRepositories();
  const resolved: PlaceholderInfo[] = [];

  // Pre-fetch chat data if we have a chatId
  let chat: Awaited<ReturnType<typeof repos.chats.findById>> | null = null;
  if (chatId) {
    chat = await repos.chats.findById(chatId);
  }

  for (const { placeholder, name } of placeholders) {
    const lowerName = name.toLowerCase();

    // {{me}}, {{I}}, or {{char}} = the caller (character when assistant calls, user-controlled character when user calls)
    if (lowerName === 'me' || lowerName === 'i' || lowerName === 'char') {
      let descriptions: PhysicalDescription[] = [];
      let entityId: string | undefined;
      let entityType: 'character' | 'user' = 'user';
      let resolvedName = name;
      let pronouns: Pronouns | null = null;

      // If we have a calling participant, use that
      if (callingParticipantId && chat) {
        const participant = chat.participants.find(p => p.id === callingParticipantId);
        if (participant) {
          // All participants are CHARACTER type
          const characterId = participant.characterId;
          if (characterId) {
            const character = await repos.characters.findById(characterId);
            if (character) {
              descriptions = character.physicalDescription ? [character.physicalDescription] : [];
              entityId = character.id;
              entityType = 'character';
              resolvedName = character.name;
              pronouns = character.pronouns ?? null;
            }
          }
        }
      } else if (chat) {
        // No calling participant specified - fall back to first character (likely assistant-initiated)
        const characterParticipant = chat.participants.find(p => p.type === 'CHARACTER');
        if (characterParticipant?.characterId) {
          const character = await repos.characters.findById(characterParticipant.characterId);
          if (character) {
            descriptions = character.physicalDescription ? [character.physicalDescription] : [];
            entityId = character.id;
            entityType = 'character';
            resolvedName = character.name;
            pronouns = character.pronouns ?? null;
          }
        }
      }

      resolved.push({
        placeholder,
        name: resolvedName,
        type: entityType,
        entityId,
        descriptions,
        pronouns,
      });
      continue;
    }

    // {{user}} = the OTHER participant (user-controlled character when LLM calls, LLM character when user calls)
    if (lowerName === 'user') {
      let descriptions: PhysicalDescription[] = [];
      let entityId: string | undefined;
      let entityType: 'character' | 'user' = 'character';
      let resolvedName = name;
      let pronouns: Pronouns | null = null;

      if (chat) {
        // Find the "other" participant - the one with different controlledBy or the user-controlled one
        // After migration, all participants are CHARACTER type with controlledBy: 'llm' or 'user'
        let otherParticipant = null;

        if (callingParticipantId) {
          const callerParticipant = chat.participants.find(p => p.id === callingParticipantId);
          if (callerParticipant) {
            // If caller is LLM-controlled, find user-controlled participant
            // If caller is user-controlled, find LLM-controlled participant
            const callerIsUserControlled = callerParticipant.controlledBy === 'user';
            otherParticipant = chat.participants.find(p =>
              p.id !== callingParticipantId &&
              (callerIsUserControlled
                ? (p.controlledBy === 'llm' || p.controlledBy === undefined)
                : p.controlledBy === 'user')
            );
          }
        }

        // If no caller specified, find the first user-controlled participant
        if (!otherParticipant) {
          otherParticipant = chat.participants.find(p =>
            p.controlledBy === 'user'
          );
        }

        if (otherParticipant) {
          // All participants are characters
          const characterId = otherParticipant.characterId;
          if (characterId) {
            const character = await repos.characters.findById(characterId);
            if (character) {
              descriptions = character.physicalDescription ? [character.physicalDescription] : [];
              entityId = character.id;
              entityType = 'character';
              resolvedName = character.name;
              pronouns = character.pronouns ?? null;
            }
          }
        }
      }

      resolved.push({
        placeholder,
        name: resolvedName,
        type: entityType,
        entityId,
        descriptions,
        pronouns,
      });
      continue;
    }

    // Try to find a character by name or alias (includes former personas which are now characters with controlledBy: 'user')
    const characters = await repos.characters.findByUserId(userId);
    const character = characters.find(c =>
      c.name.toLowerCase() === lowerName ||
      (c.aliases && c.aliases.some(alias => alias.toLowerCase() === lowerName))
    );

    if (character) {
      resolved.push({
        placeholder,
        name: character.name,
        type: 'character',
        entityId: character.id,
        descriptions: character.physicalDescription ? [character.physicalDescription] : [],
        pronouns: character.pronouns ?? null,
      });
      continue;
    }

    // Placeholder not found - include with no descriptions
    resolved.push({
      placeholder,
      name,
      type: 'character', // Default to character type
      descriptions: [],
    });
  }

  return resolved;
}

/**
 * Get all available description tiers for an entity
 *
 * @param descriptions - Available physical descriptions for an entity
 * @returns Object with all available description tiers
 */
export function getAllDescriptionTiers(
  descriptions: PhysicalDescription[]
): {
  short?: string;
  medium?: string;
  long?: string;
  complete?: string;
  entityName?: string;
  usageContext?: string;
} | null {
  if (!descriptions || descriptions.length === 0) {
    return null;
  }

  // Use the first/primary description
  const primary = descriptions[0];

  return {
    short: primary.shortPrompt || undefined,
    medium: primary.mediumPrompt || undefined,
    long: primary.longPrompt || undefined,
    complete: primary.completePrompt || undefined,
    entityName: primary.name,
    usageContext: primary.usageContext || undefined,
  };
}

/**
 * Build context for cheap LLM prompt crafting
 *
 * @param originalPrompt - Original prompt with placeholders
 * @param resolvedPlaceholders - Resolved placeholder information
 * @param provider - Target image generation provider
 * @param resolvedAppearances - Optional context-aware resolved appearances that override raw descriptions
 * @returns Context object for cheap LLM
 */
export function buildExpansionContext(
  originalPrompt: string,
  resolvedPlaceholders: PlaceholderInfo[],
  provider: ImageProvider,
  resolvedAppearances?: ResolvedCharacterAppearance[]
): {
  originalPrompt: string;
  placeholders: Array<{
    placeholder: string;
    name: string;
    gender?: string;
    usageContext?: string;
    tiers: {
      short?: string;
      medium?: string;
      long?: string;
      complete?: string;
    };
    clothing?: Array<{
      name: string;
      usageContext?: string | null;
      description?: string | null;
    }>;
  }>;
  targetLength: number;
  provider: string;
} {
  const placeholderData = resolvedPlaceholders.map(placeholder => {
    // Derive gender hint from standard pronouns
    const gender: string | undefined = genderFromPronouns(placeholder.pronouns) ?? undefined;

    // Check if we have a resolved appearance for this character
    const resolved = resolvedAppearances?.find(
      a => a.characterId === placeholder.entityId
    );

    if (resolved) {
      // Use the single resolved appearance instead of all tiers/clothing
      return {
        placeholder: placeholder.placeholder,
        name: placeholder.name,
        gender,
        usageContext: resolved.physicalDescriptionName,
        tiers: {
          // Put the resolved description in the 'complete' tier so the
          // prompt crafter uses it directly
          complete: resolved.physicalDescription,
        },
        ...(resolved.clothingDescription ? {
          clothing: [{
            name: resolved.clothingSource === 'narrative' ? 'Current outfit (from story)' : 'Current outfit',
            usageContext: null as string | null,
            description: resolved.clothingDescription as string | null,
          }],
        } : {}),
      };
    }

    // No resolved appearance — fall back to raw description data
    const tiers = getAllDescriptionTiers(placeholder.descriptions || []);

    return {
      placeholder: placeholder.placeholder,
      name: placeholder.name,
      gender,
      usageContext: tiers?.usageContext,
      tiers: {
        short: tiers?.short,
        medium: tiers?.medium,
        long: tiers?.long,
        complete: tiers?.complete,
      },
    };
  });

  return {
    originalPrompt,
    placeholders: placeholderData,
    targetLength: PROVIDER_LIMITS[provider],
    provider,
  };
}

/**
 * Main function to expand a prompt with placeholders
 * This prepares the data needed for the cheap LLM to craft the final prompt
 *
 * @param prompt - Original prompt with placeholders
 * @param userId - Current user ID
 * @param provider - Target image generation provider
 * @param chatId - Optional chat ID for context
 * @param callingParticipantId - Optional participant ID of who's calling the tool
 * @returns Expansion context for cheap LLM
 */
export async function preparePromptExpansion(
  prompt: string,
  userId: string,
  provider: ImageProvider,
  chatId?: string,
  callingParticipantId?: string
): Promise<{
  hasPlaceholders: boolean;
  originalPrompt: string;
  placeholders?: Array<{
    placeholder: string;
    name: string;
    tiers: {
      short?: string;
      medium?: string;
      long?: string;
      complete?: string;
    };
  }>;
  targetLength: number;
  provider: string;
}> {
  const placeholders = parsePlaceholders(prompt);

  if (placeholders.length === 0) {
    return {
      hasPlaceholders: false,
      originalPrompt: prompt,
      targetLength: PROVIDER_LIMITS[provider],
      provider,
    };
  }

  const resolved = await resolvePlaceholders(placeholders, userId, chatId, callingParticipantId);
  const context = buildExpansionContext(prompt, resolved, provider);

  return {
    hasPlaceholders: true,
    ...context,
  };
}
