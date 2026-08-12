/**
 * Passphrase-change re-encryption of archive bundles (§4.2c).
 *
 * `changePassphrase` re-wraps `.dbkey` and nothing else; archive bundles in
 * `files/` would silently still want the old passphrase. This second phase
 * enumerates every ARCHIVE file, decrypts it with the old passphrase, and
 * re-encrypts it with the new one — including bundles written before archive
 * encryption existed, which are plaintext NDJSON and simply gain a header.
 *
 * The operation is not atomic across files (each is rewritten in place, one
 * at a time), so a partial failure leaves a mixed-passphrase library. The
 * result therefore names exactly which archives still hold the old
 * passphrase, and per-file progress goes to the log. A bundle that already
 * refuses the old passphrase (it predates an *earlier* passphrase change that
 * failed partway) is reported the same way rather than silently skipped.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import {
  encryptArchive,
  decryptArchive,
  isEncryptedArchive,
  ArchivePassphraseMismatchError,
} from '@/lib/characters/archive-crypto';

export interface ArchiveReencryptFailure {
  fileId: string;
  filename: string;
  /** Human-readable diagnosis — surfaced verbatim in the settings UI. */
  reason: string;
}

export interface ArchiveReencryptResult {
  /** How many ARCHIVE files exist. */
  total: number;
  /** How many were successfully rewritten under the new passphrase. */
  reencrypted: number;
  /** The archives left holding the old passphrase, by name. */
  failures: ArchiveReencryptFailure[];
}

/**
 * Rewrite every ARCHIVE bundle from `oldPassphrase` to `newPassphrase`.
 * Failures never abort the sweep — every remaining file still gets its
 * attempt, and the result names the ones left behind.
 */
export async function reencryptArchiveBundles(
  oldPassphrase: string,
  newPassphrase: string
): Promise<ArchiveReencryptResult> {
  const repos = getRepositories();
  const archives = await repos.files.findByCategory('ARCHIVE');

  const result: ArchiveReencryptResult = {
    total: archives.length,
    reencrypted: 0,
    failures: [],
  };

  if (archives.length === 0) {
    return result;
  }

  logger.info('Re-encrypting archive bundles for passphrase change', {
    total: archives.length,
  });

  for (const [index, file] of archives.entries()) {
    try {
      if (!file.storageKey) {
        throw new Error('file row has no storageKey — bytes were never uploaded');
      }

      const bytes = await fileStorageManager.downloadFile(file);
      // Pre-encryption bundles are plaintext NDJSON; they "decrypt" to
      // themselves and simply gain a header on the way back out.
      const plaintext = isEncryptedArchive(bytes)
        ? decryptArchive(bytes, oldPassphrase)
        : bytes;
      const reencrypted = encryptArchive(plaintext, newPassphrase);

      await fileStorageManager.uploadRaw({
        storageKey: file.storageKey,
        content: reencrypted,
        contentType: file.mimeType || 'application/octet-stream',
      });
      await repos.files.update(file.id, { size: reencrypted.length } as never);

      result.reencrypted++;
      logger.info('Archive bundle re-encrypted', {
        fileId: file.id,
        filename: file.originalFilename,
        progress: `${index + 1}/${archives.length}`,
      });
    } catch (error) {
      const reason =
        error instanceof ArchivePassphraseMismatchError
          ? 'does not open with the old passphrase — it predates an earlier passphrase change'
          : error instanceof Error
            ? error.message
            : String(error);
      result.failures.push({
        fileId: file.id,
        filename: file.originalFilename,
        reason,
      });
      logger.warn('Archive bundle NOT re-encrypted; it still expects the old passphrase', {
        fileId: file.id,
        filename: file.originalFilename,
        reason,
      });
    }
  }

  logger.info('Archive re-encryption pass complete', {
    total: result.total,
    reencrypted: result.reencrypted,
    failed: result.failures.length,
  });

  return result;
}
