/**
 * Database-backed Document Store operations
 *
 * For mount points with mountType === 'database', document bytes live in
 * doc_mount_documents inside quilltap-mount-index.db — there is no
 * filesystem path. This module implements the same create/read/update/
 * delete/move/list operations that the filesystem path-resolver offers,
 * but routed through repositories.
 *
 * Each mutation:
 *   1. Updates the doc_mount_documents row (the source of truth).
 *   2. Keeps the mirror doc_mount_files row in sync so scan/search/
 *      embedding code continues to treat the store uniformly.
 *   3. Emits a db-store-events event so the watcher triggers an
 *      embedding re-index — the equivalent of chokidar 'change'.
 */

import path from 'path';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { sha256OfString } from '@/lib/utils/sha256';
import { getRepositories } from '@/lib/repositories/factory';
import type { DocMountFile, DocMountPoint } from '@/lib/schemas/mount-index.types';
import {
  emitDocumentDeleted,
  emitDocumentMoved,
  emitDocumentWritten,
} from './db-store-events';
import { detectNativeText } from './path-utils';

const logger = createServiceLogger('MountIndex:DatabaseStore');

function normaliseRelativePath(relativePath: string): string {
  // Collapse ./ and redundant separators, reject traversal. Path-resolver
  // already blocks '..' segments before we get here; keep a second guard.
  // Trailing slashes are stripped so folder paths match the form that
  // folder-paths.ts writes into doc_mount_folders.path (no trailing slash).
  const normalised = path
    .normalize(relativePath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (normalised.split('/').includes('..')) {
    throw new Error(`Invalid relative path: ${relativePath}`);
  }
  return normalised;
}

export class DatabaseStoreError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'UNSUPPORTED' | 'CONFLICT' | 'INVALID' | 'NOT_EMPTY') {
    super(message);
    this.name = 'DatabaseStoreError';
  }
}

// ============================================================================
// READ
// ============================================================================

export async function readDatabaseDocument(
  mountPointId: string,
  relativePath: string
): Promise<{ content: string; mtime: number; size: number }> {
  const repos = getRepositories();
  const rel = normaliseRelativePath(relativePath);
  const doc = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, rel);
  if (!doc) {
    throw new DatabaseStoreError(
      `Document not found in database-backed store: ${rel}`,
      'NOT_FOUND'
    );
  }
  return {
    content: doc.content,
    mtime: new Date(doc.lastModified).getTime(),
    size: doc.content.length,
  };
}

// ============================================================================
// WRITE (create or update)
// ============================================================================

