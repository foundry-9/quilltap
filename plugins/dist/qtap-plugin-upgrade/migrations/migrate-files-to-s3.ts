/**
 * Migration: Migrate Files to S3
 *
 * Migrates binary files from local storage (public/data/files/storage) to S3-compatible storage.
 * Updates file entries with S3 reference information (s3Key and s3Bucket).
 *
 * Dependencies:
 * - validate-s3-config-v1: Must run after S3 configuration validation
 * - migrate-json-to-mongodb-v1: Should run after MongoDB migration if using MongoDB backend
 *
 * This migration:
 * 1. Checks if S3 is enabled and configured
 * 2. Finds all file entries that haven't been migrated yet (no s3Key)
 * 3. For each unmigrated file:
 *    - Reads the file from local storage
 *    - Uploads it to S3 with proper key path
 *    - Updates the file entry with S3 reference
 * 4. Continues on errors, collecting them for reporting
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '@/lib/logger';
import type { Migration, MigrationResult } from '../migration-types';
import { validateS3Config } from '@/lib/s3/config';
import { getAllFiles, updateFile } from '@/lib/file-manager/index';
import { buildS3Key, getS3Bucket } from '@/lib/s3/client';
import { uploadFile } from '@/lib/s3/operations';

/**
 * Check if the local storage directory exists and has files
 */
