/**
 * Hard-Link Groups
 *
 * A `linkGroupId` marks a set of `doc_mount_file_links` rows that were
 * deliberately hard-linked together (`docs link`). Within a group the bytes are
 * one file: a write through any member repoints every member at the new content
 * row, which the repository does inside the write transaction
 * (`fanOutGroupFileId`).
 *
 * What the repository can't do from inside that transaction is rebuild the
 * siblings' chunks — chunks are keyed by `linkId`, so every member maintains its
 * own chunk + embedding set, and re-chunking is an async pass over content the
 * transaction hasn't committed yet. This module is that second half: after a
 * write lands, re-index the rest of the group so search results and character
 * context don't serve the previous revision from a sibling path.
 *
 * Filesystem groups need this too, for the opposite reason: the OS shares the
 * bytes through the inode (so no content fan-out is required), but the index
 * rows are per-path and would otherwise keep a stale sha, size, and chunk set
 * for every path except the one written.
 *
 * @module mount-index/link-groups
 */

import path from 'path';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';

/**
 * Re-index every other member of the hard-link group containing
 * `(mountPointId, relativePath)`.
 *
 * No-op — and cheap, one indexed lookup — when the link isn't grouped, which is
 * the overwhelmingly common case. Never throws: a sibling that fails to
 * re-index is logged and skipped, because the write that triggered this has
 * already succeeded and must not be reported as failed.
 *
 * Must run on the parent process only. Inside the forked job child, repository
 * writes are buffered and shipped over IPC, so the content this would read back
 * isn't committed yet (see BACKGROUND_JOBS_CHILD.md); in-child writers leave
 * sibling chunking to the next mount rescan.
 *
 * @returns the number of siblings re-indexed
 */
export async function reindexLinkGroupSiblings(
  mountPointId: string,
  relativePath: string
): Promise<number> {
  const repos = getRepositories();

  const link = await repos.docMountFileLinks.findByMountPointAndPath(mountPointId, relativePath);
  if (!link?.linkGroupId) return 0;

  const members = await repos.docMountFileLinks.findByLinkGroupId(link.linkGroupId);
  const siblings = members.filter(m => m.id !== link.id);
  if (siblings.length === 0) return 0;

  const { reindexSingleFile } = await import('@/lib/doc-edit/reindex-file');

  let reindexed = 0;
  for (const sibling of siblings) {
    try {
      // Database-backed siblings read their bytes out of doc_mount_documents,
      // so they take an empty absolute path; filesystem siblings need the real
      // one resolved against their own mount's basePath.
      const mount = await repos.docMountPoints.findById(sibling.mountPointId);
      const absolutePath =
        mount && mount.mountType !== 'database' && mount.basePath
          ? path.join(mount.basePath, sibling.relativePath)
          : '';

      await reindexSingleFile(sibling.mountPointId, sibling.relativePath, absolutePath);
      reindexed += 1;
    } catch (err) {
      logger.warn('Failed to re-index hard-link group sibling', {
        linkGroupId: link.linkGroupId,
        siblingLinkId: sibling.id,
        siblingMountPointId: sibling.mountPointId,
        siblingPath: sibling.relativePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.debug('Re-indexed hard-link group siblings', {
    mountPointId,
    relativePath,
    linkGroupId: link.linkGroupId,
    siblings: siblings.length,
    reindexed,
  });

  return reindexed;
}
