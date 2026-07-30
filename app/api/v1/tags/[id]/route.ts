/**
 * Tags API v1 - Individual Tag Endpoint
 *
 * GET /api/v1/tags/[id] - Get tag details
 * PUT /api/v1/tags/[id] - Update tag
 * DELETE /api/v1/tags/[id] - Delete tag
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, exists } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, successResponse, badRequest } from '@/lib/api/responses';
import { TagVisualStyleSchema } from '@/lib/schemas/common.types';

// ============================================================================
// Schemas
// ============================================================================

const updateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  quickHide: z.boolean().optional(),
  visualStyle: TagVisualStyleSchema.nullable().optional(),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const tag = await repos.tags.findById(id);

  if (!exists(tag)) {
    return notFound('Tag');
  }

  // Get usage counts across all taggable entity types
  const [allCharacters, allChats, allConnections, allImageProfiles, allEmbeddingProfiles, allFiles] = await Promise.all([
    repos.characters.findAll(),
    repos.chats.findAll(),
    repos.connections.findAll(),
    repos.imageProfiles.findAll(),
    repos.embeddingProfiles.findAll(),
    repos.files.findAll(),
  ]);

  const characterTags = allCharacters.filter(c => c.tags.includes(tag.id)).length;
  const chatTags = allChats.filter(c => c.tags.includes(tag.id)).length;
  const connectionProfileTags = allConnections.filter(c => c.tags.includes(tag.id)).length;
  const imageProfileTags = allImageProfiles.filter(c => c.tags.includes(tag.id)).length;
  const embeddingProfileTags = allEmbeddingProfiles.filter(c => c.tags.includes(tag.id)).length;
  const fileTags = allFiles.filter(c => c.tags.includes(tag.id)).length;

  const enrichedTag = {
    ...tag,
    _count: {
      characterTags,
      chatTags,
      connectionProfileTags,
      imageProfileTags,
      embeddingProfileTags,
      fileTags,
    },
    totalUsage: characterTags + chatTags + connectionProfileTags + imageProfileTags + embeddingProfileTags + fileTags,
  };


  return successResponse({ tag: enrichedTag });
});

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createContextParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const existingTag = await repos.tags.findById(id);

  if (!exists(existingTag)) {
    return notFound('Tag');
  }

  const body = await req.json();
  const validatedData = updateTagSchema.parse(body);

  // If name is being changed, ensure it doesn't conflict
  if (validatedData.name && validatedData.name !== existingTag.name) {
    const existingByName = await repos.tags.findByName(user.id, validatedData.name);
    if (existingByName && existingByName.id !== id) {
      return badRequest('A tag with this name already exists');
    }
  }

  // Update - the repository will automatically handle nameLower if name is provided
  const tag = await repos.tags.update(id, validatedData);

  logger.info('[Tags v1] Tag updated', { tagId: id, userId: user.id });

  return successResponse({ tag });
});

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createContextParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const existingTag = await repos.tags.findById(id);

  if (!exists(existingTag)) {
    return notFound('Tag');
  }

  // Remove this tag from all entities that reference it
  const allCharacters = await repos.characters.findAll();
  for (const character of allCharacters) {
    if (character.tags.includes(id)) {
      const updatedTags = character.tags.filter((t: string) => t !== id);
      await repos.characters.update(character.id, { tags: updatedTags });
    }
  }

  const allChats = await repos.chats.findAll();
  for (const chat of allChats) {
    if (chat.tags.includes(id)) {
      const updatedTags = chat.tags.filter((t: string) => t !== id);
      await repos.chats.update(chat.id, { tags: updatedTags });
    }
  }

  const allConnections = await repos.connections.findAll();
  for (const connection of allConnections) {
    if (connection.tags.includes(id)) {
      const updatedTags = connection.tags.filter((t: string) => t !== id);
      await repos.connections.update(connection.id, { tags: updatedTags });
    }
  }

  const allImageProfiles = await repos.imageProfiles.findAll();
  for (const profile of allImageProfiles) {
    if (profile.tags.includes(id)) {
      const updatedTags = profile.tags.filter((t: string) => t !== id);
      await repos.imageProfiles.update(profile.id, { tags: updatedTags });
    }
  }

  const allEmbeddingProfiles = await repos.embeddingProfiles.findAll();
  for (const profile of allEmbeddingProfiles) {
    if (profile.tags.includes(id)) {
      const updatedTags = profile.tags.filter((t: string) => t !== id);
      await repos.embeddingProfiles.update(profile.id, { tags: updatedTags });
    }
  }

  const allFiles = await repos.files.findAll();
  for (const file of allFiles) {
    if (file.tags.includes(id)) {
      const updatedTags = file.tags.filter((t: string) => t !== id);
      await repos.files.update(file.id, { tags: updatedTags });
    }
  }

  // Delete the tag
  await repos.tags.delete(id);

  logger.info('[Tags v1] Tag deleted', { tagId: id, userId: user.id });

  return successResponse({ success: true });
});
