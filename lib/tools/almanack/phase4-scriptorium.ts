/**
 * The Almanack — Phase 4, "Touring the Scriptorium".
 *
 * The mount-index database — the half of the application the old capabilities
 * report never opened. Since the 4.4–4.9 cutovers this is where character
 * content, wardrobe, custom tools, photos, mail and scenarios actually live,
 * and where nearly all the bytes are.
 *
 * Everything reads through `mountRows` (the mount-index handle), never
 * `manager.rawQuery` — that addresses the main DB and would silently return
 * nothing for every `doc_mount_*` table.
 *
 * Tier classification (character vault / project store / group store / general)
 * is a cross-database question: the mount rows themselves don't know what they
 * belong to, so the owning ids are read from the main DB first and carried in.
 *
 * @module lib/tools/almanack/phase4-scriptorium
 */

import { logger } from '@/lib/logger';
import {
  getGeneralMountPointId,
  getLanternBackgroundsMountPointId,
  getUserUploadsMountPointId,
} from '@/lib/instance-settings';
import { listAllCustomTools } from '@/lib/pascal/custom-tools';
import { PHOTOS_FOLDER } from '@/lib/photos/photos-paths';
import { MAIL_FOLDER } from '@/lib/post-office/mailbox';
import { WARDROBE_INSTRUCTIONS_PATH } from '@/lib/mount-index/character-vault';
import { TOOLS_FOLDER } from '@/lib/pascal/custom-tool.types';
import { getErrorMessage } from '@/lib/error-utils';
import { isMountIndexAvailable, mainRows, mountRow, mountRows, num } from './db';
import type { MountPointSummaryRow, ScriptoriumInfo, WellKnownMountInfo } from './types';

const moduleLogger = logger.child({ module: 'almanack:scriptorium' });

/** Root-level folder each character vault keeps its wardrobe in. */
const WARDROBE_FOLDER = 'Wardrobe';
/** Root-level folder holding one markdown file per scenario. */
const SCENARIOS_FOLDER = 'Scenarios';
/** The keystone file: a vault without it reads as broken (a hard 503). */
const VAULT_KEYSTONE = 'properties.json';
/** Optional per-character free-form metadata document. */
const VAULT_METADATA = 'metadata.json';

/** Which mount ids belong to which tier, read from the main database. */
interface MountOwnership {
  characterVaults: Set<string>;
  projectStores: Set<string>;
  groupStores: Set<string>;
  generalMountId: string | null;
  uploadsMountId: string | null;
  lanternMountId: string | null;
}

async function collectMountOwnership(userId: string): Promise<MountOwnership> {
  const [characterRows, projectRows, groupRows, generalId, uploadsId, lanternId] =
    await Promise.all([
      mainRows<{ id: string }>(
        `SELECT "characterDocumentMountPointId" AS id FROM "characters"
         WHERE "userId" = ? AND "characterDocumentMountPointId" IS NOT NULL`,
        [userId],
        'scriptorium.characterVaultIds',
      ),
      mainRows<{ id: string }>(
        `SELECT "officialMountPointId" AS id FROM "projects" WHERE "officialMountPointId" IS NOT NULL`,
        [],
        'scriptorium.projectStoreIds',
      ),
      mainRows<{ id: string }>(
        `SELECT "officialMountPointId" AS id FROM "groups" WHERE "officialMountPointId" IS NOT NULL`,
        [],
        'scriptorium.groupStoreIds',
      ),
      getGeneralMountPointId(),
      getUserUploadsMountPointId(),
      getLanternBackgroundsMountPointId(),
    ]);

  return {
    characterVaults: new Set(characterRows.map(r => r.id)),
    projectStores: new Set(projectRows.map(r => r.id)),
    groupStores: new Set(groupRows.map(r => r.id)),
    generalMountId: generalId,
    uploadsMountId: uploadsId,
    lanternMountId: lanternId,
  };
}

/** `IN (?, ?, …)` placeholder list; `'(NULL)'` when the set is empty. */
function inClause(ids: Iterable<string>): { sql: string; params: string[] } {
  const params = [...ids];
  if (params.length === 0) return { sql: '(NULL)', params: [] };
  return { sql: `(${params.map(() => '?').join(', ')})`, params };
}

