/**
 * Shared context, logging, and cross-cutting helpers for the doc-edit tool
 * handlers.
 *
 * These helpers are used across multiple handler groups (text, markdown, file
 * management, document UI, blob). Group-local helpers live alongside their
 * handlers instead of here.
 *
 * @module tools/handlers/doc-edit/shared
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import {
  reindexSingleFile,
  PathResolutionError,
  type ResolvedPath,
} from '@/lib/doc-edit';
// Import the pure codec directly (not the barrel) so this module — and the
// handler tests that mock the barrel — never drag in native conversion deps.
import { parseQtapUri } from '@/lib/doc-edit/qtap-uri';
import { getRepositories } from '@/lib/repositories/factory';

// The server-side qtap:// URI producers live in their own converters-free
// module; re-export them here so the doc-edit handlers keep importing from
// './shared'.
export {
  uriForResolvedPath,
  docStoreUriFor,
  buildDocStoreUriResolver,
} from '@/lib/doc-edit/uri-producers';
import { isParticipantPresent } from '@/lib/schemas/chat.types';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import type { LibrarianActorOrigin } from '@/lib/services/librarian-notifications/writer';

export const logger = createServiceLogger('DocEdit:Handler');

/**
 * Resolve the LibrarianActorOrigin for a doc-tool call so a change
 * announcement can name who effected it. Characters are preferred; if the
 * context carries no characterId (operator / Document-Mode surfaces) or the
 * lookup fails, falls back to user attribution. Shared by every doc-edit
 * handler group that posts a Librarian announcement.
 */
export async function resolveActorOrigin(
  context: DocEditToolContext
): Promise<LibrarianActorOrigin> {
  if (!context.characterId) return { kind: 'by-user' };
  try {
    const repos = getRepositories();
    const character = await repos.characters.findById(context.characterId);
    if (character?.name) {
      return { kind: 'by-character', characterName: character.name };
    }
  } catch {
    // Fall through to user attribution on lookup failure.
  }
  return { kind: 'by-user' };
}

/**
 * The familiar addressing fields a `qtap://` URI populates on a doc-tool call,
 * plus the heading/level a URI fragment may carry. `applyQtapUriToInput`
 * projects a `uri` onto these so the rest of a handler reads `scope` /
 * `mount_point` / `path` exactly as before.
 */
export interface QtapAddressableInput {
  scope?: string;
  mount_point?: string;
  path?: string;
  uri?: string;
  /** Heading text carried by the URI fragment (resolved by heading tools). */
  uriHeading?: string;
  /** Heading level carried by the URI fragment (resolved by heading tools). */
  uriLevel?: number;
}

/**
 * When a doc-tool call carries a `uri`, parse it and project its parts onto the
 * familiar `scope` / `mount_point` / `path` fields, returning a normalized copy
 * (the URI wins over any stale scope/mount_point/path on the same input, per
 * the spec). The fragment's heading/level are surfaced as `uriHeading` /
 * `uriLevel` for heading tools to apply with explicit-overrides-fragment
 * precedence. The returned object has `uri` cleared, so the helper is
 * idempotent (calling it again is a no-op). Pure string work — no DB. A
 * malformed URI throws `QtapUriError`, which surfaces as a clean tool error.
 *
 * Every read/write doc tool funnels its addressing through this helper (the
 * handler calls it first; the resolution-context builders call it again
 * defensively), so `uri` support is uniform without per-tool parsing.
 */
export function applyQtapUriToInput<T extends QtapAddressableInput>(
  input: T
): T & { uriHeading?: string; uriLevel?: number } {
  if (!input.uri) return input;
  const parts = parseQtapUri(input.uri);
  return {
    ...input,
    uri: undefined,
    scope: parts.scope,
    mount_point: parts.mountPoint,
    path: parts.path,
    uriHeading: parts.heading,
    uriLevel: parts.level,
  };
}

/**
 * Context required for doc-edit tool execution.
 */
export interface DocEditToolContext {
  chatId: string;
  userId: string;
  projectId?: string;
  characterId?: string;
  /**
   * Operator "look everywhere" override — every enabled document store is
   * reachable, regardless of project/character context. Set by the human
   * operator's surfaces (Document Mode HTTP actions and the Brahma Console),
   * never by character tool handlers. Passed straight through to the path
   * resolver's `operatorOverride`.
   */
  operatorOverride?: boolean;
}

