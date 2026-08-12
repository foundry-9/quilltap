/**
 * Mount Index Path Resolution Utilities
 *
 * Utilities for resolving and managing file paths in document stores with
 * explicit folder entities. Used by database-backed stores to navigate,
 * validate, and create folder hierarchies.
 *
 * All paths are POSIX-style with forward slashes, regardless of OS.
 * Root folder is represented as parentId=null or path=''.
 *
 * @module mount-index/folder-paths
 */

import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';
import * as posixPath from 'path/posix';
import { getJobFolderEnsureCache } from '@/lib/background-jobs/child/job-folder-cache';

/**
 * Resolve a file path to its parent folder ID.
 *
 * Splits the path into folderPath (directory) and leafName (filename).
 * Returns folderId=null for root-level files.
 * Throws if an ancestor folder does not exist (intended for read/delete paths
 * where the folder structure must already be in place).
 *
 * @param mountPointId The mount point ID
 * @param path The file path (e.g. 'foo/bar/note.md')
 * @returns Object with folderId, leafName, and folderPath
 * @throws Error if an ancestor folder does not exist
 */
export async function resolvePath(
  mountPointId: string,
  path: string,
): Promise<{ folderId: string | null; leafName: string; folderPath: string }> {
  const normalized = normalizePath(path);
  const dir = posixPath.dirname(normalized);
  const file = posixPath.basename(normalized);

  // Root-level file: parentId = null
  if (dir === '.') {
    return {
      folderId: null,
      leafName: file,
      folderPath: '',
    };
  }

  // Look up the folder
  const repos = await getRepositories();
  const folder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, dir);

  if (!folder) {
    const msg = `Ancestor folder does not exist: mountPointId=${mountPointId}, folderPath=${dir}`;
    logger.warn(msg);
    throw new Error(msg);
  }

  return {
    folderId: folder.id,
    leafName: file,
    folderPath: dir,
  };
}

/**
 * Build the full folder path by traversing from a folder up to the root.
 *
 * For root folder (folderId=null), returns ''.
 * For nested folders, concatenates segments from the denormalised `path` column.
 * This is an O(1) operation if the folder's path is already denormalised.
 *
 * @param folderId The folder ID (null for root)
 * @returns The full relative path ('' for root)
 */
export async function buildPath(folderId: string | null): Promise<string> {
  if (!folderId) {
    return '';
  }

  const repos = await getRepositories();
  const folder = await repos.docMountFolders.findById(folderId);

  if (!folder) {
    const msg = `Folder not found: folderId=${folderId}`;
    logger.warn(msg);
    throw new Error(msg);
  }

  return folder.path;
}

/**
 * Idempotently create all missing folder segments along a path.
 *
 * `folderPath` is the directory path only (not including a filename).
 * Empty string means root and returns null.
 * Otherwise walks from root, creating missing segments, and returns the leaf folder ID.
 *
 * Transaction-safe under concurrent calls via ON CONFLICT DO NOTHING semantics:
 * if a segment already exists, the create fails gracefully and we look it up.
 *
 * @param mountPointId The mount point ID
 * @param folderPath The directory path ('' for root; e.g. 'foo/bar')
 * @returns The leaf folder ID, or null for root
 */
export async function ensureFolderPath(
  mountPointId: string,
  folderPath: string,
): Promise<string | null> {
  const normalized = normalizePath(folderPath);

  // Empty path = root
  if (!normalized) {
    return null;
  }

  const repos = await getRepositories();
  const segments = normalized.split('/').filter(s => s.length > 0);

  // In a forked job child, repository writes are buffered and reads use a
  // readonly connection (no read-your-writes). Without this per-job memo, a
  // second ensureFolderPath for a path already ensured earlier in the SAME
  // job would miss the buffered create on the lookup below and buffer a
  // duplicate docMountFolders.create — a unique-constraint poison write that
  // atomically rolls back the whole job at apply time. The memo holds the id
  // we already ensured this job so the duplicate is never created. It is null
  // outside a job scope (the parent path), where read-your-writes suffices.
  const folderCache = getJobFolderEnsureCache();

  // The folder namespace is case-insensitive and case-preserving: a segment
  // that matches an existing folder except for casing reuses that folder, and
  // the walk continues under the folder's STORED casing (`currentPath` tracks
  // the canonical prefix) so newly-created deeper segments get consistent
  // `path` values.
  let currentParentId: string | null = null;
  let currentPath = '';

  for (const segment of segments) {
    // Build the path for this segment (canonical prefix + requested leaf)
    const requestedPath = currentPath ? `${currentPath}/${segment}` : segment;
    const cacheKey = `${mountPointId}:${requestedPath.toLowerCase()}`;

    // Already ensured (found or created) this folder earlier in the same job?
    const memoized = folderCache?.get(cacheKey);
    if (memoized) {
      currentParentId = memoized.id;
      currentPath = memoized.path;
      continue;
    }

    // Try to find the existing folder (case-insensitive)
    let folder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, requestedPath);

    if (!folder) {
      // Create it if it doesn't exist
      try {
        folder = await repos.docMountFolders.create({
          mountPointId,
          parentId: currentParentId,
          name: segment,
          path: requestedPath,
        });
      } catch (error) {
        // On conflict (concurrent creation), look it up
        const existing = await repos.docMountFolders.findByMountPointAndPath(mountPointId, requestedPath);
        if (existing) {
          folder = existing;
        } else {
          logger.error('Failed to create or find folder segment', {
            context: 'folder-paths.ensureFolderPath',
            mountPointId,
            segment,
            path: requestedPath,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }
    }

    folderCache?.set(cacheKey, { id: folder.id, path: folder.path });
    currentParentId = folder.id;
    currentPath = folder.path;
  }

  return currentParentId;
}

/**
 * Check if a folder has any contents (child folders, documents, or blobs).
 *
 * Returns true if the folder has at least one child folder, document, or blob.
 * Used to determine whether a folder can be safely deleted.
 *
 * @param mountPointId The mount point ID
 * @param folderId The folder ID
 * @returns True if the folder has contents
 */
export async function folderHasContents(
  mountPointId: string,
  folderId: string,
): Promise<boolean> {
  const repos = await getRepositories();

  // Check for child folders
  const childFolders = await repos.docMountFolders.findChildren(mountPointId, folderId);
  if (childFolders.length > 0) {
    return true;
  }

  // Check for any link (file or document) under this folder. Post-refactor
  // folder membership lives on the link row, not on doc_mount_files /
  // doc_mount_documents.
  const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);
  if (links.some(l => l.folderId === folderId)) {
    return true;
  }

  // Check for blobs with this folderId (if repo exists)
  // Note: blobs don't have folderId yet; this is placeholder for completeness
  // and will be revisited in Phase B when blob folder support is added.

  return false;
}

// ============================================================================
// Helper: Path normalization
// ============================================================================

/**
 * Normalize a path to use forward slashes and remove trailing slashes.
 * Does not require the path to exist.
 *
 * @param path The path to normalize
 * @returns The normalized path
 */
function normalizePath(path: string): string {
  // Convert backslashes to forward slashes (Windows paths)
  let normalized = path.replace(/\\/g, '/');

  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '');

  // Collapse multiple slashes
  normalized = normalized.replace(/\/+/g, '/');

  return normalized;
}