async function checkLocalStorageExists(): Promise<boolean> {
  try {
    const storagePath = path.join(process.cwd(), 'public/data/files/storage');
    const stat = await fs.stat(storagePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Count files that need migration (don't have s3Key)
 */
async function countFilesToMigrate(): Promise<number> {
  try {
    const files = await getAllFiles();
    return files.filter(entry => !entry.s3Key).length;
  } catch {
    return 0;
  }
}

/**
 * Migrate Files to S3 migration
 */
export const migrateFilesToS3Migration: Migration = {
  id: 'migrate-files-to-s3-v1',
  description: 'Migrate binary files from local storage to S3-compatible storage',
  introducedInVersion: '2.0.0',
  dependsOn: ['validate-s3-config-v1', 'migrate-json-to-mongodb-v1'],

  async shouldRun(): Promise<boolean> {
    const s3Config = validateS3Config();

    // Return false if S3 mode is 'disabled'
    if (s3Config.mode === 'disabled') {
      logger.debug('S3 is disabled, skipping file migration', {
        context: 'migration.migrate-files-to-s3',
      });
      return false;
    }

    // Check if S3 is properly configured
    if (!s3Config.isConfigured) {
      logger.debug('S3 is not properly configured, skipping file migration', {
        context: 'migration.migrate-files-to-s3',
        errors: s3Config.errors,
      });
      return false;
    }

    // Check if local storage directory exists
    const localStorageExists = await checkLocalStorageExists();
    if (!localStorageExists) {
      logger.debug('Local storage directory does not exist, skipping file migration', {
        context: 'migration.migrate-files-to-s3',
      });
      return false;
    }

    // Check if there are files to migrate
    const filesToMigrate = await countFilesToMigrate();
    if (filesToMigrate === 0) {
      logger.debug('No files need migration (all already have s3Key)', {
        context: 'migration.migrate-files-to-s3',
      });
      return false;
    }

    logger.debug('Files need migration to S3', {
      context: 'migration.migrate-files-to-s3',
      count: filesToMigrate,
    });

    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const migratedLogger = logger.child({ context: 'migration.migrate-files-to-s3' });

    let uploaded = 0;
    const errors: Array<{ fileId: string; filename: string; error: string }> = [];

    try {
      // Get S3 configuration
      const s3Config = validateS3Config();
      const bucket = getS3Bucket();

      migratedLogger.info('Starting file migration to S3', {
        bucket,
        s3Mode: s3Config.mode,
      });

      // Get all files
      const files = await getAllFiles();
      const filesToMigrate = files.filter(entry => !entry.s3Key);

      migratedLogger.debug('Found files to migrate', {
        total: files.length,
        toMigrate: filesToMigrate.length,
      });

      // Migrate each file
      for (const entry of filesToMigrate) {
        try {
          // Build local file path
          const ext = path.extname(entry.originalFilename);
          const localFilePath = path.join(
            process.cwd(),
            'public/data/files/storage',
            `${entry.id}${ext}`
          );

          // Read the file
          let fileBuffer: Buffer;
          try {
            fileBuffer = await fs.readFile(localFilePath);
            migratedLogger.debug('Read file from local storage', {
              fileId: entry.id,
              filename: entry.originalFilename,
              size: fileBuffer.length,
            });
          } catch (readError) {
            const errorMessage = readError instanceof Error ? readError.message : 'Unknown error';
            errors.push({
              fileId: entry.id,
              filename: entry.originalFilename,
              error: `Failed to read file: ${errorMessage}`,
            });
            migratedLogger.warn('Failed to read file from local storage', {
              fileId: entry.id,
              filename: entry.originalFilename,
              error: errorMessage,
            });
            continue;
          }

          // Build S3 key
          const s3Key = buildS3Key(
            entry.userId,
            entry.id,
            entry.originalFilename,
            entry.category.toLowerCase()
          );

          // Upload to S3
          try {
            await uploadFile(s3Key, fileBuffer, entry.mimeType);
            migratedLogger.debug('Uploaded file to S3', {
              fileId: entry.id,
              filename: entry.originalFilename,
              s3Key,
              bucket,
            });
          } catch (uploadError) {
            const errorMessage = uploadError instanceof Error ? uploadError.message : 'Unknown error';
            errors.push({
              fileId: entry.id,
              filename: entry.originalFilename,
              error: `Failed to upload to S3: ${errorMessage}`,
            });
            migratedLogger.warn('Failed to upload file to S3', {
              fileId: entry.id,
              filename: entry.originalFilename,
              s3Key,
              error: errorMessage,
            });
            continue;
          }

          // Update file entry with S3 reference
          try {
            await updateFile(entry.id, {
              s3Key,
              s3Bucket: bucket,
              updatedAt: new Date().toISOString(),
            });
            uploaded++;
            migratedLogger.debug('Updated file entry with S3 reference', {
              fileId: entry.id,
              s3Key,
              bucket,
            });
          } catch (updateError) {
            const errorMessage = updateError instanceof Error ? updateError.message : 'Unknown error';
            errors.push({
              fileId: entry.id,
              filename: entry.originalFilename,
              error: `Failed to update file entry: ${errorMessage}`,
            });
            migratedLogger.warn('Failed to update file entry with S3 reference', {
              fileId: entry.id,
              error: errorMessage,
            });
            // Don't continue - we need to update the entry even if S3 upload succeeded
            // The file is in S3 but the metadata isn't updated, so don't count this as success
            uploaded--; // Remove the count since update failed
            continue;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push({
            fileId: entry.id,
            filename: entry.originalFilename,
            error: `Unexpected error: ${errorMessage}`,
          });
          migratedLogger.error('Unexpected error during file migration', {
            fileId: entry.id,
          }, error instanceof Error ? error : undefined);
        }
      }
    } catch (error) {
      migratedLogger.error('Failed to initialize file migration', {
        context: 'migration.migrate-files-to-s3',
      }, error instanceof Error ? error : undefined);

      return {
        id: 'migrate-files-to-s3-v1',
        success: false,
        itemsAffected: uploaded,
        message: 'Failed to initialize file migration',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    if (success) {
      migratedLogger.info('File migration to S3 completed successfully', {
        filesUploaded: uploaded,
        durationMs,
      });
    } else {
      migratedLogger.warn('File migration to S3 completed with errors', {
        filesUploaded: uploaded,
        errorCount: errors.length,
        durationMs,
      });
    }

    return {
      id: 'migrate-files-to-s3-v1',
      success,
      itemsAffected: uploaded,
      message: success
        ? `Migrated ${uploaded} files to S3`
        : `Migrated ${uploaded} files to S3 with ${errors.length} errors`,
      error: errors.length > 0
        ? errors
            .slice(0, 5)
            .map(e => `${e.fileId}: ${e.error}`)
            .join('; ')
        : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
