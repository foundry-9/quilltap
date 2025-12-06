/**
 * Image Prompt Expansion Utilities
 *
 * Handles parsing of placeholders like {{CharacterName}} or {{me}} in image generation prompts
 * and retrieves appropriate physical descriptions from the database.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { PhysicalDescription, ImageProvider } from '@/lib/schemas/types';

/**
 * Placeholder information extracted from a prompt
 */
export interface PlaceholderInfo {
  /** Original placeholder text (e.g., "{{Mirel}}") */
  placeholder: string;
  /** Entity name (e.g., "Mirel") */
  name: string;
  /** Entity type (character, persona, or user) */
  type: 'character' | 'persona' | 'user';
  /** Entity ID if found */
  entityId?: string;
  /** All available physical descriptions for this entity */
  descriptions?: PhysicalDescription[];
}

/**
 * Provider-specific character limits for image prompts
 */
const PROVIDER_LIMITS: Record<ImageProvider, number> = {
  OPENAI: 4000,           // DALL-E 3
  GROK: 700,              // Grok (conservative estimate)
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

  for (const { placeholder, name } of placeholders) {
    const lowerName = name.toLowerCase();

    // Check if it's the caller (me/I)
    if (lowerName === 'me' || lowerName === 'i' || lowerName === 'user') {
      let descriptions: PhysicalDescription[] = [];
      let entityId: string | undefined;
      let entityType: 'character' | 'persona' | 'user' = 'user';

      // If we have a calling participant, use that
      if (callingParticipantId && chatId) {
        const chat = await repos.chats.findById(chatId);
        if (chat) {
          const participant = chat.participants.find(p => p.id === callingParticipantId);
          if (participant) {
            if (participant.type === 'CHARACTER' && participant.characterId) {
              const character = await repos.characters.findById(participant.characterId);
              if (character) {
                descriptions = character.physicalDescriptions || [];
                entityId = character.id;
                entityType = 'character';
              }
            } else if (participant.type === 'PERSONA' && participant.personaId) {
              const persona = await repos.personas.findById(participant.personaId);
              if (persona) {
                descriptions = persona.physicalDescriptions || [];
                entityId = persona.id;
                entityType = 'persona';
              }
            }
          }
        }
      } else if (chatId) {
        // Fall back to user's persona from chat context
        const chat = await repos.chats.findById(chatId);
        if (chat) {
          const personaParticipant = chat.participants.find(p => p.type === 'PERSONA');
          if (personaParticipant?.personaId) {
            const persona = await repos.personas.findById(personaParticipant.personaId);
            if (persona) {
              descriptions = persona.physicalDescriptions || [];
              entityId = persona.id;
              entityType = 'persona';
            }
          }
        }
      }

      resolved.push({
        placeholder,
        name,
        type: entityType,
        entityId,
        descriptions,
      });
      continue;
    }

    // Try to find a character by name
    const characters = await repos.characters.findByUserId(userId);
    const character = characters.find(c => c.name.toLowerCase() === lowerName);

    if (character) {
      resolved.push({
        placeholder,
        name: character.name,
        type: 'character',
        entityId: character.id,
        descriptions: character.physicalDescriptions || [],
      });
      continue;
    }

    // Try to find a persona by name
    const personas = await repos.personas.findByUserId(userId);
    const persona = personas.find(p => p.name.toLowerCase() === lowerName);

    if (persona) {
      resolved.push({
        placeholder,
        name: persona.name,
        type: 'persona',
        entityId: persona.id,
        descriptions: persona.physicalDescriptions || [],
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
  };
}

/**
 * Calculate available space for descriptions in a prompt
 *
 * @param basePrompt - The original prompt with placeholders
 * @param placeholderCount - Number of placeholders to substitute
 * @param provider - Image generation provider
 * @returns Available characters per placeholder (approximate)
 */
export function calculateAvailableSpace(
  basePrompt: string,
  placeholderCount: number,
  provider: ImageProvider
): number {
  const limit = PROVIDER_LIMITS[provider];

  // Remove placeholders from the base prompt to get actual text length
  const promptWithoutPlaceholders = basePrompt.replace(/\{\{[^}]+\}\}/g, '');
  const baseLength = promptWithoutPlaceholders.length;

  // Reserve some space for LLM-added connectors/formatting (20% buffer)
  const reservedSpace = Math.ceil(limit * 0.2);

  // Calculate space available for all descriptions
  const availableForDescriptions = limit - baseLength - reservedSpace;

  // Divide equally among placeholders
  const perPlaceholder = Math.floor(availableForDescriptions / placeholderCount);

  // Ensure minimum of 50 characters per placeholder
  return Math.max(50, perPlaceholder);
}

/**
 * Build context for cheap LLM prompt crafting
 *
 * @param originalPrompt - Original prompt with placeholders
 * @param resolvedPlaceholders - Resolved placeholder information
 * @param provider - Target image generation provider
 * @returns Context object for cheap LLM
 */
export function buildExpansionContext(
  originalPrompt: string,
  resolvedPlaceholders: PlaceholderInfo[],
  provider: ImageProvider
): {
  originalPrompt: string;
  placeholders: Array<{
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
} {
  const placeholderData = resolvedPlaceholders.map(placeholder => {
    const tiers = getAllDescriptionTiers(placeholder.descriptions || []);

    return {
      placeholder: placeholder.placeholder,
      name: placeholder.name,
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
