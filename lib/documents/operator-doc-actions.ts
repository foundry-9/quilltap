/**
 * Operator Document Actions — shared core
 *
 * Chat-agnostic mechanics behind Document Mode's operator actions: path
 * resolution (with the operator override), existence probing, blank-document
 * naming, read/write with mtime conflict detection, rename/delete file
 * mechanics, and store listing. Two routes drive this core:
 *
 * - `/api/v1/chats/[id]?action=…-document` — the chat-scoped route, which adds
 *   chat_documents row tracking and Librarian announcements on top.
 * - `/api/v1/documents?action=…` — the chat-less standalone route (the left
 *   rail's Document Mode), which uses the core directly: no chat rows, no
 *   Librarian, nobody to announce to.
 *
 * @module lib/documents/operator-doc-actions
 */

import { logger } from '@/lib/logger';
import {
  resolveDocEditPath,
  readFileWithMtime,
  writeFileWithMtimeCheck,
  reindexSingleFile,
  isTextFile,
  type DocEditScope,
  type ResolvedPath,
} from '@/lib/doc-edit';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import { mimeForExtension } from '@/lib/mount-index/path-utils';
import {
  moveDatabaseDocument,
  deleteDatabaseDocument,
  readDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';
import { getErrorMessage } from '@/lib/error-utils';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import path from 'path';
import fs from 'fs/promises';

/**
 * Who is reaching for documents: the chat route fills this from the chat's
 * project and character participants; the standalone route passes an empty
 * context (no project, no characters) and relies on the operator override.
 */
export interface DocumentAccessContext {
  projectId?: string;
  characterIds: string[];
}

/** An access context with nothing behind it — the standalone (chat-less) caller. */
export const STANDALONE_ACCESS_CONTEXT: DocumentAccessContext = Object.freeze({
  projectId: undefined,
  characterIds: [],
});

/** The file already exists where a rename/create wants to land. */
export class DocumentConflictError extends Error {}

/** The requested document does not exist. */
export class DocumentMissingError extends Error {}

/**
 * Resolve a document path for an operator-driven Document Mode action
 * (open/read/write/rename/delete from the UI). The operator may reach any
 * enabled store — including ones picked via the picker's "look everywhere"
 * mode and the chat-less standalone surface. Character doc tools use a
 * separate code path and never get this override.
 */
export async function resolveOperatorDocPath(
  ctx: DocumentAccessContext,
  params: {
    scope: DocEditScope;
    filePath: string;
    mountPoint?: string;
    /** Resolves the reserved `self` mount token to this character's vault. */
    characterId?: string;
  },
): Promise<ResolvedPath> {
  return resolveDocEditPath(params.scope, params.filePath, {
    projectId: ctx.projectId,
    characterIds: ctx.characterIds,
    characterId: params.characterId,
    mountPoint: params.mountPoint,
    operatorOverride: true,
  });
}

/**
 * Probe whether a resolved doc-edit path currently has a file. Database-backed
 * stores answer via readDatabaseDocument (NOT_FOUND → false); filesystem
 * scopes use fs.access. Any other error bubbles, since we don't want to
 * silently treat permission failures as "doesn't exist" and overwrite.
 */
export async function resolvedPathExists(resolved: ResolvedPath): Promise<boolean> {
  if (resolved.mountType === 'database') {
    if (!resolved.mountPointId) {
      throw new Error('Database-backed ResolvedPath is missing mountPointId');
    }
    try {
      await readDatabaseDocument(resolved.mountPointId, resolved.relativePath);
      return true;
    } catch (error) {
      if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') {
        return false;
      }
      throw error;
    }
  }

  try {
    await fs.access(resolved.absolutePath);
    return true;
  } catch (error) {
    const code = error instanceof Error && 'code' in error
      ? (error as NodeJS.ErrnoException).code
      : undefined;
    if (code === 'ENOENT') return false;
    throw error;
  }
}

/** Classify a resolved target for qtap:// link gating: document, image, or other. */
export async function classifyResolvedTarget(
  repos: RepositoryContainer,
  resolved: ResolvedPath,
): Promise<'document' | 'image' | 'other'> {
  if (isTextFile(resolved.relativePath)) {
    return 'document';
  }

  const extensionMime = mimeForExtension(resolved.relativePath);
  if (extensionMime.startsWith('image/')) {
    return 'image';
  }

  if (resolved.mountType === 'database' && resolved.mountPointId) {
    const link = await repos.docMountFileLinks.findByMountPointAndPath(
      resolved.mountPointId,
      resolved.relativePath,
    );
    if (link?.fileType === 'blob') {
      const blob = await repos.docMountBlobs.findByFileId(link.fileId);
      if (blob?.storedMimeType?.startsWith('image/')) {
        return 'image';
      }
    }
  }

  return 'other';
}