export async function writeDatabaseDocument(
  mountPointId: string,
  relativePath: string,
  content: string,
  expectedMtime?: number
): Promise<{ mtime: number }> {
  const repos = getRepositories();
  const rel = normaliseRelativePath(relativePath);
  const fileType = detectNativeText(rel);
  if (!fileType) {
    throw new DatabaseStoreError(
      `Database-backed stores only accept text documents (.md, .markdown, .txt, .json, .jsonl, .ndjson). Got: ${path.extname(rel)}`,
      'UNSUPPORTED'
    );
  }

  const existing = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, rel);
  if (expectedMtime !== undefined && existing) {
    const currentMtime = new Date(existing.lastModified).getTime();
    if (currentMtime !== expectedMtime) {
      throw new DatabaseStoreError(
        `Document was modified by another process (mtime mismatch). Please reload and try again.`,
        'CONFLICT'
      );
    }
  }

  // Ensure folder exists and get its ID
  const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');
  const folderPath = path.dirname(rel);
  const folderId = folderPath !== '.' ? await ensureFolderPath(mountPointId, folderPath) : null;

  const contentSha256 = sha256OfString(content);
  const now = new Date().toISOString();
  const fileName = path.basename(rel);

  // linkDocumentContent handles the full content/link split: find-or-create
  // the file row by sha, upsert the document row, upsert the link row.
  await repos.docMountFileLinks.linkDocumentContent({
    mountPointId,
    relativePath: rel,
    fileName,
    folderId,
    fileType,
    content,
    contentSha256,
    plainTextLength: content.length,
    fileSizeBytes: Buffer.byteLength(content, 'utf-8'),
  });

  // Chunk the just-written content so it is immediately searchable. The write
  // above only records the document + link row (chunkCount 0); without this the
  // embedding scheduler triggered by emitDocumentWritten below would find no
  // chunks, and the document would stay unsearchable until a manual rescan.
  // reindexSingleFile reads the content back from doc_mount_documents and
  // (re)builds the link's chunks, so an overwrite re-chunks too.
  //
  // Parent-only: inside the forked job child this write is buffered (read-your-
  // writes does not hold), so the content reindexSingleFile would read isn't
  // committed yet. In-child writers (doc_write_file in autonomous turns) leave
  // chunking to the next database rescan, as before. Bridge writers
  // (conversation summaries, avatars) already run this on the parent via
  // host-RPC, so their documents chunk here.
  if (process.env.QUILLTAP_JOB_CHILD !== '1') {
    try {
      const { reindexSingleFile } = await import('@/lib/doc-edit/reindex-file');
      await reindexSingleFile(mountPointId, rel, '');
    } catch (chunkErr) {
      logger.warn('Failed to chunk database document after write', {
        mountPointId,
        relativePath: rel,
        error: chunkErr instanceof Error ? chunkErr.message : String(chunkErr),
      });
    }

    // linkDocumentContent has already repointed every member of this file's
    // hard-link group at the new content row, but chunks are per-link: without
    // this pass a sibling path would keep serving the previous revision's
    // chunks to search and to character context.
    try {
      const { reindexLinkGroupSiblings } = await import('@/lib/mount-index/link-groups');
      await reindexLinkGroupSiblings(mountPointId, rel);
    } catch (groupErr) {
      logger.warn('Failed to re-index hard-link group after database write', {
        mountPointId,
        relativePath: rel,
        error: groupErr instanceof Error ? groupErr.message : String(groupErr),
      });
    }
  }

  emitDocumentWritten({ mountPointId, relativePath: rel });

  const mtime = new Date(now).getTime();
  return { mtime };
}

// ============================================================================
// DELETE
// ============================================================================

export async function deleteDatabaseDocument(
  mountPointId: string,
  relativePath: string
): Promise<boolean> {
  const repos = getRepositories();
  const rel = normaliseRelativePath(relativePath);
  // Delete the link with GC. Chunks cascade off the link, and the document
  // cascades off the file row if this was the last link.
  const link = await repos.docMountFileLinks.findByMountPointAndPath(mountPointId, rel);
  if (!link) return false;

  await repos.docMountFileLinks.deleteWithGC(link.id);

  emitDocumentDeleted({ mountPointId, relativePath: rel });
  return true;
}

// ============================================================================
// MOVE / RENAME
// ============================================================================

export async function moveDatabaseDocument(
  mountPointId: string,
  fromRelativePath: string,
  toRelativePath: string
): Promise<void> {
  const repos = getRepositories();
  const fromRel = normaliseRelativePath(fromRelativePath);
  const toRel = normaliseRelativePath(toRelativePath);

  const existing = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, fromRel);
  if (!existing) {
    throw new DatabaseStoreError(
      `Source document not found: ${fromRel}`,
      'NOT_FOUND'
    );
  }
  const fileType = detectNativeText(toRel);
  if (!fileType) {
    throw new DatabaseStoreError(
      `Target path has unsupported extension: ${path.extname(toRel)}`,
      'UNSUPPORTED'
    );
  }
  // Case-only rename of the same document (notes.md → Notes.md) is allowed —
  // the case-insensitive lookup would otherwise find the source itself and
  // report a bogus conflict.
  const caseOnlyRename = fromRel !== toRel && fromRel.toLowerCase() === toRel.toLowerCase();
  if (!caseOnlyRename) {
    const conflict = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, toRel);
    if (conflict) {
      throw new DatabaseStoreError(
        `Target already exists: ${toRel}`,
        'CONFLICT'
      );
    }
  }

  // Ensure destination folder exists and get its ID
  const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');
  const destFolderPath = path.dirname(toRel);
  const destFolderId = destFolderPath !== '.' ? await ensureFolderPath(mountPointId, destFolderPath) : null;

  // Move = update the link row at the source path. fileType lives on the
  // content row so it doesn't move with the rename, but the fileType
  // detected from the new path may differ; we update the file row's
  // fileType when it changed.
  const link = await repos.docMountFileLinks.findByMountPointAndPath(mountPointId, fromRel);
  if (link) {
    await repos.docMountFileLinks.update(link.id, {
      relativePath: toRel,
      fileName: path.basename(toRel),
      folderId: destFolderId,
    });
    if (link.fileType !== fileType) {
      await repos.docMountFiles.update(link.fileId, { fileType });
    }
  }

  emitDocumentMoved({ mountPointId, fromRelativePath: fromRel, toRelativePath: toRel });
}

