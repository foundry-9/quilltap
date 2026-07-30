/**
 * Group Scenarios for the New Chat dialog — participant-union aggregation.
 *
 * GET /api/v1/groups/scenarios?characterIds=<id,id,...>
 *
 * Returns, for every group that ANY of the supplied (prospective) participants
 * is a member of, that group's `Scenarios/` entries — grouped under the group's
 * name. This is the ONE sanctioned exception to Groups' otherwise strict
 * per-responding-character isolation (see docs/developer/features/groups.md
 * §6/§13): scenarios are a chat-creation-time menu, not a per-turn access grant,
 * so a group's scenarios are offered to the whole New Chat dialog when a member
 * is present. Per-turn Knowledge/search/write access remains
 * responding-character-only and is resolved elsewhere (the tier resolver) — this
 * route must never feed into that path.
 *
 * Static sibling of `/api/v1/groups/[id]` — Next.js routes the static
 * `scenarios` segment ahead of the dynamic `[id]`.
 */

import { NextRequest } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { successResponse } from '@/lib/api/responses';
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';
import {
  ensureGroupScenariosFolder,
  listGroupScenarios,
} from '@/lib/mount-index/group-scenarios';

export const GET = createContextHandler(
  async (req: NextRequest, { repos }: RequestContext) => {
    const raw = req.nextUrl.searchParams.get('characterIds') ?? '';
    const requestedIds = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (requestedIds.length === 0) {
      return successResponse({ groupScenarios: [] });
    }

    // Only trust character ids the caller can actually access. `repos.characters`
    // is user-scoped (returns null for ids the user doesn't own), so resolving
    // each id here prevents probing arbitrary UUIDs for group membership /
    // scenario metadata via the unscoped membership table.
    const characterIds: string[] = [];
    for (const id of requestedIds) {
      const character = await repos.characters.findById(id);
      if (character) characterIds.push(id);
    }
    if (characterIds.length === 0) {
      return successResponse({ groupScenarios: [] });
    }

    // Collect the distinct set of groups that ANY supplied participant belongs
    // to. A group qualifies as long as at least one selected participant is a
    // member — it does not matter that other participants aren't.
    const groupIds = new Set<string>();
    for (const characterId of characterIds) {
      const memberships = await repos.groupCharacterMembers.findByCharacterId(characterId);
      for (const m of memberships) groupIds.add(m.groupId);
    }

    const groupScenarios: Array<{
      groupId: string;
      groupName: string;
      mountPointId: string;
      scenarios: unknown[];
      warnings: string[];
    }> = [];

    for (const groupId of groupIds) {
      try {
        // findByIdRaw — we only need name + officialMountPointId, not the
        // hydrated store content.
        const group = await repos.groups.findByIdRaw(groupId);
        if (!group) continue;

        const ensured = await ensureGroupOfficialStore(group.id, group.name);
        if (!ensured) continue;
        await ensureGroupScenariosFolder(ensured.mountPointId);

        const { scenarios, warnings } = await listGroupScenarios(ensured.mountPointId);
        if (scenarios.length === 0) continue;

        groupScenarios.push({
          groupId: group.id,
          groupName: group.name,
          mountPointId: ensured.mountPointId,
          scenarios,
          warnings,
        });
      } catch (error) {
        logger.warn('[Groups v1] Failed to load scenarios for a group; skipping', {
          groupId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Stable ordering by group name for a predictable menu.
    groupScenarios.sort((a, b) => a.groupName.localeCompare(b.groupName));

    return successResponse({ groupScenarios });
  },
);
