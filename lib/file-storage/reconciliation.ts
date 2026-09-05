/**
 * Filesystem Reconciliation
 *
 * Full scan + DB sync run on startup.
 * Ensures the database accurately reflects what's on disk.
 *
 * Logic:
 * 1. Scan entire files directory (excluding _thumbnails)
 * 2. Load all file DB records
 * 3. For each file on disk: match to DB by storageKey, collect unmatched
 * 3.5. SHA-256 cross-match unmatched disk files with unmatched DB records to detect moves
 * 4. For each DB record not on disk and not matched by cross-matching: delete
 *    (unless referenced by characters or has linkedTo — those are preserved)
 * 5. Log summary
 *
 * @module file-storage/reconciliation
 */

import { join } from 'path';
import { createLogger } from '@/lib/logging/create-logger';
import { getFilesDir } from '@/lib/paths';
import { deriveFolderPathFromStorageKey } from '@/lib/files/folder-utils';
import { scanDirectory, computeSha256, detectMimeType } from './scanner';
import { preservesContentDigest } from './digest-policy';

const logger = createLogger('file-storage:reconciliation');

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

// ============================================================================
// RECONCILIATION
// ============================================================================

/**
 * Reconcile the filesystem with the database.
 *
 * This is designed to run at startup, after file storage is initialized
 * but before the watcher starts.
 */