// ============================================================================
// LIST (for doc_list_files support)
// ============================================================================

/**
 * Listing entry — folders are synthesized to look enough like file links
 * for the doc_list_files tool / Scriptorium UI to render a unified tree.
 */
export interface DatabaseFileListEntry {
  id: string;
  mountPointId: string;
  relativePath: string;
  fileName: string;
  fileType: DocMountFile['fileType'];
  sha256: string;
  fileSizeBytes: number;
  lastModified: string;
  source: DocMountFile['source'];
  folderId: string | null;
  kind?: 'file' | 'folder';
}

export async function listDatabaseFiles(
  mountPointId: string,
  options: { folder?: string } = {}
): Promise<DatabaseFileListEntry[]> {
  const repos = getRepositories();
  const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);

  // Get folders for this mount point
  const folders = await repos.docMountFolders.findByMountPointId(mountPointId);

  // Build the result entries
  const entries: DatabaseFileListEntry[] = [];

  // Normalise folder input. Stored paths don't carry leading or trailing
  // slashes (see folder-paths.ts normalizePath + database-store
  // normaliseRelativePath), so any '/' here must be stripped before we
  // compare. Treat '', '/', '//' etc. the same as "no filter" → root.
  const normalisedFolder = (options.folder ?? '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  const folderEntry = (folder: typeof folders[number]): DatabaseFileListEntry => ({
    id: folder.id,
    mountPointId: folder.mountPointId,
    relativePath: folder.path,
    fileName: path.basename(folder.path),
    fileType: 'markdown',
    sha256: '',
    fileSizeBytes: 0,
    lastModified: folder.createdAt,
    source: 'database',
    folderId: folder.parentId ?? null,
    kind: 'folder',
  });

  const linkToEntry = (link: typeof links[number]): DatabaseFileListEntry => ({
    id: link.id,
    mountPointId: link.mountPointId,
    relativePath: link.relativePath,
    fileName: link.fileName,
    fileType: link.fileType,
    sha256: link.sha256,
    fileSizeBytes: link.fileSizeBytes,
    lastModified: link.lastModified,
    source: link.source,
    folderId: link.folderId ?? null,
    kind: 'file',
  });

  if (!normalisedFolder) {
    for (const link of links) {
      entries.push(linkToEntry(link));
    }
    for (const folder of folders) {
      entries.push(folderEntry(folder));
    }
    return entries;
  }

  // Filter to a specific folder.
  const folderPrefix = `${normalisedFolder}/`;

  for (const link of links) {
    if (link.relativePath.startsWith(folderPrefix)) {
      entries.push(linkToEntry(link));
    }
  }

  for (const folder of folders) {
    if (folder.path.startsWith(folderPrefix)) {
      entries.push(folderEntry(folder));
    }
  }

  return entries;
}

// ============================================================================
// FOLDER OPERATIONS
// ============================================================================

export async function createDatabaseFolder(
  mountPointId: string,
  folderPath: string
): Promise<{ folderId: string; path: string }> {
  const rel = normaliseRelativePath(folderPath);
  const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');

  const folderId = await ensureFolderPath(mountPointId, rel);
  const resultPath = rel || '';

  return { folderId: folderId || '', path: resultPath };
}

