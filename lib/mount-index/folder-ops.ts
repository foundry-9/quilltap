/**
 * Mount-point folder operations — delete and move, across both storage types.
 *
 * Database-backed mounts delegate to the tested `database-store` folder
 * functions (explicit `doc_mount_folders` rows). Filesystem mounts operate on
 * disk and reconcile the affected `doc_mount_file_links` rows so search/read
 * keep resolving after the move. Folder *create* lives elsewhere
 * (`folders/route.ts` → `createDatabaseFolder` / `createFilesystemFolder`);
 * this module is the delete/move companion the action-dispatch route calls.
 *
 * @module mount-index/folder-ops
 */

import path from 'path';
import { promises as fs } from 'fs';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';
import { FileOpError } from './file-op-error';
import { normaliseRelativePath } from './path-utils';
import { resolveFsAbsolute } from './file-ops';
import { deleteDatabaseFolder, moveDatabaseFolder } from './database-store';
import { emitDocumentMoved } from './db-store-events';

const logger = createServiceLogger('MountIndex:FolderOps');

function isFilesystemMount(mp: DocMountPoint): boolean {
  return mp.mountType === 'filesystem' || mp.mountType === 'obsidian';
}

async function loadMount(mountPointId: string): Promise<DocMountPoint> {
  const repos = getRepositories();
  const mp = await repos.docMountPoints.findById(mountPointId);
  if (!mp) throw new FileOpError(`Mount point not found: ${mountPointId}`, 'MOUNT_NOT_FOUND');
  return mp;
}

export interface FolderOpResult {
  mountPointId: string;
  path: string;
}

/**
 * Delete an empty folder. Refuses non-empty folders (parallels the file
 * delete's safety): callers must clear contents first.
 */
export async function deleteFolder(input: {
  mountPointId: string;
  relativePath: string;
}): Promise<FolderOpResult> {
  const mp = await loadMount(input.mountPointId);
  const rel = normaliseRelativePath(input.relativePath);

  if (!isFilesystemMount(mp)) {
    // Throws DatabaseStoreError NOT_FOUND / NOT_EMPTY → mapped by fileOpStatus.
    await deleteDatabaseFolder(mp.id, rel);
    return { mountPointId: mp.id, path: rel };
  }

  const abs = resolveFsAbsolute(mp, rel);
  let entries: string[];
  try {
    entries = await fs.readdir(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FileOpError(`Folder not found: ${rel}`, 'SOURCE_NOT_FOUND');
    }
    throw err;
  }
  if (entries.length > 0) {
    throw new FileOpError(`Folder is not empty: ${rel}. Only empty folders can be deleted.`, 'CONFLICT');
  }
  await fs.rmdir(abs);
  return { mountPointId: mp.id, path: rel };
}

/**
 * Move/rename a folder and everything under it.
 */
export async function moveFolder(input: {
  mountPointId: string;
  fromPath: string;
  toPath: string;
}): Promise<{ mountPointId: string; fromPath: string; toPath: string }> {
  const mp = await loadMount(input.mountPointId);
  const fromRel = normaliseRelativePath(input.fromPath);
  const toRel = normaliseRelativePath(input.toPath);

  if (fromRel === toRel) {
    throw new FileOpError(`Source and destination are the same folder: ${toRel}`, 'INVALID_PATH');
  }

  if (!isFilesystemMount(mp)) {
    await moveDatabaseFolder(mp.id, fromRel, toRel);
    return { mountPointId: mp.id, fromPath: fromRel, toPath: toRel };
  }

  // Filesystem mount: rename on disk, then rewrite the affected link rows so
  // search/read keep resolving. fs links live in doc_mount_file_links with the
  // path the scanner indexed; rewriting the prefix keeps them pointing at the
  // moved bytes until the next full scan.
  const repos = getRepositories();
  const fromAbs = resolveFsAbsolute(mp, fromRel);
  const toAbs = resolveFsAbsolute(mp, toRel);

  try {
    await fs.access(fromAbs);
  } catch {
    throw new FileOpError(`Folder not found: ${fromRel}`, 'SOURCE_NOT_FOUND');
  }
  // Case-only rename (lore → Lore): on a case-insensitive filesystem the
  // destination probe would find the source itself, so skip it — fs.rename
  // handles the casing change in place.
  const caseOnlyRename = fromRel.toLowerCase() === toRel.toLowerCase();
  if (!caseOnlyRename) {
    try {
      await fs.access(toAbs);
      throw new FileOpError(`Destination already exists: ${toRel}`, 'DEST_EXISTS');
    } catch (err) {
      if (err instanceof FileOpError) throw err;
      // ENOENT is the happy path (destination free).
    }
  }

  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);

  const oldPrefix = `${fromRel}/`;
  const newPrefix = `${toRel}/`;
  const links = await repos.docMountFileLinks.findByMountPointId(mp.id);
  for (const link of links) {
    if (!link.relativePath.startsWith(oldPrefix)) continue;
    const newPath = newPrefix + link.relativePath.slice(oldPrefix.length);
    await repos.docMountFileLinks.update(link.id, {
      relativePath: newPath,
      fileName: path.posix.basename(newPath),
    });
    emitDocumentMoved({ mountPointId: mp.id, fromRelativePath: link.relativePath, toRelativePath: newPath });
  }

  return { mountPointId: mp.id, fromPath: fromRel, toPath: toRel };
}