/**
 * Pick an unused "Untitled Document.md" filename inside `targetFolder`.
 * On collision, appends a counter ("Untitled Document 2.md", etc.). Returns
 * both the relative file path (for tracking rows and rename math) and the
 * resolved path it lives at (so the caller can write without a second
 * resolution round-trip).
 */
export async function pickUntitledDocumentPath(
  ctx: DocumentAccessContext,
  scope: DocEditScope,
  mountPoint: string | undefined,
  targetFolder: string | undefined,
): Promise<{ filePath: string; resolved: ResolvedPath }> {
  const folder = (targetFolder ?? '').replace(/^\/+|\/+$/g, '');
  const join = (name: string) => (folder ? `${folder}/${name}` : name);
  const MAX_ATTEMPTS = 1000;

  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const candidate = i === 1 ? 'Untitled Document.md' : `Untitled Document ${i}.md`;
    const filePath = join(candidate);
    const resolved = await resolveOperatorDocPath(ctx, { scope, filePath, mountPoint });
    if (!(await resolvedPathExists(resolved))) {
      return { filePath, resolved };
    }
  }

  // Defensive: if a thousand "Untitled Document N.md" already exist, fall
  // back to a UUID so the user can still create a new doc.
  const filePath = join(`Untitled Document ${crypto.randomUUID()}.md`);
  const resolved = await resolveOperatorDocPath(ctx, { scope, filePath, mountPoint });
  return { filePath, resolved };
}

/** Fire-and-forget re-index + embedding + stats refresh after a store write. */
export function scheduleDocumentStoreRefresh(
  mountPointId: string,
  relativePath: string,
  absolutePath: string,
  repos: RepositoryContainer,
  filePath: string,
): void {
  reindexSingleFile(mountPointId, relativePath, absolutePath)
    .then(() => Promise.all([
      enqueueEmbeddingJobsForMountPoint(mountPointId),
      repos.docMountPoints.refreshStats(mountPointId),
    ]))
    .catch(err => {
      logger.warn('Background re-index, embedding, or stats refresh failed after document save', {
        path: filePath,
        error: getErrorMessage(err),
      });
    });
}

export interface OpenDocumentFileParams {
  filePath?: string;
  title?: string;
  scope: DocEditScope;
  mountPoint?: string;
  /** Folder (relative to scope root) for a new blank document; ignored when `filePath` is set. */
  targetFolder?: string;
}

export interface OpenedDocumentFile {
  filePath: string;
  displayTitle: string;
  content: string;
  mtime?: number;
  /** True when a new blank document was created (no `filePath` was given). */
  isNew: boolean;
}

/**
 * The file half of opening a document: read an existing file, or pick an
 * unused "Untitled Document.md" name and create it blank. Throws
 * {@link DocumentMissingError} when a named file can't be read.
 */
export async function openDocumentFile(
  ctx: DocumentAccessContext,
  params: OpenDocumentFileParams,
): Promise<OpenedDocumentFile> {
  if (params.filePath) {
    let content: string;
    let mtime: number | undefined;
    try {
      const resolved = await resolveOperatorDocPath(ctx, {
        scope: params.scope,
        filePath: params.filePath,
        mountPoint: params.mountPoint,
      });
      const fileData = await readFileWithMtime(resolved);
      content = fileData.content;
      mtime = fileData.mtime;
    } catch (error) {
      logger.debug('openDocumentFile: file not readable', {
        filePath: params.filePath,
        scope: params.scope,
        mountPoint: params.mountPoint,
        error: getErrorMessage(error),
      });
      throw new DocumentMissingError(`File not found: ${params.filePath}`);
    }
    return {
      filePath: params.filePath,
      displayTitle: params.title || path.basename(params.filePath),
      content,
      mtime,
      isNew: false,
    };
  }

  const picked = await pickUntitledDocumentPath(
    ctx,
    params.scope,
    params.mountPoint,
    params.targetFolder,
  );
  const writeResult = await writeFileWithMtimeCheck(picked.resolved, '');
  return {
    filePath: picked.filePath,
    displayTitle: params.title || path.basename(picked.filePath),
    content: '',
    mtime: writeResult.mtime,
    isNew: true,
  };
}

