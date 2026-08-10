/**
 * Projects API v1 - Character Roster Actions
 *
 * GET /api/v1/projects/[id]?action=list-characters - List character roster
 * POST /api/v1/projects/[id]?action=add-character - Add character to roster
 * DELETE /api/v1/projects/[id]?action=remove-character - Remove character from roster
 */

import { NextRequest, NextResponse } from 'next/server';
import { exists } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import { addCharacterSchema, removeCharacterSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * List characters in project roster
 */
export async function handleListCharacters(
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  try {
    const project = await repos.projects.findById(projectId);
    if (!exists(project)) {
      return notFound('Project');
    }

    // Get character details for each in roster
    const characters = await Promise.all(
      project.characterRoster.map(async (charId: string) => {
        const char = await repos.characters.findById(charId);
        if (!char) return null;

        return {
          id: char.id,
          name: char.name,
          tags: char.tags || [],
        };
      })
    );

    return successResponse({
      characters: characters.filter(Boolean),
      count: characters.filter(Boolean).length,
    });
  } catch (error) {
    logger.error('[Projects v1] Error listing project characters', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to list characters');
  }
}

/**
 * Add character to project roster
 */
export async function handleAddCharacter(
  req: NextRequest,
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!exists(project)) {
    return notFound('Project');
  }

  const body = await req.json();
  const { characterId } = addCharacterSchema.parse(body);

  // Check character exists and is owned by user
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Archived characters can't join a roster — but existing roster edges are
  // never removed by archiving, so removal below stays unguarded (spec §5.1).
  if (character.archivedAt) {
    return badRequest('That character is archived; rehydrate them before adding them to a roster.');
  }

  // Add to roster if not already there
  if (!project.characterRoster.includes(characterId)) {
    const updatedRoster = [...project.characterRoster, characterId];
    await repos.projects.update(projectId, { characterRoster: updatedRoster });
  }

  logger.info('[Projects v1] Character added to project', { projectId, characterId });

  return successResponse({ success: true });
}

/**
 * Remove character from project roster
 */
export async function handleRemoveCharacter(
  req: NextRequest,
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!exists(project)) {
    return notFound('Project');
  }

  const body = await req.json();
  const { characterId } = removeCharacterSchema.parse(body);

  // Remove from roster
  const updatedRoster = project.characterRoster.filter((cid: string) => cid !== characterId);
  await repos.projects.update(projectId, { characterRoster: updatedRoster });

  logger.info('[Projects v1] Character removed from project', { projectId, characterId });

  return successResponse({ success: true });
}
