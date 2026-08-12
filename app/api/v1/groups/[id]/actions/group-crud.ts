/**
 * Groups API v1 - Group CRUD Actions
 *
 * GET /api/v1/groups/[id] - Get group details (default)
 * GET /api/v1/groups/[id]?action=members - Get group members
 * PUT /api/v1/groups/[id] - Update group (default)
 * DELETE /api/v1/groups/[id] - Delete group (default)
 * POST /api/v1/groups/[id]?action=addMember - Add member
 * DELETE /api/v1/groups/[id]?action=removeMember - Remove member
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, successResponse, badRequest } from '@/lib/api/responses';
import { updateGroupSchema, addMemberSchema, removeMemberSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Get group details with enriched member count
 */
export async function handleGetDefault(
  groupId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  const group = await repos.groups.findById(groupId);

  if (!group) {
    return notFound('Group');
  }

  const members = await repos.groupCharacterMembers.findByGroupId(groupId);

  const enrichedGroup = {
    ...group,
    _count: {
      members: members.length,
    },
  };

  return successResponse({ group: enrichedGroup });
}

/**
 * Get member characters in the group
 */
export async function handleGetMembers(
  groupId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  const group = await repos.groups.findById(groupId);
  if (!group) {
    return notFound('Group');
  }

  const members = await repos.groupCharacterMembers.findByGroupId(groupId);

  const enrichedMembers = await Promise.all(
    members.map(async (m) => {
      const character = await repos.characters.findById(m.characterId);
      if (!character) return null;
      return {
        id: character.id,
        name: character.name,
        // Archiving never removes membership edges; the badge lets the list
        // reconcile "6 members / 4 can speak" (spec §5.2).
        archivedAt: character.archivedAt ?? null,
      };
    })
  );

  return successResponse({ members: enrichedMembers.filter(Boolean) });
}

/**
 * Update group
 */
export async function handlePutDefault(
  req: NextRequest,
  groupId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  const existingGroup = await repos.groups.findById(groupId);

  if (!existingGroup) {
    return notFound('Group');
  }

  const body = await req.json();
  const validatedData = updateGroupSchema.parse(body);

  const group = await repos.groups.update(groupId, validatedData);

  logger.info('[Groups v1] Group updated', { groupId });

  return successResponse({ group });
}

/**
 * Delete group and clean up references
 */
export async function handleDeleteGroup(
  groupId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  const existingGroup = await repos.groups.findById(groupId);

  if (!existingGroup) {
    return notFound('Group');
  }

  // Drop all memberships
  await repos.groupCharacterMembers.deleteByGroupId(groupId);

  // Unlink additional stores (do NOT delete them, just drop the links)
  await repos.groupDocMountLinks.deleteByGroupId(groupId);

  // Delete the group itself (orphaning the official store)
  await repos.groups.delete(groupId);

  logger.info('[Groups v1] Group deleted', { groupId });

  return successResponse({ success: true });
}

/**
 * Add a character member to the group
 */
export async function handleAddMember(
  req: NextRequest,
  groupId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  const group = await repos.groups.findById(groupId);
  if (!group) {
    return notFound('Group');
  }

  const body = await req.json();
  const validatedData = addMemberSchema.parse(body);

  const character = await repos.characters.findById(validatedData.characterId);
  if (!character) {
    return badRequest('Character not found');
  }

  // Archived characters can't join a group; existing memberships are never
  // removed by archiving (spec §5.1).
  if (character.archivedAt) {
    return badRequest('That character is archived; rehydrate them before adding them to a group.');
  }

  await repos.groupCharacterMembers.addMember(groupId, validatedData.characterId);

  logger.info('[Groups v1] Character added to group', {
    groupId,
    characterId: validatedData.characterId,
  });

  return successResponse({ success: true });
}

/**
 * Remove a character member from the group
 */
export async function handleRemoveMember(
  req: NextRequest,
  groupId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  const group = await repos.groups.findById(groupId);
  if (!group) {
    return notFound('Group');
  }

  const body = await req.json();
  const validatedData = removeMemberSchema.parse(body);

  await repos.groupCharacterMembers.removeMember(groupId, validatedData.characterId);

  logger.info('[Groups v1] Character removed from group', {
    groupId,
    characterId: validatedData.characterId,
  });

  return successResponse({ success: true });
}