/**
 * Write a document's content with mtime conflict detection, scheduling the
 * store re-index for document_store scope. Propagates the mtime-mismatch
 * error from {@link writeFileWithMtimeCheck} for the route to map to a 409.
 */
export async function writeDocumentFile(
  ctx: DocumentAccessContext,
  repos: RepositoryContainer,
  params: {
    filePath: string;
    scope: DocEditScope;
    mountPoint?: string;
    content: string;
    mtime?: number;
  },
): Promise<{ mtime: number }> {
  const resolved = await resolveOperatorDocPath(ctx, {
    scope: params.scope,
    filePath: params.filePath,
    mountPoint: params.mountPoint,
  });

  const { mtime } = await writeFileWithMtimeCheck(resolved, params.content, params.mtime);

  if (params.scope === 'document_store' && resolved.mountPointId) {
    scheduleDocumentStoreRefresh(
      resolved.mountPointId,
      resolved.relativePath,
      resolved.absolutePath,
      repos,
      params.filePath,
    );
  }

  return { mtime };
}

export type RenameTarget =
  | { ok: true; newFilePath: string; newDisplayTitle: string }
  | { ok: false; reason: string };

/**
 * Turn a user-typed title into the rename target path: the input is the new
 * basename (directory preserved); a missing extension inherits the old one so
 * users can type "backstory" and get "backstory.md". Path separators are
 * rejected — this is a rename within the current directory, not a move.
 */
export function computeRenameTarget(currentFilePath: string, newTitle: string): RenameTarget {
  const raw = newTitle.trim();
  if (!raw) {
    return { ok: false, reason: 'Name cannot be empty' };
  }
  if (raw.includes('/') || raw.includes('\\')) {
    return { ok: false, reason: 'Name cannot contain path separators' };
  }
  if (raw === '.' || raw === '..' || raw.split(/[\\/]/).includes('..')) {
    return { ok: false, reason: 'Invalid name' };
  }

  const oldExt = path.extname(currentFilePath);
  const oldDir = path.dirname(currentFilePath);
  const newBasename = path.extname(raw) ? raw : `${raw}${oldExt}`;
  const newFilePath = oldDir === '.' || oldDir === ''
    ? newBasename
    : `${oldDir.replace(/\\/g, '/')}/${newBasename}`;

  return { ok: true, newFilePath, newDisplayTitle: path.basename(newFilePath) };
}

/**
 * Move a document's underlying file to its rename target. Dispatches on mount
 * type: database-backed stores route through moveDatabaseDocument while
 * filesystem-backed scopes use fs.rename (matching the pattern in
 * doc_move_file). Throws {@link DocumentConflictError} when the destination is
 * taken; DatabaseStoreError UNSUPPORTED bubbles for the route to map.
 */
export async function renameDocumentFile(
  ctx: DocumentAccessContext,
  repos: RepositoryContainer,
  params: {
    scope: DocEditScope;
    mountPoint?: string;
    oldFilePath: string;
    newFilePath: string;
  },
): Promise<void> {
  const resolvedOld = await resolveOperatorDocPath(ctx, {
    scope: params.scope,
    filePath: params.oldFilePath,
    mountPoint: params.mountPoint,
  });
  const resolvedNew = await resolveOperatorDocPath(ctx, {
    scope: params.scope,
    filePath: params.newFilePath,
    mountPoint: params.mountPoint,
  });

  if (resolvedOld.mountType === 'database' && resolvedOld.mountPointId) {
    try {
      await moveDatabaseDocument(
        resolvedOld.mountPointId,
        resolvedOld.relativePath,
        resolvedNew.relativePath,
      );
    } catch (error) {
      if (error instanceof DatabaseStoreError && error.code === 'CONFLICT') {
        throw new DocumentConflictError('A file already exists at that name.');
      }
      throw error;
    }
    return;
  }

  try {
    await fs.access(resolvedNew.absolutePath);
    throw new DocumentConflictError('A file already exists at that name.');
  } catch (error) {
    if (error instanceof DocumentConflictError) throw error;
    // destination free — proceed
  }
  await fs.mkdir(path.dirname(resolvedNew.absolutePath), { recursive: true });
  await fs.rename(resolvedOld.absolutePath, resolvedNew.absolutePath);

  if (params.scope === 'document_store' && resolvedOld.mountPointId) {
    scheduleDocumentStoreRefresh(
      resolvedOld.mountPointId,
      resolvedNew.relativePath,
      resolvedNew.absolutePath,
      repos,
      params.newFilePath,
    );
  }
}

