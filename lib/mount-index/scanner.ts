/**
 * Mount Point Scanner
 *
 * Core service that orchestrates scanning a single document mount point.
 * Walks the filesystem under the mount point's basePath, applies include/exclude
 * patterns, detects new/modified/deleted files, converts them to plain text,
 * chunks the text, and persists the results to the mount index database.
 *
 * Embedding jobs are NOT enqueued here — the scan runner handles that after
 * scanning completes, to avoid overwhelming the job queue during large scans.
 *
 * @module mount-index/scanner
 */

import path from 'path';
import fs from 'fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { computeSha256 } from '@/lib/file-storage/scanner';
import { getRepositories } from '@/lib/repositories/factory';
import { convertToPlainText } from './converters';
import { chunkDocument } from './chunker';
import { DocMountPoint } from '@/lib/schemas/mount-index.types';
import { policyFromContent, DEFAULT_DOCUMENT_POLICY } from '@/lib/doc-edit/document-policy';
import { assertBasePathAvailable } from './base-path-availability';

const logger = createServiceLogger('MountIndex:Scanner');

export interface ScanResult {
  mountPointId: string;
  filesScanned: number;
  filesNew: number;
  filesModified: number;
  filesDeleted: number;
  chunksCreated: number;
  errors: string[];
}

export type ProcessFileOutcome =
  | { status: 'unchanged' }
  | { status: 'unsupported' }
  | { status: 'empty' }
  | { status: 'new'; chunksCreated: number }
  | { status: 'modified'; chunksCreated: number };

/**
 * Detect file type from extension.
 *
 * @param filePath - File path (relative or absolute)
 * @returns The logical file type, or null if not supported
 */
export function detectFileType(filePath: string): 'pdf' | 'docx' | 'markdown' | 'txt' | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf': return 'pdf';
    case '.docx': return 'docx';
    case '.md': case '.markdown': return 'markdown';
    case '.txt': return 'txt';
    default: return null;
  }
}

/**
 * Check if a relative path matches a glob-like pattern (simple implementation).
 * Supports:
 *  - `*.md`, `*.txt` — file extension matching
 *  - `.git`, `node_modules` — directory/file name matching against any path segment
 *
 * @param relativePath - Path relative to the mount point basePath
 * @param pattern      - The include/exclude pattern
 * @returns True if the path matches the pattern
 */
export function matchesPattern(relativePath: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    // File extension match — compare the suffix after the '*'
    return relativePath.endsWith(pattern.substring(1));
  }
  // Directory/file name match — check if any path segment matches exactly
  const segments = relativePath.split(path.sep);
  return segments.some(seg => seg === pattern);
}

/**
 * Recursively walk a directory, yielding files that match include patterns
 * and don't match exclude patterns. Symlinks are skipped.
 *
 * @param basePath        - Absolute root path of the mount point
 * @param includePatterns - Glob-like patterns for files to include
 * @param excludePatterns - Glob-like patterns for files/directories to exclude
 * @param currentRelative - Current relative path from basePath (for recursion)
 * @returns Array of { relativePath, absolutePath } for matching files
 */
async function walkDirectory(
  basePath: string,
  includePatterns: string[],
  excludePatterns: string[],
  currentRelative: string = ''
): Promise<{ relativePath: string; absolutePath: string }[]> {
  const results: { relativePath: string; absolutePath: string }[] = [];
  const currentAbsolute = currentRelative
    ? path.join(basePath, currentRelative)
    : basePath;

  let entries;
  try {
    entries = await fs.readdir(currentAbsolute, { withFileTypes: true });
  } catch (err) {
    logger.warn('Unable to read directory during walk', {
      path: currentAbsolute,
      error: err instanceof Error ? err.message : String(err),
    });
    return results;
  }

  for (const entry of entries) {
    const relativePath = currentRelative
      ? path.join(currentRelative, entry.name)
      : entry.name;

    // Skip symlinks entirely
    if (entry.isSymbolicLink()) {
      continue;
    }

    // Check exclude patterns against directory/file names
    if (excludePatterns.some(pattern => matchesPattern(relativePath, pattern))) {
      continue;
    }

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      const subResults = await walkDirectory(basePath, includePatterns, excludePatterns, relativePath);
      results.push(...subResults);
    } else if (entry.isFile()) {
      // Check include patterns — file must match at least one
      if (includePatterns.length === 0 || includePatterns.some(pattern => matchesPattern(relativePath, pattern))) {
        results.push({
          relativePath,
          absolutePath: path.join(basePath, relativePath),
        });
      }
    }
  }

  return results;
}

