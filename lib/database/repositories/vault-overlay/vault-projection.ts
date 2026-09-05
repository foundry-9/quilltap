/**
 * Generic vault-folder projection helper shared by the wardrobe sync chain,
 * the full-character writer, and the write overlay.
 *
 * @module database/repositories/vault-overlay/vault-projection
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  writeDatabaseDocument,
  deleteDatabaseDocument,
} from '@/lib/mount-index/database-store';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';

/**
 * Replace a vault folder's contents with a fresh projection of an array.
 * Files corresponding to items in `items` are written; any other files
 * currently in the folder are deleted, so the vault listing matches the
 * incoming array exactly. Naming collisions are disambiguated with
 * `-1`, `-2`, … suffixes.
 *
 * `opts.preserveFileNames` exempts specific root-level file names
 * (case-insensitive) from both the sweep and the projected name pool, so a
 * hand-kept file like `Wardrobe/instructions.md` survives every projection
 * and an item whose title maps to the same name lands on a `-1` suffix
 * instead of overwriting it.
 */
export async function projectArrayIntoVaultFolder<T>(
  mountPointId: string,
  folder: string,
  items: readonly T[],
  mapper: (item: T) => { fileName: string; content: string },
  characterId: string,
  opts?: { preserveFileNames?: readonly string[] },
): Promise<void> {
  const repos = getRepositories();
  const preserved = new Set((opts?.preserveFileNames ?? []).map((name) => name.toLowerCase()));
  const existing = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    folder,
    '.md',
  );
  const existingByPath = new Map(existing.map((d) => [d.relativePath, d]));

  if (items.length > 0) {
    await ensureFolderPath(mountPointId, folder);
  }

  const writtenPaths = new Set<string>();
  const seen = new Set<string>(preserved);
  for (const item of items) {
    const mapped = mapper(item);
    let candidate = mapped.fileName;
    let n = 1;
    while (seen.has(candidate.toLowerCase())) {
      const dot = mapped.fileName.lastIndexOf('.');
      const base = dot >= 0 ? mapped.fileName.slice(0, dot) : mapped.fileName;
      const ext = dot >= 0 ? mapped.fileName.slice(dot) : '';
      candidate = `${base}-${n}${ext}`;
      n++;
    }
    seen.add(candidate.toLowerCase());
    const relPath = `${folder}/${candidate}`;
    writtenPaths.add(relPath);
    await writeDatabaseDocument(mountPointId, relPath, mapped.content);
  }

  for (const [relPath, doc] of existingByPath) {
    if (writtenPaths.has(relPath)) continue;
    const fileSegment = relPath.slice(relPath.lastIndexOf('/') + 1).toLowerCase();
    if (preserved.has(fileSegment)) continue;
    try {
      await deleteDatabaseDocument(mountPointId, relPath);
    } catch (err) {
      logger.warn('Failed to delete stale vault file during folder projection', {
        characterId,
        mountPointId,
        relativePath: relPath,
        docId: doc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
