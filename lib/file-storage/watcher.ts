/**
 * Filesystem Watcher
 *
 * Uses chokidar to watch the files directory for real-time changes.
 * When files are added, changed, or removed on disk, the watcher
 * synchronizes the database accordingly.
 *
 * - Added files without DB records are created as 'orphaned' status
 * - Changed files get their sha256/size/mtime updated
 * - Removed files have their DB records deleted (after checking sha256 match elsewhere)
 * - Directories are tracked via folder records
 *
 * The _thumbnails/ directory is ignored.
 *
 * @module file-storage/watcher
 */

import chokidar from 'chokidar';
import { relative, join, extname, basename, dirname } from 'path';
import { createLogger } from '@/lib/logging/create-logger';
import { getFilesDir } from '@/lib/paths';
import { computeSha256, detectMimeType } from './scanner';
import { preservesContentDigest } from './digest-policy';
import { deriveFolderPathFromStorageKey } from '@/lib/files/folder-utils';
import { stat } from 'fs/promises';

const logger = createLogger('file-storage:watcher');

// ============================================================================
// STATE
// ============================================================================

let watcher: ReturnType<typeof chokidar.watch> | null = null;

/** Debounce timer map for events keyed by relative path */
const debounceTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 500;

/** Buffer for pending unlink events to detect file moves (unlink + add pair) */
interface PendingUnlink {
  record: any;
  timer: NodeJS.Timeout;
}
const pendingUnlinks = new Map<string, PendingUnlink>();
const PENDING_UNLINK_MS = 3000;

// ============================================================================
// HELPERS
// ============================================================================

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

/**
 * Check if a path should be ignored by the watcher
 */
function shouldIgnore(relativePath: string): boolean {
  // Ignore _thumbnails directory
  if (relativePath.startsWith('_thumbnails/') || relativePath === '_thumbnails') {
    return true;
  }
  // Ignore migration archive directories (created by v4.3 / v4.4 sweeps —
  // safety-net copies of files now living in document-store mounts).
  for (const segment of relativePath.split('/')) {
    if (segment.endsWith('_doc_store_archive') || segment.endsWith('_archive')) {
      return true;
    }
  }
  // Ignore hidden files and legacy sidecars
  const name = basename(relativePath);
  if (name.startsWith('.') || name.endsWith('.meta.json')) {
    return true;
  }
  return false;
}

/**
 * Get repos lazily to avoid circular imports during startup
 */
async function getRepos() {
  const { getRepositories } = await import('@/lib/database/repositories');
  return getRepositories();
}

/**
 * Get the single-user userId from DB
 */