export async function deleteDatabaseFolder(
  mountPointId: string,
  folderPath: string
): Promise<{ deleted: boolean }> {
  const rel = normaliseRelativePath(folderPath);
  const repos = getRepositories();

  // Find the folder
  const folder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, rel);
  if (!folder) {
    throw new DatabaseStoreError(
      `Folder not found: ${folderPath}`,
      'NOT_FOUND'
    );
  }

  // Check if it has contents
  const { folderHasContents } = await import('@/lib/mount-index/folder-paths');
  const hasContents = await folderHasContents(mountPointId, folder.id);
  if (hasContents) {
    throw new DatabaseStoreError(
      `Folder is not empty: ${folderPath}. Only empty folders can be deleted.`,
      'NOT_EMPTY'
    );
  }

  // Delete the folder row
  await repos.docMountFolders.delete(folder.id);

  return { deleted: true };
}

export async function moveDatabaseFolder(
  mountPointId: string,
  fromPath: string,
  toPath: string
): Promise<void> {
  const repos = getRepositories();
  const fromRel = normaliseRelativePath(fromPath);
  const toRel = normaliseRelativePath(toPath);

  // Resolve the source folder
  const sourceFolder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, fromRel);
  if (!sourceFolder) {
    throw new DatabaseStoreError(
      `Source folder not found: ${fromPath}`,
      'NOT_FOUND'
    );
  }

  // Check destination doesn't exist. The lookup is case-insensitive, so a
  // case-only rename of the folder itself (lore → Lore) finds the source
  // row — that's allowed; any OTHER folder at the destination (in any
  // casing) is a conflict.
  const destFolder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, toRel);
  if (destFolder && destFolder.id !== sourceFolder.id) {
    throw new DatabaseStoreError(
      `Destination folder already exists: ${toPath}`,
      'CONFLICT'
    );
  }

  // Ensure parent of destination exists
  const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');
  const destDir = path.dirname(toRel);
  if (destDir !== '.') {
    await ensureFolderPath(mountPointId, destDir);
  }

  // Get destination parent folder ID
  let destParentId: string | null = null;
  let destParentPath = '';
  if (destDir !== '.') {
    const parentFolder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, destDir);
    if (parentFolder) {
      destParentId = parentFolder.id;
      destParentPath = parentFolder.path;
    }
  }

  // Canonicalise: the destination directory may have been addressed in a
  // different casing than its stored path; the source's descendants share the
  // source's STORED path prefix, not necessarily the caller-typed one.
  const newName = path.basename(toRel);
  const canonicalToRel = destParentPath ? `${destParentPath}/${newName}` : newName;
  const oldPrefix = `${sourceFolder.path}/`;
  const newPrefix = `${canonicalToRel}/`;

  const movedDocuments: Array<{ oldPath: string; newPath: string }> = [];

  // Update the source folder row itself
  await repos.docMountFolders.update(sourceFolder.id, {
    parentId: destParentId,
    name: newName,
    path: canonicalToRel,
  });

  // Update all descendant folder paths
  const allFolders = await repos.docMountFolders.findByMountPointId(mountPointId);
  for (const folder of allFolders) {
    if (folder.id === sourceFolder.id) continue;
    if (oldPrefix && folder.path.startsWith(oldPrefix)) {
      const newPath = newPrefix + folder.path.substring(oldPrefix.length);
      await repos.docMountFolders.update(folder.id, {
        path: newPath,
      });
    }
  }

  // Walk every link in the mount and rewrite its relativePath + folderId
  // when it falls inside the renamed folder. Post-refactor, path/folder
  // membership lives entirely on doc_mount_file_links — documents and
  // blobs are content-addressable and don't know where they appear.
  const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);
  for (const link of links) {
    if (oldPrefix && link.relativePath.startsWith(oldPrefix)) {
      const newPath = newPrefix + link.relativePath.substring(oldPrefix.length);
      const newFolderPath = path.dirname(newPath);
      let newFolderId: string | null = null;
      if (newFolderPath !== '.') {
        const newFolder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, newFolderPath);
        if (newFolder) newFolderId = newFolder.id;
      }
      await repos.docMountFileLinks.update(link.id, {
        relativePath: newPath,
        fileName: path.basename(newPath),
        folderId: newFolderId,
      });
      // Documents (text content) track their old path in event payloads.
      if (link.fileType !== 'blob') {
        movedDocuments.push({
          oldPath: link.relativePath,
          newPath,
        });
      }
    }
  }

  // Emit events after all updates (don't hold locks)
  for (const doc of movedDocuments) {
    emitDocumentMoved({
      mountPointId,
      fromRelativePath: doc.oldPath,
      toRelativePath: doc.newPath,
    });
  }
}