export async function reconcileFilesystem(): Promise<void> {
  const startTime = Date.now();
  const filesDir = getFilesDir();

  const { startupProgress } = await import('@/lib/startup/progress');
  startupProgress.setCurrent('subsystem:reconcile:start');

  logger.info('Starting filesystem reconciliation', { filesDir });

  let filesOnDisk = 0;
  let recordsCreated = 0;
  let recordsDeleted = 0;
  let recordsUpdated = 0;
  let errors = 0;

  try {
    // Lazy imports to avoid circular dependencies during startup
    const { getRepositories } = await import('@/lib/database/repositories');
    const { getOrCreateSingleUser } = await import('@/lib/auth/single-user');

    const repos = getRepositories();
    const user = await getOrCreateSingleUser();
    const userId = user.id;

    // Step 1: Scan filesystem
    const scanned = await scanDirectory(filesDir);
    const filesOnlyScanned = scanned.filter(f => !f.isDirectory);
    filesOnDisk = filesOnlyScanned.length;

    // Step 2: Load all file DB records
    const allDbFiles = await repos.files.findByUserId(userId);

    // Build lookup maps
    const dbByStorageKey = new Map<string, any>();
    for (const f of allDbFiles) {
      if (f.storageKey) {
        dbByStorageKey.set(f.storageKey, f);
      }
    }

    const diskKeySet = new Set<string>();

    // Collect unmatched disk files for cross-matching in step 3.5
    const unmatchedDiskFiles: typeof filesOnlyScanned = [];

    // Step 3: For each file on disk, ensure a DB record exists
    for (const scannedFile of filesOnlyScanned) {
      diskKeySet.add(scannedFile.relativePath);

      if (dbByStorageKey.has(scannedFile.relativePath)) {
        // Record exists — check if size or folderPath needs updating
        const dbRecord = dbByStorageKey.get(scannedFile.relativePath);

        // Derive expected folderPath from the storage key. BACKUP and ARCHIVE
        // rows keep curated folder paths ('/backups', '/archives') that
        // deliberately do NOT mirror the physical storage key — "correcting"
        // them here would strip an archived-character bundle out of its shelf
        // folder on every boot.
        const isSystemShelf = dbRecord.category === 'ARCHIVE' || dbRecord.category === 'BACKUP';
        const expectedFolderPath = deriveFolderPathFromStorageKey(scannedFile.relativePath);
        const folderPathMismatch =
          !isSystemShelf && (dbRecord.folderPath || '/') !== expectedFolderPath;

        if (dbRecord.size !== scannedFile.size || folderPathMismatch) {
          try {
            const updates: Record<string, any> = {};

            if (dbRecord.size !== scannedFile.size) {
              // Bug 69: an ARCHIVE row's sha256 is the PLAINTEXT digest of an
              // encrypted bundle (re-encryption after a passphrase change is
              // exactly when its size moves) — recomputing it from disk would
              // make the bundle unrehydratable. Correct the size alone.
              if (!preservesContentDigest(dbRecord.category)) {
                updates.sha256 = await computeSha256(join(filesDir, scannedFile.relativePath));
              }
              updates.size = scannedFile.size;
            }

            if (folderPathMismatch) {
              updates.folderPath = expectedFolderPath;
            }

            await repos.files.update(dbRecord.id, updates);
            recordsUpdated++;
          } catch (err) {
            errors++;
            logger.warn('Failed to update file record during reconciliation', {
              storageKey: scannedFile.relativePath,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        continue;
      }

      // No DB record by storageKey — collect for cross-matching
      unmatchedDiskFiles.push(scannedFile);
    }

    // Collect unmatched DB records (on DB but not on disk)
    const unmatchedDbRecords = allDbFiles.filter(
      (f) => f.storageKey && !diskKeySet.has(f.storageKey)
    );

    // Step 3.5: SHA-256 cross-matching to detect file moves
    // Build a sha256 → dbRecord map from unmatched DB records for O(1) lookups
    const unmatchedDbBySha256 = new Map<string, any>();
    for (const dbRecord of unmatchedDbRecords) {
      if (dbRecord.sha256) {
        unmatchedDbBySha256.set(dbRecord.sha256, dbRecord);
      }
    }

    // Track which DB records got matched so we don't delete them in step 4
    const matchedDbIds = new Set<string>();

    for (const scannedFile of unmatchedDiskFiles) {
      try {
        const absolutePath = join(filesDir, scannedFile.relativePath);
        const sha256 = await computeSha256(absolutePath);
        const mimeType = detectMimeType(scannedFile.name);

        // Parse projectId and folderPath from path. Only treat the first
        // segment as a projectId if it's a valid UUID — migration archive
        // siblings (e.g. `<uuid>_doc_store_archive/`) and other non-UUID
        // top-level dirs collapse to projectId=null.
        const parts = scannedFile.relativePath.split('/');
        const projectOrGeneral = parts[0];
        const projectId = UUID_REGEX.test(projectOrGeneral) ? projectOrGeneral : null;
        const folderPath = deriveFolderPathFromStorageKey(scannedFile.relativePath);

        // Check for SHA-256 match among unmatched DB records (moved file)
        const matchedDbRecord = unmatchedDbBySha256.get(sha256);
        if (matchedDbRecord && !matchedDbIds.has(matchedDbRecord.id)) {
          // This is a moved file — update the existing record
          await repos.files.update(matchedDbRecord.id, {
            storageKey: scannedFile.relativePath,
            folderPath,
            projectId,
            originalFilename: scannedFile.name,
          });
          matchedDbIds.add(matchedDbRecord.id);
          // Remove from map so same sha256 can't match twice
          unmatchedDbBySha256.delete(sha256);
          recordsUpdated++;

          logger.info('Detected file move during reconciliation via sha256 match', {
            fileId: matchedDbRecord.id,
            oldKey: matchedDbRecord.storageKey,
            newKey: scannedFile.relativePath,
          });
          continue;
        }

        // No match — create orphaned record
        await repos.files.create({
          userId,
          sha256,
          originalFilename: scannedFile.name,
          mimeType,
          size: scannedFile.size,
          linkedTo: [],
          source: 'UPLOADED',
          category: mimeType.startsWith('image/') ? 'IMAGE' : 'DOCUMENT',
          storageKey: scannedFile.relativePath,
          projectId,
          folderPath,
          tags: [],
          fileStatus: 'orphaned',
        });
        recordsCreated++;
      } catch (err) {
        errors++;
        logger.warn('Failed to process unmatched disk file during reconciliation', {
          storageKey: scannedFile.relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Step 4: Delete DB records not on disk and not matched by cross-matching
    // First, build a set of file IDs referenced by characters so we don't
    // delete records that are still actively used as avatars/gallery images.
    const referencedFileIds = new Set<string>();
    let recordsPreserved = 0;
    try {
      // Raw rows: the overlay's findByUserId drops characters whose vault is
      // broken, and those are exactly the rows whose file references we can
      // least afford to lose here.
      const allCharacters = await repos.characters.findAllRaw();
      for (const char of allCharacters) {
        if (char.defaultImageId) {
          referencedFileIds.add(char.defaultImageId);
        }
        if (Array.isArray(char.avatarOverrides)) {
          for (const override of char.avatarOverrides) {
            if (override.imageId) {
              referencedFileIds.add(override.imageId);
            }
          }
        }
        // Archived-character bundle (and the pre-revision tombstone
        // thumbnail): the row stores the PLAINTEXT sha256 while the disk
        // bytes are encrypted, so the sha256 cross-match can never rescue it
        // — without this it would be deleted whenever the bytes are absent
        // at boot (e.g. a cloud-sync dataless file), dangling archiveFileId.
        if (char.archiveFileId) {
          referencedFileIds.add(char.archiveFileId);
        }
        if (char.archivedAvatarFileId) {
          referencedFileIds.add(char.archivedAvatarFileId);
        }
      }
    } catch (err) {
      logger.warn('Failed to load character references during reconciliation; proceeding cautiously', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    for (const dbRecord of unmatchedDbRecords) {
      if (matchedDbIds.has(dbRecord.id)) continue;

      // Preserve records that are still referenced by characters or have linkedTo
      const isReferenced = referencedFileIds.has(dbRecord.id) ||
        (dbRecord.linkedTo && dbRecord.linkedTo.length > 0);

      if (isReferenced) {
        recordsPreserved++;
        logger.info('Preserving referenced DB record despite missing file on disk', {
          fileId: dbRecord.id,
          storageKey: dbRecord.storageKey,
          filename: dbRecord.originalFilename,
          linkedTo: dbRecord.linkedTo,
          referencedByCharacter: referencedFileIds.has(dbRecord.id),
        });
        continue;
      }

      try {
        await repos.files.delete(dbRecord.id);
        recordsDeleted++;
      } catch (err) {
        errors++;
        logger.warn('Failed to delete stale record during reconciliation', {
          fileId: dbRecord.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info('Filesystem reconciliation complete', {
      filesOnDisk,
      dbRecords: allDbFiles.length,
      recordsCreated,
      recordsDeleted,
      recordsUpdated,
      recordsPreserved,
      errors,
      durationMs,
    });
    startupProgress.publish({
      rawLabel: 'subsystem:reconcile:complete',
      detail: `${filesOnDisk} on disk, ${recordsCreated} added, ${recordsDeleted} pruned, ${recordsPreserved} preserved`,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error('Filesystem reconciliation failed', {
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    });
    startupProgress.publish({
      rawLabel: 'subsystem:reconcile:complete',
      level: 'warn',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