/**
 * Count links whose path sits under `folder/` within the given mounts.
 * `excludeRelativePath` drops one exact (lowercased) path from the count —
 * used to keep `Wardrobe/instructions.md` out of the garment figures.
 */
function countLinksInFolder(
  mountIds: Iterable<string>,
  folder: string,
  excludeRelativePath?: string,
): number {
  const { sql, params } = inClause(mountIds);
  const exclusion = excludeRelativePath ? ' AND lower("relativePath") != ?' : '';
  const row = mountRow<{ n: number }>(
    `SELECT COUNT(*) AS n FROM "doc_mount_file_links"
     WHERE "mountPointId" IN ${sql} AND lower("relativePath") LIKE ?${exclusion}`,
    [
      ...params,
      `${folder.toLowerCase()}/%`,
      ...(excludeRelativePath ? [excludeRelativePath.toLowerCase()] : []),
    ],
    `scriptorium.countLinksInFolder:${folder}`,
  );
  return num(row?.n);
}

/**
 * Count links under `folder/` in the given mounts whose document body matches
 * `pattern` — the cheap way to ask a frontmatter question in SQL.
 *
 * Approximate by construction: it is a substring match on the whole document,
 * not a YAML parse. Used only for coarse figures (archived wardrobe items,
 * unannounced letters) where an occasional false positive in a body is
 * immaterial and parsing every document would not be.
 */
function countLinksMatchingContent(
  mountIds: Iterable<string>,
  folder: string,
  pattern: string,
): number {
  const { sql, params } = inClause(mountIds);
  const row = mountRow<{ n: number }>(
    `SELECT COUNT(*) AS n
     FROM "doc_mount_file_links" l
     JOIN "doc_mount_documents" d ON d."fileId" = l."fileId"
     WHERE l."mountPointId" IN ${sql}
       AND lower(l."relativePath") LIKE ?
       AND d."content" LIKE ?`,
    [...params, `${folder.toLowerCase()}/%`, pattern],
    `scriptorium.countLinksMatchingContent:${folder}`,
  );
  return num(row?.n);
}

/** Total bytes of links under `folder/` in the given mounts (blobs + text). */
function bytesInFolder(mountIds: Iterable<string>, folder: string): number {
  const { sql, params } = inClause(mountIds);
  const row = mountRow<{ bytes: number }>(
    `SELECT COALESCE(SUM(f."fileSizeBytes"), 0) AS bytes
     FROM "doc_mount_file_links" l
     JOIN "doc_mount_files" f ON f."id" = l."fileId"
     WHERE l."mountPointId" IN ${sql} AND lower(l."relativePath") LIKE ?`,
    [...params, `${folder.toLowerCase()}/%`],
    `scriptorium.bytesInFolder:${folder}`,
  );
  return num(row?.bytes);
}

/** An empty tour, for when the mount index is unreachable or a collector fails. */
export function emptyScriptorium(): ScriptoriumInfo {
  return {
    available: false,
    mountPoints: {
      total: 0,
      enabled: 0,
      byKind: [],
      scanErrors: 0,
      conversionErrors: 0,
      scanStatuses: [],
      conversionStatuses: [],
      wellKnown: [],
    },
    content: {
      fileRows: 0,
      linkRows: 0,
      documentRows: 0,
      documentTextBytes: 0,
      blobRows: 0,
      blobBytes: 0,
      blobsByMimeType: [],
      chunkRows: 0,
      unembeddedChunks: 0,
      chunkTokens: 0,
    },
    links: {
      dedupRatio: 0,
      hardLinkGroups: 0,
      hardLinkedLinks: 0,
      extractionErrors: 0,
      conversionErrors: 0,
      policyEmbedDenied: 0,
      policyCharacterReadDenied: 0,
      policyCharacterWriteDenied: 0,
    },
    characterVaults: { total: 0, withKeystone: 0, missingKeystone: 0, withMetadata: 0 },
    wardrobe: [],
    customTools: {
      total: 0,
      byStore: [],
      withPresets: 0,
      presetFiles: 0,
      withLlmConsult: 0,
      withEffects: 0,
      metadataGated: 0,
      parseFailures: 0,
      parseFailureDetail: [],
    },
    postOffice: { letters: 0, unannounced: 0, mailboxes: 0 },
    photos: {
      characterVaultPhotos: 0,
      characterVaultBytes: 0,
      userGalleryPhotos: 0,
      userGalleryBytes: 0,
    },
    scenarios: [],
    stateCascade: {
      chatsWithState: 0,
      projectsWithState: 0,
      groupsWithState: 0,
      generalStatePresent: false,
    },
  };
}

