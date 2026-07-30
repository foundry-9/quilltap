/**
 * Characters API v1 - POST Handler
 *
 * POST /api/v1/characters/[id]?action=favorite - Toggle favorite
 * POST /api/v1/characters/[id]?action=avatar - Set avatar
 * POST /api/v1/characters/[id]?action=add-tag - Add tag
 * POST /api/v1/characters/[id]?action=remove-tag - Remove tag
 * POST /api/v1/characters/[id]?action=toggle-controlled-by - Toggle user/LLM control
 * POST /api/v1/characters/[id]?action=set-default-partner - Set default partner
 * POST /api/v1/characters/[id]?action=optimize-stream - Stream character optimization progress
 * POST /api/v1/characters/[id]?action=generate-external-prompt - Generate standalone system prompt
 * POST /api/v1/characters/[id]?action=refresh-archive - Re-render and re-embed all conversations
 * POST /api/v1/characters/[id]?action=rename - Bulk rename/replace across character data, memories, and chats
 */

import { NextRequest, NextResponse } from 'next/server';
import { exists, enrichWithDefaultImage } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { resolveCharacterAvatar } from '@/lib/photos/resolve-character-avatar';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError } from '@/lib/api/responses';
import { runCharacterOptimizer } from '@/lib/services/character-optimizer.service';
import type { OptimizerProgressEvent } from '@/lib/services/character-optimizer.service';
import { generateExternalPrompt } from '@/lib/services/external-prompt-generator.service';
import { enqueueConversationRender } from '@/lib/background-jobs/queue-service';
import { runCharacterRename } from '@/lib/services/character-rename.service';
import type { RequestContext } from '@/lib/api/middleware';

const avatarSchema = z.object({
  imageId: z.string().nullable(),
});

const addTagSchema = z.object({
  tagId: z.uuid(),
});

const removeTagSchema = z.object({
  tagId: z.uuid(),
});

const setDefaultPartnerSchema = z.object({
  partnerId: z.uuid().nullable(),
});

const optimizeStreamSchema = z.object({
  connectionProfileId: z.string().uuid(),
  maxMemories: z.number().int().min(5).max(200).optional().default(30),
  searchQuery: z.string().max(500).optional().default(''),
  useSemanticSearch: z.boolean().optional().default(true),
  sinceDate: z.string().nullable().optional().default(null),
  beforeDate: z.string().nullable().optional().default(null),
  outputMode: z.enum(['apply', 'suggestions-file']).optional().default('apply'),
});

const generateExternalPromptSchema = z.object({
  connectionProfileId: z.string().uuid(),
  systemPromptId: z.string().uuid(),
  scenarioId: z.string().uuid().optional(),
  maxTokens: z.number().int().min(1000).max(20000),
});

const renameReplacementPairSchema = z.object({
  oldValue: z.string().min(1, 'Find value is required'),
  newValue: z.string().min(1, 'Replace value is required'),
  caseSensitive: z.boolean().default(false),
});

const renameSchema = z.object({
  primaryRename: renameReplacementPairSchema.optional(),
  additionalReplacements: z.array(renameReplacementPairSchema).default([]),
  dryRun: z.boolean().default(true),
});

const CHARACTER_POST_ACTIONS = ['favorite', 'avatar', 'add-tag', 'remove-tag', 'toggle-controlled-by', 'toggle-carina', 'set-default-partner', 'optimize-stream', 'generate-external-prompt', 'refresh-archive', 'rename'] as const;
type CharacterPostAction = typeof CHARACTER_POST_ACTIONS[number];