async function getSingleUserId(): Promise<string> {
  const { getOrCreateSingleUser } = await import('@/lib/auth/single-user');
  const user = await getOrCreateSingleUser();
  return user.id;
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle file addition — create DB record if none exists
 */
async function handleFileAdd(filesDir: string, relativePath: string): Promise<void> {
  if (shouldIgnore(relativePath)) return;

  try {
    const repos = await getRepos();
    const absolutePath = join(filesDir, relativePath);

    // Check if a DB record already exists for this storageKey
    const existing = await repos.files.findByStorageKey(relativePath);
    if (existing) {
      return;
    }

    // Compute metadata
    const stats = await stat(absolutePath);
    const sha256 = await computeSha256(absolutePath);
    const mimeType = detectMimeType(relativePath);
    const userId = await getSingleUserId();
    const name = basename(relativePath);

    // Parse projectId and folderPath from the storage key
    const parts = relativePath.split('/');
    const projectOrGeneral = parts[0];
    const projectId = UUID_REGEX.test(projectOrGeneral) ? projectOrGeneral : null;
    const folderPath = deriveFolderPathFromStorageKey(relativePath);

    // Check pending unlinks for a SHA-256 match (file move: unlink + add)
    for (const [oldKey, pending] of pendingUnlinks.entries()) {
      if (pending.record.sha256 === sha256) {
        // Found a match — this is a move, not a delete + create
        clearTimeout(pending.timer);
        pendingUnlinks.delete(oldKey);

        await repos.files.update(pending.record.id, {
          storageKey: relativePath,
          folderPath,
          projectId,
          originalFilename: name,
        });

        logger.info('Detected file move via pending unlink sha256 match', {
          fileId: pending.record.id,
          oldKey,
          newKey: relativePath,
        });
        return;
      }
    }

    // Check if sha256 matches a record that lost its file (moved?)
    const sha256Matches = await repos.files.findBySha256(sha256);
    const movedRecord = sha256Matches?.find((f: any) => f.storageKey !== relativePath);
    if (movedRecord) {
      // Update existing record with new storageKey (file was moved on disk)
      await repos.files.update(movedRecord.id, {
        storageKey: relativePath,
        folderPath,
        projectId,
      });
      logger.info('Detected file move via sha256 match, updated storageKey', {
        fileId: movedRecord.id,
        oldKey: movedRecord.storageKey,
        newKey: relativePath,
      });
      return;
    }

    // Create new record as orphaned
    await repos.files.create({
      userId,
      sha256,
      originalFilename: name,
      mimeType,
      size: stats.size,
      linkedTo: [],
      source: 'UPLOADED',
      category: mimeType.startsWith('image/') ? 'IMAGE' : 'DOCUMENT',
      storageKey: relativePath,
      projectId,
      folderPath,
      tags: [],
      fileStatus: 'orphaned',
    });

    logger.info('Created orphaned file record for untracked file on disk', {
      storageKey: relativePath,
      sha256: sha256.slice(0, 12) + '...',
      size: stats.size,
    });
  } catch (error) {
    logger.warn('Error handling file add event', {
      relativePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle file change — update DB record
 */
async function handleFileChange(filesDir: string, relativePath: string): Promise<void> {
  if (shouldIgnore(relativePath)) return;

  try {
    const repos = await getRepos();
    const absolutePath = join(filesDir, relativePath);

    const existing = await repos.files.findByStorageKey(relativePath);
    if (!existing) {
      // No DB record — treat as an add
      await handleFileAdd(filesDir, relativePath);
      return;
    }

    // Recompute sha256 and size
    const stats = await stat(absolutePath);
    const sha256 = await computeSha256(absolutePath);

    // Bug 69: an archived character's bundle records the PLAINTEXT digest
    // while the disk bytes are encrypted, so re-deriving `sha256` here
    // replaces the content digest with a ciphertext one and the next
    // rehydrate refuses the bundle as corrupt. Size is still fair game.
    const keepDigest = preservesContentDigest(existing.category);

    if ((!keepDigest && sha256 !== existing.sha256) || stats.size !== existing.size) {
      await repos.files.update(existing.id, {
        ...(keepDigest ? {} : { sha256 }),
        size: stats.size,
      });

      logger.info('Updated file record after on-disk change', {
        fileId: existing.id,
        storageKey: relativePath,
        oldSha256: existing.sha256?.slice(0, 12) + '...',
        newSha256: keepDigest ? 'preserved (content digest)' : sha256.slice(0, 12) + '...',
      });
    }
  } catch (error) {
    logger.warn('Error handling file change event', {
      relativePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle file removal — defer deletion to allow move detection.
 *
 * When a file is moved on disk, chokidar fires `unlink` then `add`.
 * Instead of deleting immediately, we stash the record in pendingUnlinks
 * for a short window. If a matching `add` arrives (same SHA-256),
 * we treat it as a move and preserve all metadata.
 */
async function handleFileUnlink(relativePath: string): Promise<void> {
  if (shouldIgnore(relativePath)) return;

  try {
    const repos = await getRepos();

    const existing = await repos.files.findByStorageKey(relativePath);
    if (!existing) {
      return;
    }

    // Defer the deletion — stash in pending buffer
    const timer = setTimeout(async () => {
      pendingUnlinks.delete(relativePath);
      try {
        await repos.files.delete(existing.id);
        logger.info('Deleted file record after on-disk removal (deferred)', {
          fileId: existing.id,
          storageKey: relativePath,
          filename: existing.originalFilename,
        });
      } catch (err) {
        logger.warn('Error executing deferred file deletion', {
          relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, PENDING_UNLINK_MS);

    pendingUnlinks.set(relativePath, { record: existing, timer });
  } catch (error) {
    logger.warn('Error handling file unlink event', {
      relativePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle directory addition — create folder record if needed
 */
async function handleDirAdd(relativePath: string): Promise<void> {
  if (shouldIgnore(relativePath)) return;

  try {
    const repos = await getRepos();
    const userId = await getSingleUserId();

    // Parse projectId and folderPath from the relative path
    const parts = relativePath.split('/');
    const projectOrGeneral = parts[0];
    const projectId = UUID_REGEX.test(projectOrGeneral) ? projectOrGeneral : null;

    if (parts.length < 2) {
      // Top-level project directory — no folder record needed
      return;
    }

    const folderName = parts[parts.length - 1];
    const folderPath = '/' + parts.slice(1).join('/') + '/';

    // Check if folder record exists
    const existingFolder = await repos.folders.findByPath(userId, folderPath, projectId);
    if (existingFolder) {
      return;
    }

    await repos.folders.create({
      userId,
      path: folderPath,
      name: folderName,
      parentFolderId: null,
      projectId,
    });

    logger.info('Created folder record for new directory on disk', {
      folderPath,
      projectId,
    });
  } catch (error) {
    logger.warn('Error handling directory add event', {
      relativePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Debounced event handler
 */
function debouncedHandler(
  relativePath: string,
  handler: () => Promise<void>
): void {
  const existing = debounceTimers.get(relativePath);
  if (existing) {
    clearTimeout(existing);
  }

  debounceTimers.set(
    relativePath,
    setTimeout(async () => {
      debounceTimers.delete(relativePath);
      try {
        await handler();
      } catch (error) {
        logger.warn('Error in debounced watcher handler', {
          relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, DEBOUNCE_MS)
  );
}

// ============================================================================
// START / STOP
// ============================================================================

/**
 * Start the filesystem watcher
 *
 * Watches the files directory for changes and syncs with the database.
 */
export function startWatcher(): void {
  if (watcher) {
    logger.warn('File watcher already running, skipping start');
    return;
  }

  const filesDir = getFilesDir();

  logger.info('Starting filesystem watcher', { filesDir });

  watcher = chokidar.watch(filesDir, {
    persistent: true,
    ignoreInitial: true, // Don't fire events for existing files on startup
    depth: 10,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
    ignored: [
      // Ignore _thumbnails directory
      (filePath: string) => {
        const rel = relative(filesDir, filePath);
        return rel.startsWith('_thumbnails');
      },
    ],
  });

  watcher
    .on('add', (filePath: string) => {
      const rel = relative(filesDir, filePath);
      debouncedHandler(rel, () => handleFileAdd(filesDir, rel));
    })
    .on('change', (filePath: string) => {
      const rel = relative(filesDir, filePath);
      debouncedHandler(rel, () => handleFileChange(filesDir, rel));
    })
    .on('unlink', (filePath: string) => {
      const rel = relative(filesDir, filePath);
      debouncedHandler(rel, () => handleFileUnlink(rel));
    })
    .on('addDir', (filePath: string) => {
      const rel = relative(filesDir, filePath);
      if (rel && rel !== '.') {
        debouncedHandler(rel, () => handleDirAdd(rel));
      }
    })
    .on('error', (error: unknown) => {
      logger.error('Filesystem watcher error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

  logger.info('Filesystem watcher started successfully', { filesDir });
}

/**
 * Stop the filesystem watcher
 */
export async function stopWatcher(): Promise<void> {
  if (!watcher) {
    return;
  }

  logger.info('Stopping filesystem watcher');

  // Clear all debounce timers
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();

  // Flush all pending unlinks — execute deletions immediately
  if (pendingUnlinks.size > 0) {
    const { getRepositories } = await import('@/lib/database/repositories');
    const repos = getRepositories();

    for (const [storageKey, pending] of pendingUnlinks.entries()) {
      clearTimeout(pending.timer);
      try {
        await repos.files.delete(pending.record.id);
      } catch (err) {
        logger.warn('Error flushing pending unlink deletion', {
          storageKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    pendingUnlinks.clear();
  }

  await watcher.close();
  watcher = null;

  logger.info('Filesystem watcher stopped');
}
