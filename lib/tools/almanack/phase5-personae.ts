/**
 * The Almanack — Phase 5, "Assembling the dramatis personae".
 *
 * Who has actually been on stage: the ten busiest characters, every project,
 * every group and its cast.
 *
 * The per-character chat count is one pass over `chats` with `json_each` over
 * the participants array. There is no participants join table — the repository
 * says so itself — so the alternative is a full scan per character, which is
 * what the old report's memory counting did and why it crawled.
 *
 * @module lib/tools/almanack/phase5-personae
 */

import { logger } from '@/lib/logger';
import { mainRows, mountRows, num } from './db';
import type { GroupRow, PersonaeInfo, ProjectRow, TopCharacterRow } from './types';

const moduleLogger = logger.child({ module: 'almanack:personae' });

/** How many characters the top table lists. */
const TOP_CHARACTER_COUNT = 10;

/**
 * Chat kinds excluded from the "chats participated in" count.
 *
 * Help chats and the Brahma Console are machinery, not drama — counting them
 * would put whichever character happens to answer help questions at the top of
 * a table that is meant to show who the household actually plays with.
 */
const EXCLUDED_CHAT_TYPES = ['help', 'brahma'];

/**
 * Whether a participant entry with `status: 'removed'` still counts toward a
 * character's chat total.
 *
 * `true` — a character who was written out of a scene was still in it. The
 * rendered section footnotes the choice; flipping this is a one-line change if
 * "currently in the cast" turns out to be the more useful reading.
 */
const COUNT_REMOVED_PARTICIPANTS = true;

/** Chats participated in, per character id — one pass over the whole table. */
async function collectChatCountsByCharacter(userId: string): Promise<Map<string, number>> {
  const typePlaceholders = EXCLUDED_CHAT_TYPES.map(() => '?').join(', ');
  const statusClause = COUNT_REMOVED_PARTICIPANTS
    ? ''
    : `AND COALESCE(json_extract(p.value, '$.status'), 'active') != 'removed'`;

  const rows = await mainRows<{ characterId: string; chats: number }>(
    `SELECT json_extract(p.value, '$.characterId') AS characterId,
            COUNT(DISTINCT c."id")                 AS chats
     FROM "chats" c, json_each(c."participants") p
     WHERE c."userId" = ?
       AND COALESCE(c."chatType", 'salon') NOT IN (${typePlaceholders})
       AND json_valid(c."participants")
       ${statusClause}
     GROUP BY characterId`,
    [userId, ...EXCLUDED_CHAT_TYPES],
    'personae.chatCountsByCharacter',
  );

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.characterId) counts.set(row.characterId, num(row.chats));
  }
  return counts;
}

/**
 * The ten busiest characters.
 *
 * Ranked by chat count, ties broken by memories. Storage is the character
 * vault's cached `totalSizeBytes`, refreshed by scans rather than measured
 * here — cheap, and close enough for a diagnostic. Because mount content is
 * content-addressed and hard-linkable across vaults, bytes shared between two
 * characters are counted for both; the rendered section says so rather than
 * pretending to amortize.
 */
export async function collectTopCharacters(
  userId: string,
  memoriesByCharacter: Map<string, number>,
): Promise<TopCharacterRow[]> {
  const [characters, chatCounts] = await Promise.all([
    mainRows<{ id: string; name: string; vaultId: string | null }>(
      `SELECT "id", "name", "characterDocumentMountPointId" AS vaultId
       FROM "characters" WHERE "userId" = ?`,
      [userId],
      'personae.characters',
    ),
    collectChatCountsByCharacter(userId),
  ]);

  // Vault sizes live in the other database, so they are fetched in one go and
  // joined here rather than per character.
  const vaultIds = characters.map(c => c.vaultId).filter((id): id is string => !!id);
  const vaultSizes = new Map<string, number>();
  if (vaultIds.length > 0) {
    const sizeRows = mountRows<{ id: string; totalSizeBytes: number }>(
      `SELECT "id", "totalSizeBytes" FROM "doc_mount_points"
       WHERE "id" IN (${vaultIds.map(() => '?').join(', ')})`,
      vaultIds,
      'personae.vaultSizes',
    );
    for (const row of sizeRows) {
      vaultSizes.set(row.id, num(row.totalSizeBytes));
    }
  }

  const rows: TopCharacterRow[] = characters.map(character => ({
    name: character.name,
    chats: chatCounts.get(character.id) ?? 0,
    memories: memoriesByCharacter.get(character.id) ?? 0,
    storageBytes: character.vaultId ? (vaultSizes.get(character.vaultId) ?? 0) : 0,
  }));

  rows.sort(
    (a, b) =>
      b.chats - a.chats ||
      b.memories - a.memories ||
      b.storageBytes - a.storageBytes ||
      a.name.localeCompare(b.name),
  );

  moduleLogger.debug('Ranked characters', { total: rows.length });
  return rows.slice(0, TOP_CHARACTER_COUNT);
}