/**
 * Delete a document's underlying file. Database-backed stores route through
 * deleteDatabaseDocument; filesystem scopes use fs.unlink. Returns a status
 * for the route to map ('not-found' → 404, 'not-a-file' → 400).
 */
export async function deleteDocumentFile(
  ctx: DocumentAccessContext,
  params: {
    scope: DocEditScope;
    mountPoint?: string;
    filePath: string;
  },
): Promise<'deleted' | 'not-found' | 'not-a-file'> {
  const resolved = await resolveOperatorDocPath(ctx, {
    scope: params.scope,
    filePath: params.filePath,
    mountPoint: params.mountPoint,
  });

  if (resolved.mountType === 'database' && resolved.mountPointId) {
    const deleted = await deleteDatabaseDocument(resolved.mountPointId, resolved.relativePath);
    return deleted ? 'deleted' : 'not-found';
  }

  try {
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) {
      return 'not-a-file';
    }
  } catch {
    return 'not-found';
  }
  await fs.unlink(resolved.absolutePath);
  return 'deleted';
}

/**
 * Kind of an accessible store, used by the picker to bucket the right-column
 * accordions. `character` → a character vault; `document-store` → any other
 * document store.
 */
export type AccessibleStoreKind = 'character' | 'document-store';

export interface AccessibleStoreOption {
  /** Mount point UUID — used to list files (`/api/v1/mount-points/:id/files`). */
  mountPointId: string;
  /**
   * The mount point's canonical name. This is what document opens resolve
   * against (`resolveDocEditPath` matches `document_store` scope by name), so
   * it must be the real mount name, not a display alias.
   */
  name: string;
  /** Display label for the row — character name for vaults, store name otherwise. */
  label: string;
  kind: AccessibleStoreKind;
  mountType: 'filesystem' | 'obsidian' | 'database';
  storeType: 'documents' | 'character';
  /** Present for `kind: 'character'`. */
  characterId?: string;
  /**
   * True when this store is reachable via a group membership of some character
   * participant. The picker buckets these into a dedicated "Group Files"
   * accordion. Only the chat route can know this — the standalone route never
   * sets it.
   */
  isGroupStore?: boolean;
}

/**
 * Every enabled store — the "look everywhere" listing. Character vaults are
 * labelled by their owning character's name. `exclude` holds back stores the
 * caller surfaces elsewhere (the chat route's project-official mount);
 * `groupMountIds` lets the chat route tag its reachable group stores.
 */
export async function listAllEnabledStores(
  repos: RepositoryContainer,
  opts: { exclude?: Set<string>; groupMountIds?: Set<string> } = {},
): Promise<AccessibleStoreOption[]> {
  const exclude = opts.exclude ?? new Set<string>();
  const groupMountIds = opts.groupMountIds ?? new Set<string>();

  const [mounts, characters] = await Promise.all([
    repos.docMountPoints.findEnabled(),
    repos.characters.findAll(),
  ]);
  // Reverse-map character vaults to their owning character for labelling.
  const vaultOwner = new Map<string, { id: string; name: string }>();
  for (const c of characters) {
    if (c.characterDocumentMountPointId) {
      vaultOwner.set(c.characterDocumentMountPointId, { id: c.id, name: c.name });
    }
  }

  const stores: AccessibleStoreOption[] = [];
  for (const mp of mounts) {
    if (exclude.has(mp.id)) continue;
    exclude.add(mp.id);
    const isCharacter = mp.storeType === 'character';
    const owner = isCharacter ? vaultOwner.get(mp.id) : undefined;
    stores.push({
      mountPointId: mp.id,
      name: mp.name,
      label: owner?.name ?? mp.name,
      kind: isCharacter ? 'character' : 'document-store',
      mountType: mp.mountType,
      storeType: mp.storeType,
      ...(owner ? { characterId: owner.id } : {}),
      ...(groupMountIds.has(mp.id) ? { isGroupStore: true } : {}),
    });
  }
  return stores;
}