/**
 * Process a single file under a mount point — hash, compare, convert, chunk,
 * and persist if changed. Does NOT enqueue embedding jobs; callers are
 * responsible for that.
 *
 * Idempotent: if the on-disk sha256 matches the stored record, returns
 * { status: 'unchanged' } without touching the database.
 *
 * @param mountPoint   - The mount point this file belongs to
 * @param absolutePath - Full path to the file on disk
 * @param relativePath - Path relative to the mount point's basePath
 */
export async function processMountFile(
  mountPoint: DocMountPoint,
  absolutePath: string,
  relativePath: string
): Promise<ProcessFileOutcome> {
  const repos = getRepositories();

  const fileType = detectFileType(relativePath);
  if (!fileType) return { status: 'unsupported' };

  const sha256 = await computeSha256(absolutePath);
  const existing = await repos.docMountFileLinks.findByMountPointAndPath(
    mountPoint.id,
    relativePath
  );

  if (existing && existing.sha256 === sha256) {
    return { status: 'unchanged' };
  }

  const stat = await fs.stat(absolutePath);

  const plainText = await convertToPlainText(absolutePath, fileType);
  if (!plainText || plainText.trim().length === 0) {
    return { status: 'empty' };
  }

  const chunks = chunkDocument(plainText);

  // Per-document policy lives in the markdown frontmatter, which
  // convertToPlainText has already stripped — parse it from the raw bytes.
  // Non-markdown files keep the permissive defaults.
  let policy = DEFAULT_DOCUMENT_POLICY;
  if (fileType === 'markdown') {
    try {
      policy = policyFromContent(await fs.readFile(absolutePath, 'utf-8'));
    } catch {
      policy = DEFAULT_DOCUMENT_POLICY;
    }
  }

  if (existing) {
    await repos.docMountChunks.deleteByLinkId(existing.id);
  }

  // Upsert the (file, link) pair. linkFilesystemFile finds-or-creates the
  // content row by sha (keeping its UUID stable across rewrites) and
  // (re)points the link at the new content.
  const link = await repos.docMountFileLinks.linkFilesystemFile({
    mountPointId: mountPoint.id,
    relativePath,
    fileName: path.basename(relativePath),
    fileType,
    sha256,
    fileSizeBytes: stat.size,
    lastModified: stat.mtime.toISOString(),
    conversionStatus: 'converted',
    plainTextLength: plainText.length,
    chunkCount: chunks.length,
    allowEmbed: policy.embed,
    allowCharacterRead: policy.characterRead,
    allowCharacterWrite: policy.characterWrite,
  });

  const outcome: 'new' | 'modified' = existing ? 'modified' : 'new';

  if (chunks.length > 0) {
    await repos.docMountChunks.bulkInsert(
      chunks.map(chunk => ({
        linkId: link.id,
        mountPointId: mountPoint.id,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        headingContext: chunk.headingContext,
        embedding: null,
      }))
    );
  }

  return { status: outcome, chunksCreated: chunks.length };
}

/**
 * Remove a file and its chunks from the mount index.
 *
 * @param mountPointId - The mount point containing the file
 * @param relativePath - Path relative to the mount point's basePath
 * @returns true if a record was removed, false if none existed
 */
export async function removeMountFile(
  mountPointId: string,
  relativePath: string
): Promise<boolean> {
  const repos = getRepositories();

  const existing = await repos.docMountFileLinks.findByMountPointAndPath(
    mountPointId,
    relativePath
  );
  if (!existing) return false;

  await repos.docMountFileLinks.deleteWithGC(existing.id);
  return true;
}

/**
 * Recompute and persist a mount point's aggregate totals (file count,
 * chunk count, total bytes). Called after any mutation that could
 * affect the rollups.
 */