async function handleOptimizeStream(
  req: NextRequest,
  user: RequestContext['user'],
  repos: RequestContext['repos'],
  characterId: string
): Promise<NextResponse> {
  const body = await req.json();
  const { connectionProfileId, maxMemories, searchQuery, useSemanticSearch, sinceDate, beforeDate, outputMode } = optimizeStreamSchema.parse(body);

  logger.info('[Characters v1] Character optimizer starting (streaming)', {
    userId: user.id,
    characterId,
    connectionProfileId,
    maxMemories,
    searchQuery: searchQuery || '(none)',
    useSemanticSearch,
    sinceDate,
    beforeDate,
    outputMode,
  });

  const encoder = new TextEncoder();
  const optimizerOptions = { maxMemories, searchQuery, useSemanticSearch, sinceDate, beforeDate, outputMode };

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (event: OptimizerProgressEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream may be closed
        }
      };

      await runCharacterOptimizer(characterId, connectionProfileId, user.id, repos, enqueue, optimizerOptions);

      try {
        controller.close();
      } catch {
        // Stream may already be closed
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function handlePost(
  req: NextRequest,
  ctx: RequestContext,
  id: string
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const action = getActionParam(req);

  // Verify ownership first
  const character = await repos.characters.findById(id);
  if (!exists(character)) {
    return notFound('Character');
  }

  if (!isValidAction(action, CHARACTER_POST_ACTIONS)) {
    return badRequest(`Unknown action: ${action}. Available actions: ${CHARACTER_POST_ACTIONS.join(', ')}`);
  }

  const actionHandlers: Record<CharacterPostAction, () => Promise<NextResponse>> = {
    favorite: async () => {
      try {
        const updatedCharacter = await repos.characters.setFavorite(id, !character.isFavorite);
        logger.info('[Characters v1] Favorite toggled', {
          characterId: id,
          isFavorite: updatedCharacter?.isFavorite,
        });
        return NextResponse.json({ character: updatedCharacter });
      } catch (error) {
        logger.error('[Characters v1] Error toggling favorite', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to toggle favorite');
      }
    },

    avatar: async () => {
      const body = await req.json();
      const { imageId } = avatarSchema.parse(body);

      // Validate image if provided. Post-Phase-3 imageId is a doc_mount_file_links
      // id pointing into the character's vault `photos/`; the resolver falls back
      // to a legacy `files.id` for pre-migration imports.
      if (imageId) {
        const resolved = await resolveCharacterAvatar(imageId, repos);

        if (!resolved) {
          return notFound('Image file');
        }

        if (resolved.mimeType && !resolved.mimeType.startsWith('image/')) {
          return badRequest(`Invalid file type. Expected an image, got ${resolved.mimeType}`);
        }
      }

      const updatedCharacter = await repos.characters.update(id, {
        defaultImageId: imageId,
      });

      // Build response with file info
      const defaultImage = await enrichWithDefaultImage(updatedCharacter?.defaultImageId, repos);

      logger.info('[Characters v1] Avatar updated', {
        characterId: id,
        newImageId: imageId,
      });

      return NextResponse.json({
        data: {
          ...updatedCharacter,
          defaultImage,
        },
      });
    },

    'add-tag': async () => {
      const body = await req.json();
      const validatedData = addTagSchema.parse(body);

      // Verify tag exists and belongs to user
      const tag = await repos.tags.findById(validatedData.tagId);

      if (!tag) {
        return notFound('Tag');
      }

      await repos.characters.addTag(id, validatedData.tagId);

      logger.info('[Characters v1] Tag added', {
        characterId: id,
        tagId: validatedData.tagId,
      });

      return NextResponse.json({ success: true, tag }, { status: 201 });
    },

    'remove-tag': async () => {
      const body = await req.json();
      const validatedData = removeTagSchema.parse(body);

      await repos.characters.removeTag(id, validatedData.tagId);

      logger.info('[Characters v1] Tag removed', {
        characterId: id,
        tagId: validatedData.tagId,
      });

      return NextResponse.json({ success: true });
    },

    'toggle-controlled-by': async () => {
      try {
        // Toggle the controlledBy property
        const newControlledBy = character.controlledBy === 'user' ? 'llm' : 'user';
        const updatedCharacter = await repos.characters.setControlledBy(id, newControlledBy);

        logger.info('[Characters v1] ControlledBy toggled', { characterId: id, controlledBy: newControlledBy });

        return NextResponse.json({ character: updatedCharacter });
      } catch (error) {
        logger.error('[Characters v1] Error toggling controlledBy', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to toggle controlled-by');
      }
    },

    'toggle-carina': async () => {
      try {
        // Flip Carina (inline @-query answerer) eligibility. canBeCarina is
        // nullable/optional, so a null/undefined current value coerces to true.
        const newCanBeCarina = !character.canBeCarina;
        const updatedCharacter = await repos.characters.setCanBeCarina(id, newCanBeCarina);

        return NextResponse.json({ character: updatedCharacter });
      } catch (error) {
        logger.error('[Characters v1] Error toggling Carina eligibility', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to toggle Carina eligibility');
      }
    },

    'set-default-partner': async () => {
      const body = await req.json();
      const { partnerId } = setDefaultPartnerSchema.parse(body);

      // If partnerId is provided, verify it exists and is user-controlled
      if (partnerId) {
        const partner = await repos.characters.findById(partnerId);
        if (!partner) {
          return notFound('Partner character');
        }
        if (partner.controlledBy !== 'user') {
          return badRequest('Partner must be a user-controlled character');
        }
        if (partnerId === id) {
          return badRequest('Character cannot be its own partner');
        }
      }

      await repos.characters.update(id, {
        defaultPartnerId: partnerId,
      });

      logger.info('[Characters v1] Default partner updated', {
        characterId: id,
        partnerId,
      });

      return NextResponse.json({
        partnerId,
        success: true,
      });
    },

    'optimize-stream': () => handleOptimizeStream(req, user, repos, id),

    'generate-external-prompt': async () => {
      const body = await req.json();
      const validated = generateExternalPromptSchema.parse(body);

      logger.info('[Characters v1] External prompt generation starting', {
        userId: user.id,
        characterId: id,
        connectionProfileId: validated.connectionProfileId,
        maxTokens: validated.maxTokens,
      });

      const result = await generateExternalPrompt(id, validated, user.id, repos);

      if (!result.success) {
        return serverError(result.error || 'Generation failed');
      }

      return NextResponse.json({ prompt: result.prompt, tokensUsed: result.tokensUsed });
    },

    'refresh-archive': async () => {
      try {
        // Find all chats this character participates in
        const chats = await repos.chats.findByCharacterId(id);

        if (chats.length === 0) {
          return NextResponse.json({ queued: 0 });
        }

        let queued = 0;
        for (const chat of chats) {
          try {
            await enqueueConversationRender(user.id, {
              chatId: chat.id,
              fullReembed: true,
            });
            queued++;
          } catch (err) {
            // Skip chats that already have a pending render job
          }
        }

        logger.info('[Characters v1] Conversation archive refresh queued', {
          characterId: id,
          userId: user.id,
          totalChats: chats.length,
          queued,
        });

        return NextResponse.json({ queued, total: chats.length });
      } catch (error) {
        logger.error('[Characters v1] Error refreshing conversation archive', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to refresh conversation archive');
      }
    },

    rename: async () => {
      const body = await req.json();
      const { primaryRename, additionalReplacements, dryRun } = renameSchema.parse(body);

      if (!primaryRename && additionalReplacements.length === 0) {
        return badRequest('At least one replacement must be specified');
      }

      try {
        const result = await runCharacterRename(
          character,
          { primaryRename, additionalReplacements, dryRun },
          user.id,
          repos
        );
        return NextResponse.json(result);
      } catch (error) {
        logger.error('[Characters v1] Error processing rename', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to process rename request');
      }
    },
  };

  return actionHandlers[action]();
}