export async function backfillFolderRowsForMountPoint(
  mountPointId: string
): Promise<{ foldersCreated: number; filesUpdated: number }> {
  const repos = getRepositories();
  const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');

  let foldersCreated = 0;
  let filesUpdated = 0;
  const createdPaths = new Set<string>();

  try {
    // After the content/link split, folder membership lives on the link
    // row. One pass over links covers documents, blobs, and other files.
    const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);
    for (const link of links) {
      const folderPath = path.dirname(link.relativePath);
      if (folderPath !== '.') {
        const folderId = await ensureFolderPath(mountPointId, folderPath);
        if (!createdPaths.has(folderPath)) {
          foldersCreated++;
          createdPaths.add(folderPath);
        }
        if (link.folderId !== folderId) {
          await repos.docMountFileLinks.update(link.id, { folderId });
          filesUpdated++;
        }
      }
    }

    logger.info('Backfilled folder rows for mount point', {
      mountPointId,
      foldersCreated,
      filesUpdated,
    });

    return { foldersCreated, filesUpdated };
  } catch (error) {
    logger.error('Failed to backfill folder rows for mount point', {
      mountPointId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// EXISTENCE / FOLDER SEMANTICS
// ============================================================================

export async function databaseDocumentExists(
  mountPointId: string,
  relativePath: string
): Promise<boolean> {
  const repos = getRepositories();
  const rel = normaliseRelativePath(relativePath);
  const doc = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, rel);
  return doc !== null;
}

export async function databaseFolderExists(
  mountPointId: string,
  relativePath: string
): Promise<boolean> {
  const repos = getRepositories();
  const rel = normaliseRelativePath(relativePath);
  const folder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, rel);
  return folder !== null;
}

/**
 * Rehydrate (rechunk) all documents in a database-backed mount point.
 * Used by the scan endpoint for DB-backed stores — the filesystem scanner
 * has nothing to walk, so the equivalent operation is to re-chunk every
 * document whose content sha has drifted from its file-record sha (or for
 * which chunks simply don't exist yet, as happens after a fresh import),
 * then emit write events so the embedding scheduler picks up the new
 * null-embedding chunks.
 */
export async function rescanDatabaseMountPoint(mountPoint: DocMountPoint): Promise<number> {
  if (mountPoint.mountType !== 'database') {
    throw new Error('rescanDatabaseMountPoint called on non-database mount point');
  }
  const repos = getRepositories();
  // Lazy import to avoid a circular dep with the doc-edit module.
  const { reindexSingleFile } = await import('@/lib/doc-edit/reindex-file');

  // After the content/link split, every database-backed document has a
  // link row with conversionStatus + chunkCount + sha (joined view). Walk
  // links instead of documents to drive the rescan.
  const links = await repos.docMountFileLinks.findByMountPointId(mountPoint.id);
  const docLinks = links.filter(l => l.fileType !== 'blob');
  let rechunked = 0;

  for (const link of docLinks) {
    const needsRechunk =
      link.chunkCount === 0 ||
      link.conversionStatus !== 'converted';

    if (needsRechunk) {
      try {
        await reindexSingleFile(mountPoint.id, link.relativePath, '');
        rechunked++;
      } catch (err) {
        logger.warn('Failed to re-chunk database document during rescan', {
          mountPointId: mountPoint.id,
          relativePath: link.relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    emitDocumentWritten({ mountPointId: mountPoint.id, relativePath: link.relativePath });
  }
  logger.info('Rescanned database mount point', {
    mountPointId: mountPoint.id,
    documents: docLinks.length,
    rechunked,
  });
  return docLinks.length;
}
