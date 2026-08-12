/**
 * Character System Prompts API v1
 *
 * GET /api/v1/characters/[id]/prompts - Get all system prompts for a character
 * POST /api/v1/characters/[id]/prompts - Add a new system prompt to a character
 */

import { z } from 'zod';
import { createContextParamsHandler, exists } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, serverError, created, successResponse } from '@/lib/api/responses';

const createPromptSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  isDefault: z.boolean().optional().prefault(false),
});

// GET /api/v1/characters/[id]/prompts
export const GET = createContextParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: characterId }) => {
    try {

      const character = await repos.characters.findById(characterId);

      if (!exists(character)) {
        return notFound('Character');
      }

      const prompts = character.systemPrompts || [];return successResponse({ prompts });
    } catch (error) {
      logger.error('[Characters v1] Error fetching character prompts', { characterId }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch character prompts');
    }
  }
);

// POST /api/v1/characters/[id]/prompts
export const POST = createContextParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: characterId }) => {
    const body = await request.json();
    const validated = createPromptSchema.parse(body);// First verify the character exists and belongs to the user
    const character = await repos.characters.findById(characterId);

    if (!exists(character)) {
      return notFound('Character');
    }

    const prompt = await repos.characters.addSystemPrompt(characterId, {
      name: validated.name,
      content: validated.content,
      isDefault: validated.isDefault,
    });

    if (!prompt) {
      logger.error('[Characters v1] Failed to add system prompt to character', {
        characterId,
        userId: user.id,
      });
      return serverError('Failed to add system prompt');
    }

    logger.info('[Characters v1] System prompt added to character', {
      characterId,
      userId: user.id,
      promptId: prompt.id,
      promptName: validated.name,
    });

    return created({ prompt });
  }
);