/**
 * Collect the character IDs of other present participants in the chat whose
 * vaults should be readable — only when the chat has the
 * `allowCrossCharacterVaultReads` flag enabled. Returns an empty array when
 * the flag is off, the chat isn't found, or the acting character is the only
 * present participant.
 */
export async function collectPeerCharacterIdsForReads(
  context: DocEditToolContext
): Promise<string[]> {
  if (!context.chatId) return [];
  const repos = getRepositories();
  const chat = await repos.chats.findById(context.chatId);
  if (!chat || !chat.allowCrossCharacterVaultReads) return [];

  const acting = context.characterId;
  const peers = new Set<string>();
  for (const p of chat.participants) {
    if (!p.characterId) continue;
    if (p.characterId === acting) continue;
    if (!isParticipantPresent(p.status)) continue;
    peers.add(p.characterId);
  }
  return Array.from(peers);
}

/**
 * When a character has `systemTransparency !== true` they accept the covenant
 * of trust — every character vault (their own and peers') is hidden from
 * doc_* tools. Returns true if the acting character is opaque; falls back to
 * "opaque" on lookup failure so a transient repo error doesn't accidentally
 * grant access. Project-linked document stores remain accessible regardless.
 */
export async function actingCharacterIsOpaqueToVaults(
  context: DocEditToolContext
): Promise<boolean> {
  if (!context.characterId) return false;
  try {
    const repos = getRepositories();
    const character = await repos.characters.findById(context.characterId);
    return character?.systemTransparency !== true;
  } catch (err) {
    logger.warn('systemTransparency lookup failed; defaulting to opaque', {
      characterId: context.characterId,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

/**
 * If the requested mount_point refers to a peer participant's vault while
 * cross-character reads are enabled, throw a clear read-only error. This
 * turns what would otherwise be a generic "mount point not accessible"
 * message into a specific message explaining the cross-character boundary.
 */
export async function assertWriteDoesNotTargetPeerVault(
  mountPointHint: string | undefined,
  peerCharacterIds: string[]
): Promise<void> {
  if (!mountPointHint || peerCharacterIds.length === 0) return;
  const repos = getRepositories();
  const needle = mountPointHint.toLowerCase();
  for (const peerId of peerCharacterIds) {
    const peer = await repos.characters.findById(peerId);
    if (!peer?.characterDocumentMountPointId) continue;
    if (peer.characterDocumentMountPointId === mountPointHint) {
      logger.info('Rejected write to peer character vault (read-only in this chat)', {
        peerCharacterId: peerId,
        mountPointId: peer.characterDocumentMountPointId,
      });
      throw new PathResolutionError(
        `${peer.name}'s vault is read-only in this chat. Cross-character vault sharing permits reads only.`,
        'ACCESS_DENIED'
      );
    }
    const mp = await repos.docMountPoints.findById(peer.characterDocumentMountPointId);
    if (mp && mp.name.toLowerCase() === needle) {
      logger.info('Rejected write to peer character vault (read-only in this chat)', {
        peerCharacterId: peerId,
        mountPointName: mp.name,
      });
      throw new PathResolutionError(
        `${peer.name}'s vault is read-only in this chat. Cross-character vault sharing permits reads only.`,
        'ACCESS_DENIED'
      );
    }
  }
}

// ============================================================================
// Per-document policy gates (character_read / character_write)
//
// These enforce the three frontmatter policy flags persisted on the link row
// (allowEmbed / allowCharacterRead / allowCharacterWrite). They govern
// CHARACTERS only — the human operator (operatorOverride) is never restricted,
// so every gate is a no-op when `context.operatorOverride === true`. The flags
// are the single chokepoint: callers funnel reads/writes through these helpers
// rather than scattering raw flag checks across handlers.
//
// Existence-leak rule: a `character_read:false` file must produce the SAME
// not-found error as a genuinely missing file, so a character can't probe for
// protected filenames. The write gate therefore checks readability first.
// ============================================================================

/**
 * Throw a not-found-style PathResolutionError when the acting character may not
 * read the resolved document (`character_read:false`). No-op for the operator,
 * for non-mount scopes (project-legacy / general have no policy row), and for
 * paths with no link row yet (a not-yet-indexed file).
 */
export async function assertCharacterMayRead(
  resolved: ResolvedPath,
  context: DocEditToolContext
): Promise<void> {
  if (context.operatorOverride === true) return;
  if (!resolved.mountPointId) return;
  const repos = getRepositories();
  const link = await repos.docMountFileLinks.findByMountPointAndPath(
    resolved.mountPointId,
    resolved.relativePath
  );
  if (link && link.allowCharacterRead === false) {
    logger.info('Blocked character read of character_read:false document', {
      mountPointId: resolved.mountPointId,
      relativePath: resolved.relativePath,
      characterId: context.characterId,
    });
    // Mirror the "missing file" shape so existence isn't leaked.
    throw new PathResolutionError(`File not found: ${resolved.relativePath}`, 'NOT_FOUND');
  }
}

/**
 * Throw when the acting character may not mutate the resolved document. Checks
 * the read gate first: a `character_read:false` file is reported as not-found
 * (don't leak existence); a readable-but-`character_write:false` file is
 * reported as read-only. No-op for the operator and non-mount scopes. A path
 * with no link row (a brand-new file being created) is allowed.
 */
export async function assertCharacterMayWrite(
  resolved: ResolvedPath,
  context: DocEditToolContext
): Promise<void> {
  if (context.operatorOverride === true) return;
  if (!resolved.mountPointId) return;
  const repos = getRepositories();
  const link = await repos.docMountFileLinks.findByMountPointAndPath(
    resolved.mountPointId,
    resolved.relativePath
  );
  if (!link) return; // creating a new file — no policy row to honour yet
  if (link.allowCharacterRead === false) {
    logger.info('Blocked character write of character_read:false document (reported as not-found)', {
      mountPointId: resolved.mountPointId,
      relativePath: resolved.relativePath,
      characterId: context.characterId,
    });
    throw new PathResolutionError(`File not found: ${resolved.relativePath}`, 'NOT_FOUND');
  }
  if (link.allowCharacterWrite === false) {
    logger.info('Blocked character write of character_write:false document', {
      mountPointId: resolved.mountPointId,
      relativePath: resolved.relativePath,
      characterId: context.characterId,
    });
    throw new PathResolutionError(
      `This document is read-only to characters: ${resolved.relativePath}`,
      'ACCESS_DENIED'
    );
  }
}

/**
 * Build the set of relativePaths (lowercased) in a mount point that are hidden
 * from characters by `character_read:false`. Empty for the operator (sees
 * everything) or when no link is blocked. Used by doc_list_files / doc_grep,
 * which enumerate files directly rather than resolving each one.
 */
export async function getCharacterBlockedReadPaths(
  mountPointId: string,
  context: DocEditToolContext
): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (context.operatorOverride === true) return blocked;
  const repos = getRepositories();
  const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);
  for (const link of links) {
    if (link.allowCharacterRead === false) {
      blocked.add(link.relativePath.toLowerCase());
    }
  }
  return blocked;
}

/**
 * Guard a folder delete/move: if any document under `folderRelativePath` is
 * `character_write:false` (or `character_read:false`, which is stricter still),
 * fail the whole operation naming the protected document, so a character can't
 * relocate or delete a protected file by operating on its parent folder. No-op
 * for the operator and non-mount scopes.
 */
export async function assertFolderHasNoWriteProtectedDescendants(
  resolved: ResolvedPath,
  context: DocEditToolContext
): Promise<void> {
  if (context.operatorOverride === true) return;
  if (!resolved.mountPointId) return;
  const repos = getRepositories();
  const links = await repos.docMountFileLinks.findByMountPointId(resolved.mountPointId);
  // Normalise the folder path to a POSIX-style prefix with a trailing slash so
  // "Notes" doesn't match "Notes-archive/x.md".
  const folder = resolved.relativePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = folder === '' ? '' : `${folder.toLowerCase()}/`;
  for (const link of links) {
    const rel = link.relativePath.toLowerCase();
    const inFolder = prefix === '' ? true : rel.startsWith(prefix);
    if (!inFolder) continue;
    if (link.allowCharacterWrite === false || link.allowCharacterRead === false) {
      logger.info('Blocked folder operation over a protected document', {
        mountPointId: resolved.mountPointId,
        folder: resolved.relativePath,
        protectedPath: link.relativePath,
        characterId: context.characterId,
      });
      throw new PathResolutionError(
        `This folder contains a protected document (${link.relativePath}) that characters may not move or delete. The operation was cancelled.`,
        'ACCESS_DENIED'
      );
    }
  }
}

/**
 * Build resolution context for a read operation. When the chat has
 * `allowCrossCharacterVaultReads` enabled, the vaults of other present
 * participants are added to `characterIds` so the path resolver admits them.
 */
export async function buildReadResolutionContext(
  input: QtapAddressableInput,
  context: DocEditToolContext
) {
  // Accept a qtap:// URI in place of scope/mount_point/path. Idempotent when the
  // handler already normalized (the common case), so this never double-parses.
  input = applyQtapUriToInput(input);
  const opaque = await actingCharacterIsOpaqueToVaults(context);
  if (opaque) {
    // No characterId / characterIds → resolver admits only project document
    // stores. Mount-point name lookups for character vaults won't resolve.
    return {
      projectId: context.projectId,
      mountPoint: input.mount_point,
      operatorOverride: context.operatorOverride,
    };
  }
  const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
  return {
    projectId: context.projectId,
    characterId: context.characterId,
    characterIds: peerCharacterIds.length > 0 ? peerCharacterIds : undefined,
    mountPoint: input.mount_point,
    operatorOverride: context.operatorOverride,
  };
}

/**
 * Build resolution context for a write operation. Peer vaults are never
 * admitted here; attempts to write to a peer's vault by name or ID raise
 * a clear read-only error before resolution runs.
 */
export async function buildWriteResolutionContext(
  input: QtapAddressableInput,
  context: DocEditToolContext
) {
  // Accept a qtap:// URI in place of scope/mount_point/path (see read builder).
  input = applyQtapUriToInput(input);
  const opaque = await actingCharacterIsOpaqueToVaults(context);
  if (opaque) {
    return {
      projectId: context.projectId,
      mountPoint: input.mount_point,
      operatorOverride: context.operatorOverride,
    };
  }
  const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
  await assertWriteDoesNotTargetPeerVault(input.mount_point, peerCharacterIds);
  return {
    projectId: context.projectId,
    characterId: context.characterId,
    mountPoint: input.mount_point,
    operatorOverride: context.operatorOverride,
  };
}

/**
 * Look up the project's "project-official" mount point — the canonical
 * `scope: 'project'` store. Returns null when the project has no
 * officialMountPointId, the mount is missing, or it's disabled. Callers can
 * then fall back to the legacy `<filesDir>/<projectId>/` walk for projects
 * that haven't been migrated yet.
 */
export interface OfficialProjectMount {
  id: string;
  name: string;
  basePath: string;
  mountType: 'filesystem' | 'obsidian' | 'database';
}

export async function resolveOfficialProjectMount(
  projectId: string | undefined
): Promise<OfficialProjectMount | null> {
  if (!projectId) return null;
  try {
    const repos = getRepositories();
    const project = await repos.projects.findById(projectId);
    if (!project?.officialMountPointId) return null;
    const mp = await repos.docMountPoints.findById(project.officialMountPointId);
    if (!mp || !mp.enabled) return null;
    return {
      id: mp.id,
      name: mp.name,
      basePath: mp.basePath,
      mountType: mp.mountType,
    };
  } catch (err) {
    logger.warn('Failed to resolve official project mount; treating project as un-migrated', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Trigger re-indexing and embedding for any write that lands in a mount
 * point. The gate is `mountPointId`, not `scope`: a `scope: 'project'`
 * write into a project's `officialMountPointId` mount needs the same
 * chunk/embed pass as a `scope: 'document_store'` write, otherwise the
 * file is invisible to search until the next periodic mount scan. Legacy
 * filesystem-only projects (no `officialMountPointId`) return without a
 * `mountPointId` and silently no-op here, as before.
 */

export async function triggerReindexIfNeeded(resolved: ResolvedPath): Promise<void> {
  if (resolved.mountPointId) {
    const mountPointId = resolved.mountPointId;
    const repos = getRepositories();
    // Fire-and-forget: don't block the tool response on re-indexing
    reindexSingleFile(mountPointId, resolved.relativePath, resolved.absolutePath)
      // Hard-linked siblings share these bytes and need their own chunk sets
      // rebuilt; on filesystem mounts the inode is already shared, so this is
      // purely the index catching up with what the OS did.
      .then(async () => {
        const { reindexLinkGroupSiblings } = await import('@/lib/mount-index/link-groups');
        await reindexLinkGroupSiblings(mountPointId, resolved.relativePath);
      })
      .then(() => Promise.all([
        enqueueEmbeddingJobsForMountPoint(mountPointId),
        repos.docMountPoints.refreshStats(mountPointId),
      ]))
      .catch(err => {
        logger.warn('Background re-index, embedding, or stats refresh failed', {
          path: resolved.relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }
}