export async function updateMountPointTotals(mountPointId: string): Promise<void> {
  const repos = getRepositories();
  const files = await repos.docMountFiles.findByMountPointId(mountPointId);
  const totalChunks = files.reduce((sum, f) => sum + (f.chunkCount || 0), 0);
  const totalSize = files.reduce((sum, f) => sum + (f.fileSizeBytes || 0), 0);
  await repos.docMountPoints.updateLastScanned(
    mountPointId,
    files.length,
    totalChunks,
    totalSize
  );
}

/**
 * Scan a single mount point: walk the filesystem, detect changes,
 * convert files to plain text, chunk, and persist to the database.
 *
 * @param mountPoint - The mount point configuration to scan
 * @returns ScanResult with counts and any errors encountered
 */
export async function scanMountPoint(mountPoint: DocMountPoint): Promise<ScanResult> {
  const repos = getRepositories();
  const result: ScanResult = {
    mountPointId: mountPoint.id,
    filesScanned: 0,
    filesNew: 0,
    filesModified: 0,
    filesDeleted: 0,
    chunksCreated: 0,
    errors: [],
  };

  // Database-backed stores have no filesystem to walk. Delegate to
  // rescanDatabaseMountPoint, which re-emits write events so the embedding
  // scheduler rechunks every document.
  if (mountPoint.mountType === 'database') {
    logger.info('Starting database-backed mount point rescan', {
      mountPointId: mountPoint.id,
      name: mountPoint.name,
    });
    await repos.docMountPoints.updateScanStatus(mountPoint.id, 'scanning');
    try {
      const { rescanDatabaseMountPoint } = await import('./database-store');
      const count = await rescanDatabaseMountPoint(mountPoint);
      result.filesScanned = count;
      result.filesModified = count;
      await updateMountPointTotals(mountPoint.id);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Database-backed rescan failed', {
        mountPointId: mountPoint.id,
        error: errorMsg,
      });
      await repos.docMountPoints.updateScanStatus(mountPoint.id, 'error', errorMsg);
      result.errors.push(`Rescan failed: ${errorMsg}`);
    }
    return result;
  }

  logger.info('Starting mount point scan', {
    mountPointId: mountPoint.id,
    basePath: mountPoint.basePath,
    name: mountPoint.name,
  });

  // 1. Update scan status to 'scanning'
  await repos.docMountPoints.updateScanStatus(mountPoint.id, 'scanning');

  try {
    // 2. Walk filesystem to get all matching files
    const filesOnDisk = await walkDirectory(
      mountPoint.basePath,
      mountPoint.includePatterns,
      mountPoint.excludePatterns
    );
    result.filesScanned = filesOnDisk.length;

    // 3. Get existing files from database for this mount point
    const existingFiles = await repos.docMountFiles.findByMountPointId(mountPoint.id);
    const existingByPath = new Map(existingFiles.map(f => [f.relativePath, f]));

    // 4. Track which paths we see on disk (for stale detection)
    const seenPaths = new Set<string>();

    // 5. Process each file on disk
    for (const { relativePath, absolutePath } of filesOnDisk) {
      seenPaths.add(relativePath);

      try {
        const outcome = await processMountFile(mountPoint, absolutePath, relativePath);
        switch (outcome.status) {
          case 'unsupported':
            continue;
          case 'unchanged':
            continue;
          case 'empty':
            continue;
          case 'new':
            result.filesNew++;
            result.chunksCreated += outcome.chunksCreated;
            break;
          case 'modified':
            result.filesModified++;
            result.chunksCreated += outcome.chunksCreated;
            break;
        }
      } catch (fileError) {
        const errorMsg = fileError instanceof Error ? fileError.message : String(fileError);
        logger.warn('Error processing file during mount scan', {
          relativePath,
          error: errorMsg,
        });
        result.errors.push(`${relativePath}: ${errorMsg}`);

        // Try to mark the link as failed if it exists in DB.
        const existing = existingByPath.get(relativePath);
        if (existing) {
          await repos.docMountFileLinks.update(existing.id, {
            conversionStatus: 'failed',
            conversionError: errorMsg,
          }).catch(() => {});
        }
      }
    }

    // 6. Detect deleted files (in DB but not on disk)
    for (const [existingPath] of existingByPath) {
      if (!seenPaths.has(existingPath)) {
        if (await removeMountFile(mountPoint.id, existingPath)) {
          result.filesDeleted++;
        }
      }
    }

    // 7. Update mount point with scan results
    await updateMountPointTotals(mountPoint.id);

    logger.info('Mount point scan completed', {
      mountPointId: mountPoint.id,
      filesScanned: result.filesScanned,
      filesNew: result.filesNew,
      filesModified: result.filesModified,
      filesDeleted: result.filesDeleted,
      chunksCreated: result.chunksCreated,
      errorCount: result.errors.length,
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Mount point scan failed', {
      mountPointId: mountPoint.id,
      error: errorMsg,
    });
    await repos.docMountPoints.updateScanStatus(mountPoint.id, 'error', errorMsg);
    result.errors.push(`Scan failed: ${errorMsg}`);
  }

  return result;
}

