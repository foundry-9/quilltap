/**
 * Groups API v1 - Collection Endpoint
 *
 * GET /api/v1/groups - List all groups
 * POST /api/v1/groups - Create a new group
 */

import { NextRequest } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { created, successResponse } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const createGroupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(2000).nullable().optional(),
  // Standing instructions ("the group prompt") — injected into the system
  // prompt of every member character's turns. Max mirrors GroupSchema.
  instructions: z.string().max(10000).nullable().optional(),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextHandler(async (req: NextRequest, { user, repos }) => {
  let groups = await repos.groups.findAll();

  // Sort by createdAt descending
  groups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Enrich with member counts
  const enrichedGroups = await Promise.all(
    groups.map(async (group) => {
      const members = await repos.groupCharacterMembers.findByGroupId(group.id);
      return {
        ...group,
        _count: {
          members: members.length,
        },
      };
    })
  );

  return successResponse({ groups: enrichedGroups });
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createContextHandler(async (req: NextRequest, { repos }) => {
  const body = await req.json();
  const validatedData = createGroupSchema.parse(body);

  // repos.groups.create provisions the official document store and writes
  // the group properties before returning a fully-hydrated group.
  const group = await repos.groups.create({
    name: validatedData.name,
    description: validatedData.description || null,
    instructions: validatedData.instructions || null,
    color: validatedData.color || null,
    icon: validatedData.icon || null,
    state: {},
  });

  logger.info('[Groups v1] Group created', {
    groupId: group.id,
    name: group.name,
  });

  // create() handles the store; ensure the Scenarios/ and Knowledge/ folders
  // too (it doesn't) so they're usable immediately. Non-fatal — the GET /scenarios
  // endpoint and the startup hook also ensure them.
  try {
    if (group.officialMountPointId) {
      const { ensureGroupScenariosFolder, ensureGroupKnowledgeFolder } = await import('@/lib/mount-index/group-scenarios');
      await ensureGroupScenariosFolder(group.officialMountPointId);
      await ensureGroupKnowledgeFolder(group.officialMountPointId);
    }
  } catch (ensureError) {
    logger.warn('[Groups v1] Failed to ensure group Scenarios/Knowledge folders on create', {
      groupId: group.id,
      error: ensureError instanceof Error ? ensureError.message : String(ensureError),
    });
  }

  return created({ group });
});
