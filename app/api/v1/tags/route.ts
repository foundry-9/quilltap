/**
 * Tags API v1 - Collection Endpoint
 *
 * GET /api/v1/tags - List all tags or search tags
 * GET /api/v1/tags?search=query - Search tags by name
 * POST /api/v1/tags - Create a new tag
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { created, successResponse } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const createTagSchema = z.object({
  name: z.string().min(1, 'Tag name is required').max(50),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextHandler(async (req: NextRequest, { user, repos }) => {
  const searchParams = req.nextUrl.searchParams;
  const search = searchParams.get('search');

  // Get all tags for the user
  let tags = await repos.tags.findAll();

  // Filter by search if provided
  if (search) {
    const searchLower = search.toLowerCase();
    tags = tags.filter(tag => tag.nameLower.includes(searchLower));
  }

  // Sort by name
  tags.sort((a, b) => a.name.localeCompare(b.name));

  // Get usage counts for each tag across all taggable entity types
  const [allCharacters, allChats, allConnections, allImageProfiles, allEmbeddingProfiles, allFiles] = await Promise.all([
    repos.characters.findAll(),
    repos.chats.findAll(),
    repos.connections.findAll(),
    repos.imageProfiles.findAll(),
    repos.embeddingProfiles.findAll(),
    repos.files.findAll(),
  ]);

  const tagsWithCounts = tags.map(tag => {
    const characterTags = allCharacters.filter(c => c.tags.includes(tag.id)).length;
    const chatTags = allChats.filter(c => c.tags.includes(tag.id)).length;
    const connectionProfileTags = allConnections.filter(c => c.tags.includes(tag.id)).length;
    const imageProfileTags = allImageProfiles.filter(c => c.tags.includes(tag.id)).length;
    const embeddingProfileTags = allEmbeddingProfiles.filter(c => c.tags.includes(tag.id)).length;
    const fileTags = allFiles.filter(c => c.tags.includes(tag.id)).length;

    return {
      id: tag.id,
      name: tag.name,
      quickHide: tag.quickHide,
      visualStyle: tag.visualStyle ?? null,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
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
  });

  return successResponse({
    tags: tagsWithCounts,
    count: tagsWithCounts.length,
  });
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createContextHandler(async (req: NextRequest, { user, repos }) => {
  const body = await req.json();
  const validatedData = createTagSchema.parse(body);

  const nameLower = validatedData.name.toLowerCase();

  // Check if tag already exists (case-insensitive)
  const existingTag = await repos.tags.findByName(user.id, validatedData.name);

  if (existingTag) {// Return existing tag instead of creating duplicate
    return successResponse({ tag: existingTag });
  }

  // Create tag
  const tag = await repos.tags.create({
    userId: user.id,
    name: validatedData.name,
    nameLower,
    quickHide: false,
  });

  logger.info('[Tags v1] Tag created', {
    userId: user.id,
    tagId: tag.id,
    tagName: tag.name,
  });

  return created({ tag });
});