// ============================================================================
// Filesystem helpers for API route handlers
// (keeps fs access out of route files)
// ============================================================================

/**
 * Walk a filesystem-backed mount and return every directory's relative path
 * (POSIX-style, forward slashes). Respects `excludePatterns` so the picker
 * matches what the scanner considers. Symlinks are skipped.
 *
 * @param basePath        - Absolute root path of the mount point
 * @param excludePatterns - Patterns to exclude (same syntax as scanner)
 * @param currentRelative - Internal recursion parameter; leave undefined on first call
 * @returns Array of POSIX-style relative directory paths
 */
export async function listFilesystemFolders(
  basePath: string,
  excludePatterns: string[],
  currentRelative = ''
): Promise<string[]> {
  const results: string[] = [];
  const currentAbsolute = currentRelative
    ? path.join(basePath, currentRelative)
    : basePath;

  let entries;
  try {
    entries = await fs.readdir(currentAbsolute, { withFileTypes: true });
  } catch (err) {
    logger.warn('Unable to read directory while listing mount folders', {
      path: currentAbsolute,
      error: err instanceof Error ? err.message : String(err),
    });
    return results;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory()) continue;

    const relativeNative = currentRelative
      ? path.join(currentRelative, entry.name)
      : entry.name;

    if (excludePatterns.some(pattern => matchesPattern(relativeNative, pattern))) {
      continue;
    }

    const relativePosix = relativeNative.split(path.sep).join('/');
    results.push(relativePosix);

    const sub = await listFilesystemFolders(basePath, excludePatterns, relativeNative);
    results.push(...sub);
  }

  return results;
}

/**
 * Create a directory inside a filesystem-backed mount point, enforcing that
 * the target stays within the mount's basePath (path-traversal guard).
 *
 * @param basePath    - Absolute root path of the mount point
 * @param mountPointId - Used only for logging
 * @param relativePath - POSIX-style relative path to create (must be safe)
 * @throws Error if the resolved target escapes the mount root
 */
export async function createFilesystemFolder(
  basePath: string,
  mountPointId: string,
  relativePath: string
): Promise<void> {
  const target = path.resolve(basePath, relativePath);
  const baseResolved = path.resolve(basePath);
  const baseWithSep = baseResolved.endsWith(path.sep) ? baseResolved : baseResolved + path.sep;

  if (!(target === baseResolved || target.startsWith(baseWithSep))) {
    logger.warn('Folder path escapes mount base — refusing to create', {
      mountPointId,
      relativePath,
      basePath,
    });
    throw new Error('Folder path escapes mount point boundary');
  }

  // The mkdir below is recursive, which is what makes this check load-bearing
  // rather than merely polite. Without it, a mount whose basePath is absent —
  // a store pointing at an unmounted volume, or at a host path that was never
  // bound into this container — sends mkdir walking all the way up to the
  // topmost missing ancestor and creating the entire chain. Where the process
  // has the privileges to do that, the folder is reported as created while
  // living in a fabricated tree that has nothing to do with the user's store.
  // Fail loudly against the absent base instead.
  await assertBasePathAvailable(basePath);

  logger.debug('Creating filesystem folder', { mountPointId, basePath, relativePath, target });

  await fs.mkdir(target, { recursive: true });
}
