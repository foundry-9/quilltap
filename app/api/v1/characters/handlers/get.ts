/**
 * Characters API v1 - GET Handler
 *
 * GET /api/v1/characters - List all characters
 */

import { NextRequest, NextResponse } from 'next/server';
import { enrichWithDefaultImage } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { serverError } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';

export async function handleGet(
  req: NextRequest,
  ctx: RequestContext
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {
    let characters = await repos.characters.findByUserId(user.id);

    const { searchParams } = req.nextUrl;

    // Filter by NPC status
    const npcFilter = searchParams.get('npc');
    if (npcFilter === 'true') {
      characters = characters.filter((c) => c.npc === true);
    } else if (npcFilter === 'false') {
      characters = characters.filter((c) => !c.npc);
    }

    // Filter by controlledBy
    const controlledByFilter = searchParams.get('controlledBy');
    if (controlledByFilter === 'user') {
      characters = characters.filter((c) => c.controlledBy === 'user');
    } else if (controlledByFilter === 'llm') {
      characters = characters.filter((c) => c.controlledBy === 'llm' || c.controlledBy === undefined);
    }

    // Sort by createdAt descending
    characters.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Enrich characters
    const enrichedCharacters = await Promise.all(
      characters.map(async (character) => {
        const defaultImage = await enrichWithDefaultImage(character.defaultImageId, repos);

        let defaultPartnerName: string | null = null;
        if (character.defaultPartnerId) {
          const partner = await repos.characters.findById(character.defaultPartnerId);
          if (partner) {
            defaultPartnerName = partner.name;
          }
        }

        const chats = await repos.chats.findByCharacterId(character.id);

        return {
          id: character.id,
          name: character.name,
          title: character.title,
          description: character.description,
          defaultImageId: character.defaultImageId,
          defaultImage,
          isFavorite: character.isFavorite,
          controlledBy: character.controlledBy ?? 'llm',
          canBeCarina: character.canBeCarina ?? false,
          canChooseOutfit: character.canChooseOutfit ?? false,
          defaultConnectionProfileId: character.defaultConnectionProfileId || null,
          defaultPartnerId: character.defaultPartnerId || null,
          defaultPartnerName,
          defaultTimestampConfig: character.defaultTimestampConfig || null,
          defaultScenarioId: character.defaultScenarioId || null,
          defaultSystemPromptId: character.defaultSystemPromptId || null,
          defaultImageProfileId: character.defaultImageProfileId || null,
          npc: character.npc ?? false,
          createdAt: character.createdAt,
          tags: character.tags || [],
          updatedAt: character.updatedAt,
          systemPrompts: (character.systemPrompts || []).map(p => ({
            id: p.id,
            name: p.name,
            isDefault: p.isDefault,
          })),
          scenarios: (character.scenarios || []).map(s => ({
            id: s.id,
            title: s.title,
            content: s.content,
          })),
          _count: {
            chats: chats.length,
          },
        };
      })
    );

    return NextResponse.json({
      characters: enrichedCharacters,
      count: enrichedCharacters.length,
    });
  } catch (error) {
    logger.error('[Characters v1] Error listing characters', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch characters');
  }
}