/** The whole tour. */
export async function collectScriptorium(
  userId: string,
  chatsWithState: number,
): Promise<ScriptoriumInfo> {
  if (!isMountIndexAvailable()) {
    moduleLogger.warn('Mount index unavailable; Scriptorium section will report as unreachable');
    return emptyScriptorium();
  }

  const ownership = await collectMountOwnership(userId);

  // --- Mount points -------------------------------------------------------

  const byKindRows = mountRows<{
    mountType: string;
    storeType: string;
    count: number;
    enabled: number;
    fileCount: number;
    chunkCount: number;
    totalSizeBytes: number;
  }>(
    `SELECT "mountType"                                          AS mountType,
            "storeType"                                          AS storeType,
            COUNT(*)                                             AS count,
            SUM(CASE WHEN "enabled" = 1 THEN 1 ELSE 0 END)       AS enabled,
            COALESCE(SUM("fileCount"), 0)                        AS fileCount,
            COALESCE(SUM("chunkCount"), 0)                       AS chunkCount,
            COALESCE(SUM("totalSizeBytes"), 0)                   AS totalSizeBytes
     FROM "doc_mount_points"
     GROUP BY mountType, storeType
     ORDER BY count DESC`,
    [],
    'scriptorium.mountsByKind',
  );

  const byKind: MountPointSummaryRow[] = byKindRows.map(r => ({
    mountType: r.mountType,
    storeType: r.storeType,
    count: num(r.count),
    enabled: num(r.enabled),
    fileCount: num(r.fileCount),
    chunkCount: num(r.chunkCount),
    totalSizeBytes: num(r.totalSizeBytes),
  }));

  const scanStatuses = mountRows<{ status: string; count: number }>(
    `SELECT COALESCE("scanStatus", 'idle') AS status, COUNT(*) AS count
     FROM "doc_mount_points" GROUP BY status ORDER BY count DESC`,
    [],
    'scriptorium.scanStatuses',
  ).map(r => ({ status: r.status, count: num(r.count) }));

  const conversionStatuses = mountRows<{ status: string; count: number }>(
    `SELECT COALESCE("conversionStatus", 'idle') AS status, COUNT(*) AS count
     FROM "doc_mount_points" GROUP BY status ORDER BY count DESC`,
    [],
    'scriptorium.conversionStatuses',
  ).map(r => ({ status: r.status, count: num(r.count) }));

  const mountTotals = mountRow<{ total: number; enabled: number; scanErr: number; convErr: number }>(
    `SELECT COUNT(*)                                                        AS total,
            SUM(CASE WHEN "enabled" = 1 THEN 1 ELSE 0 END)                  AS enabled,
            SUM(CASE WHEN "lastScanError" IS NOT NULL
                      AND "lastScanError" != '' THEN 1 ELSE 0 END)          AS scanErr,
            SUM(CASE WHEN "conversionStatus" = 'error' THEN 1 ELSE 0 END)   AS convErr
     FROM "doc_mount_points"`,
    [],
    'scriptorium.mountTotals',
  );

  const wellKnownSpecs: Array<{ label: string; settingKey: string; id: string | null }> = [
    { label: 'Quilltap Uploads', settingKey: 'userUploadsMountPointId', id: ownership.uploadsMountId },
    { label: 'Quilltap General', settingKey: 'generalMountPointId', id: ownership.generalMountId },
    {
      label: 'Lantern Backgrounds',
      settingKey: 'lanternBackgroundsMountPointId',
      id: ownership.lanternMountId,
    },
  ];

  const wellKnown: WellKnownMountInfo[] = wellKnownSpecs.map(spec => {
    if (!spec.id) {
      return {
        label: spec.label,
        settingKey: spec.settingKey,
        mountPointId: null,
        name: null,
        resolved: false,
      };
    }
    const row = mountRow<{ name: string }>(
      `SELECT "name" FROM "doc_mount_points" WHERE "id" = ?`,
      [spec.id],
      'scriptorium.wellKnownMount',
    );
    return {
      label: spec.label,
      settingKey: spec.settingKey,
      mountPointId: spec.id,
      name: row?.name ?? null,
      // A pointer that resolves to nothing means the provisioning migration
      // ran against a database that has since lost the row — worth surfacing.
      resolved: !!row,
    };
  });

  // --- Content totals -----------------------------------------------------

  const fileRows = num(
    mountRow<{ n: number }>(`SELECT COUNT(*) AS n FROM "doc_mount_files"`, [], 'scriptorium.files')
      ?.n,
  );
  const linkRows = num(
    mountRow<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "doc_mount_file_links"`,
      [],
      'scriptorium.links',
    )?.n,
  );

  const documentTotals = mountRow<{ rows: number; bytes: number }>(
    `SELECT COUNT(*) AS rows, COALESCE(SUM(length("content")), 0) AS bytes
     FROM "doc_mount_documents"`,
    [],
    'scriptorium.documents',
  );

  const blobTotals = mountRow<{ rows: number; bytes: number }>(
    `SELECT COUNT(*) AS rows, COALESCE(SUM("sizeBytes"), 0) AS bytes FROM "doc_mount_blobs"`,
    [],
    'scriptorium.blobs',
  );

  const blobsByMimeType = mountRows<{ storedMimeType: string; count: number; bytes: number }>(
    `SELECT "storedMimeType" AS storedMimeType, COUNT(*) AS count, COALESCE(SUM("sizeBytes"), 0) AS bytes
     FROM "doc_mount_blobs"
     GROUP BY storedMimeType ORDER BY bytes DESC`,
    [],
    'scriptorium.blobsByMimeType',
  ).map(r => ({
    storedMimeType: r.storedMimeType,
    count: num(r.count),
    bytes: num(r.bytes),
  }));

  const chunkTotals = mountRow<{ rows: number; unembedded: number; tokens: number }>(
    `SELECT COUNT(*)                                                    AS rows,
            SUM(CASE WHEN "embedding" IS NULL THEN 1 ELSE 0 END)        AS unembedded,
            COALESCE(SUM("tokenCount"), 0)                              AS tokens
     FROM "doc_mount_chunks"`,
    [],
    'scriptorium.chunks',
  );

  // --- Links, hard links and per-document policy --------------------------

  const linkTotals = mountRow<{
    groups: number;
    grouped: number;
    extractionErrors: number;
    conversionErrors: number;
    noEmbed: number;
    noRead: number;
    noWrite: number;
  }>(
    `SELECT COUNT(DISTINCT "linkGroupId")                                   AS groups,
            SUM(CASE WHEN "linkGroupId" IS NOT NULL THEN 1 ELSE 0 END)      AS grouped,
            SUM(CASE WHEN "extractionStatus" = 'error' THEN 1 ELSE 0 END)   AS extractionErrors,
            SUM(CASE WHEN "conversionStatus" = 'error' THEN 1 ELSE 0 END)   AS conversionErrors,
            SUM(CASE WHEN "allowEmbed" = 0 THEN 1 ELSE 0 END)               AS noEmbed,
            SUM(CASE WHEN "allowCharacterRead" = 0 THEN 1 ELSE 0 END)       AS noRead,
            SUM(CASE WHEN "allowCharacterWrite" = 0 THEN 1 ELSE 0 END)      AS noWrite
     FROM "doc_mount_file_links"`,
    [],
    'scriptorium.linkTotals',
  );

  // --- Character-vault health --------------------------------------------

  const vaultIds = ownership.characterVaults;
  const { sql: vaultSql, params: vaultParams } = inClause(vaultIds);

  const withKeystone = num(
    mountRow<{ n: number }>(
      `SELECT COUNT(DISTINCT "mountPointId") AS n FROM "doc_mount_file_links"
       WHERE "mountPointId" IN ${vaultSql} AND lower("relativePath") = ?`,
      [...vaultParams, VAULT_KEYSTONE.toLowerCase()],
      'scriptorium.vaultKeystones',
    )?.n,
  );
  const withMetadata = num(
    mountRow<{ n: number }>(
      `SELECT COUNT(DISTINCT "mountPointId") AS n FROM "doc_mount_file_links"
       WHERE "mountPointId" IN ${vaultSql} AND lower("relativePath") = ?`,
      [...vaultParams, VAULT_METADATA.toLowerCase()],
      'scriptorium.vaultMetadata',
    )?.n,
  );

  // --- Wardrobe by tier ---------------------------------------------------

  const wardrobeTiers: Array<{ tier: string; ids: Iterable<string> }> = [
    { tier: 'character', ids: vaultIds },
    { tier: 'project', ids: ownership.projectStores },
    { tier: 'group', ids: ownership.groupStores },
    { tier: 'general', ids: ownership.generalMountId ? [ownership.generalMountId] : [] },
  ];

  const wardrobe = wardrobeTiers.map(({ tier, ids }) => ({
    tier,
    // The dressing-instructions file lives in the folder but is not a garment.
    items: countLinksInFolder(ids, WARDROBE_FOLDER, WARDROBE_INSTRUCTIONS_PATH),
    archived: countLinksMatchingContent(ids, WARDROBE_FOLDER, '%archived: true%'),
  }));

  // --- Custom tools (Pascal's Workbench) ----------------------------------

  let customTools = emptyScriptorium().customTools;
  try {
    const library = await listAllCustomTools();
    const byStoreCounts = new Map<string, number>();
    let withLlmConsult = 0;
    let withEffects = 0;
    let metadataGated = 0;

    for (const entry of library.entries) {
      byStoreCounts.set(entry.mountName, (byStoreCounts.get(entry.mountName) ?? 0) + 1);
      if (entry.definition.llm) withLlmConsult++;
      if (entry.definition.effects && entry.definition.effects.length > 0) withEffects++;
      if (entry.definition.availableWhen || entry.definition.withheldWhen) metadataGated++;
    }

    // Presets are sibling `Tools/{tool}.{preset}.settings.json` documents, so
    // they are counted from the file links rather than the definitions.
    const presetRows = mountRows<{ relativePath: string }>(
      `SELECT "relativePath" AS relativePath FROM "doc_mount_file_links"
       WHERE lower("relativePath") LIKE ? AND lower("relativePath") LIKE '%.settings.json'`,
      [`${TOOLS_FOLDER.toLowerCase()}/%`],
      'scriptorium.toolPresets',
    );
    const toolsWithPresets = new Set(
      presetRows
        .map(r => {
          const filename = r.relativePath.slice(`${TOOLS_FOLDER}/`.length);
          const dot = filename.indexOf('.');
          return dot > 0 ? filename.slice(0, dot) : null;
        })
        .filter((name): name is string => !!name),
    );

    customTools = {
      total: library.entries.length,
      byStore: [...byStoreCounts.entries()]
        .map(([store, count]) => ({ store, count }))
        .sort((a, b) => b.count - a.count || a.store.localeCompare(b.store)),
      withPresets: toolsWithPresets.size,
      presetFiles: presetRows.length,
      withLlmConsult,
      withEffects,
      metadataGated,
      parseFailures: library.errors.length,
      parseFailureDetail: library.errors.slice(0, 20).map(e => ({
        store: e.mountName,
        path: e.definitionPath,
        reason: e.reason,
      })),
    };
  } catch (error) {
    moduleLogger.warn('Failed to inventory custom tools', { error: getErrorMessage(error) });
  }

  // --- The Post Office ----------------------------------------------------

  const letters = countLinksInFolder(vaultIds, MAIL_FOLDER);
  const unannounced = countLinksMatchingContent(vaultIds, MAIL_FOLDER, '%alerted: false%');
  const mailboxes = num(
    mountRow<{ n: number }>(
      `SELECT COUNT(DISTINCT "mountPointId") AS n FROM "doc_mount_file_links"
       WHERE "mountPointId" IN ${vaultSql} AND lower("relativePath") LIKE ?`,
      [...vaultParams, `${MAIL_FOLDER.toLowerCase()}/%`],
      'scriptorium.mailboxes',
    )?.n,
  );

  // --- Photos -------------------------------------------------------------

  const galleryIds = ownership.uploadsMountId ? [ownership.uploadsMountId] : [];

  // --- Scenarios by tier --------------------------------------------------

  const scenarios = wardrobeTiers.map(({ tier, ids }) => ({
    tier,
    count: countLinksInFolder(ids, SCENARIOS_FOLDER),
  }));

  // --- State cascade ------------------------------------------------------

  const projectsWithState = countStateFiles(ownership.projectStores);
  const groupsWithState = countStateFiles(ownership.groupStores);
  const generalStatePresent =
    ownership.generalMountId !== null &&
    countStateFiles([ownership.generalMountId]) > 0;

  return {
    available: true,
    mountPoints: {
      total: num(mountTotals?.total),
      enabled: num(mountTotals?.enabled),
      byKind,
      scanErrors: num(mountTotals?.scanErr),
      conversionErrors: num(mountTotals?.convErr),
      scanStatuses,
      conversionStatuses,
      wellKnown,
    },
    content: {
      fileRows,
      linkRows,
      documentRows: num(documentTotals?.rows),
      documentTextBytes: num(documentTotals?.bytes),
      blobRows: num(blobTotals?.rows),
      blobBytes: num(blobTotals?.bytes),
      blobsByMimeType,
      chunkRows: num(chunkTotals?.rows),
      unembeddedChunks: num(chunkTotals?.unembedded),
      chunkTokens: num(chunkTotals?.tokens),
    },
    links: {
      dedupRatio: fileRows > 0 ? linkRows / fileRows : 0,
      hardLinkGroups: num(linkTotals?.groups),
      hardLinkedLinks: num(linkTotals?.grouped),
      extractionErrors: num(linkTotals?.extractionErrors),
      conversionErrors: num(linkTotals?.conversionErrors),
      policyEmbedDenied: num(linkTotals?.noEmbed),
      policyCharacterReadDenied: num(linkTotals?.noRead),
      policyCharacterWriteDenied: num(linkTotals?.noWrite),
    },
    characterVaults: {
      total: vaultIds.size,
      withKeystone,
      // A linked vault with no `properties.json` is precisely the state that
      // makes `findById` throw CharacterVaultUnavailableError — a 503 for that
      // character. Worth a line of its own.
      missingKeystone: Math.max(0, vaultIds.size - withKeystone),
      withMetadata,
    },
    wardrobe,
    customTools,
    postOffice: { letters, unannounced, mailboxes },
    photos: {
      characterVaultPhotos: countLinksInFolder(vaultIds, PHOTOS_FOLDER),
      characterVaultBytes: bytesInFolder(vaultIds, PHOTOS_FOLDER),
      userGalleryPhotos: countLinksInFolder(galleryIds, PHOTOS_FOLDER),
      userGalleryBytes: bytesInFolder(galleryIds, PHOTOS_FOLDER),
    },
    scenarios,
    stateCascade: {
      chatsWithState,
      projectsWithState,
      groupsWithState,
      generalStatePresent,
    },
  };
}

/** Stores carrying a non-empty root `state.json` — the state cascade's tiers. */
function countStateFiles(mountIds: Iterable<string>): number {
  const { sql, params } = inClause(mountIds);
  const row = mountRow<{ n: number }>(
    `SELECT COUNT(DISTINCT l."mountPointId") AS n
     FROM "doc_mount_file_links" l
     JOIN "doc_mount_documents" d ON d."fileId" = l."fileId"
     WHERE l."mountPointId" IN ${sql}
       AND lower(l."relativePath") = 'state.json'
       AND trim(d."content") NOT IN ('', '{}')`,
    [...params],
    'scriptorium.stateFiles',
  );
  return num(row?.n);
}