/** Every project, with what is attached to it. */
export async function collectProjects(): Promise<ProjectRow[]> {
  const projects = await mainRows<{ id: string; name: string; officialMountPointId: string | null }>(
    `SELECT "id", "name", "officialMountPointId" FROM "projects" ORDER BY "name"`,
    [],
    'personae.projects',
  );
  if (projects.length === 0) return [];

  const [chatCounts, fileCounts] = await Promise.all([
    mainRows<{ projectId: string; n: number }>(
      `SELECT "projectId", COUNT(*) AS n FROM "chats"
       WHERE "projectId" IS NOT NULL GROUP BY "projectId"`,
      [],
      'personae.projectChats',
    ),
    mainRows<{ projectId: string; n: number }>(
      `SELECT "projectId", COUNT(*) AS n FROM "files"
       WHERE "projectId" IS NOT NULL GROUP BY "projectId"`,
      [],
      'personae.projectFiles',
    ),
  ]);

  const chatsByProject = new Map(chatCounts.map(r => [r.projectId, num(r.n)]));
  const filesByProject = new Map(fileCounts.map(r => [r.projectId, num(r.n)]));

  const projectIds = projects.map(p => p.id);
  const linkRows = mountRows<{ projectId: string; n: number }>(
    `SELECT "projectId", COUNT(*) AS n FROM "project_doc_mount_links"
     WHERE "projectId" IN (${projectIds.map(() => '?').join(', ')})
     GROUP BY "projectId"`,
    projectIds,
    'personae.projectStoreLinks',
  );
  const storesByProject = new Map(linkRows.map(r => [r.projectId, num(r.n)]));

  const mountIds = projects
    .map(p => p.officialMountPointId)
    .filter((id): id is string => !!id);

  const documentCounts = new Map<string, number>();
  const statefulMounts = new Set<string>();
  if (mountIds.length > 0) {
    const placeholders = mountIds.map(() => '?').join(', ');
    for (const row of mountRows<{ mountPointId: string; n: number }>(
      `SELECT "mountPointId", COUNT(*) AS n FROM "doc_mount_file_links"
       WHERE "mountPointId" IN (${placeholders}) GROUP BY "mountPointId"`,
      mountIds,
      'personae.projectDocuments',
    )) {
      documentCounts.set(row.mountPointId, num(row.n));
    }
    for (const row of mountRows<{ mountPointId: string }>(
      `SELECT DISTINCT l."mountPointId" AS mountPointId
       FROM "doc_mount_file_links" l
       JOIN "doc_mount_documents" d ON d."fileId" = l."fileId"
       WHERE l."mountPointId" IN (${placeholders})
         AND lower(l."relativePath") = 'state.json'
         AND trim(d."content") NOT IN ('', '{}')`,
      mountIds,
      'personae.projectState',
    )) {
      statefulMounts.add(row.mountPointId);
    }
  }

  return projects.map(project => ({
    name: project.name,
    linkedStores: storesByProject.get(project.id) ?? 0,
    chats: chatsByProject.get(project.id) ?? 0,
    files: filesByProject.get(project.id) ?? 0,
    documents: project.officialMountPointId
      ? (documentCounts.get(project.officialMountPointId) ?? 0)
      : 0,
    hasState: project.officialMountPointId
      ? statefulMounts.has(project.officialMountPointId)
      : false,
  }));
}

/**
 * Every group, with its cast by name.
 *
 * A group with no `officialMountPointId` never got its store provisioned —
 * a real gap, so it gets a column rather than being inferred from a blank.
 */
export async function collectGroups(): Promise<GroupRow[]> {
  const groups = await mainRows<{ id: string; name: string; officialMountPointId: string | null }>(
    `SELECT "id", "name", "officialMountPointId" FROM "groups" ORDER BY "name"`,
    [],
    'personae.groups',
  );
  if (groups.length === 0) return [];

  const groupIds = groups.map(g => g.id);
  const placeholders = groupIds.map(() => '?').join(', ');

  // Membership and store links live in the mount index; the character NAMES
  // live in the main DB, so the two halves are joined in application code.
  const memberRows = mountRows<{ groupId: string; characterId: string }>(
    `SELECT "groupId", "characterId" FROM "group_character_members"
     WHERE "groupId" IN (${placeholders})`,
    groupIds,
    'personae.groupMembers',
  );
  const linkRows = mountRows<{ groupId: string; n: number }>(
    `SELECT "groupId", COUNT(*) AS n FROM "group_doc_mount_links"
     WHERE "groupId" IN (${placeholders}) GROUP BY "groupId"`,
    groupIds,
    'personae.groupStoreLinks',
  );
  const storesByGroup = new Map(linkRows.map(r => [r.groupId, num(r.n)]));

  const characterIds = [...new Set(memberRows.map(r => r.characterId))];
  const namesById = new Map<string, string>();
  if (characterIds.length > 0) {
    const nameRows = await mainRows<{ id: string; name: string }>(
      `SELECT "id", "name" FROM "characters"
       WHERE "id" IN (${characterIds.map(() => '?').join(', ')})`,
      characterIds,
      'personae.groupMemberNames',
    );
    for (const row of nameRows) namesById.set(row.id, row.name);
  }

  const membersByGroup = new Map<string, string[]>();
  for (const row of memberRows) {
    const list = membersByGroup.get(row.groupId) ?? [];
    // A membership row pointing at a character that no longer exists is a
    // dangling cross-database reference — shown as such rather than dropped.
    list.push(namesById.get(row.characterId) ?? '(missing character)');
    membersByGroup.set(row.groupId, list);
  }

  return groups.map(group => ({
    name: group.name,
    members: (membersByGroup.get(group.id) ?? []).sort((a, b) => a.localeCompare(b)),
    linkedStores: storesByGroup.get(group.id) ?? 0,
    hasOfficialStore: !!group.officialMountPointId,
  }));
}

/** The whole cast list. */
export async function collectPersonae(
  userId: string,
  memoriesByCharacter: Map<string, number>,
): Promise<PersonaeInfo> {
  const [topCharacters, projects, groups] = await Promise.all([
    collectTopCharacters(userId, memoriesByCharacter),
    collectProjects(),
    collectGroups(),
  ]);

  return {
    topCharacters,
    countsRemovedParticipants: COUNT_REMOVED_PARTICIPANTS,
    projects,
    groups,
  };
}
