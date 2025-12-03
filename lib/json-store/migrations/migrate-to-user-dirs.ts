/**
 * Data Migration: Single-User to Per-User Directory Structure
 *
 * Migrates data from the old single-user structure to the new per-user structure.
 *
 * Old structure:
 *   data/settings/general.json
 *   data/characters/
 *   data/chats/
 *   data/personas/
 *   data/tags/
 *   data/memories/
 *   data/files/
 *   data/vector-indices/
 *
 * New structure:
 *   data/auth/                 (stays global)
 *   data/users/[user-uuid]/
 *     settings.json
 *     characters/
 *     chats/
 *     personas/
 *     tags/
 *     memories/
 *     files/
 *     vector-indices/
 *   data/settings/
 *     connection-profiles.json (stays global for now)
 *     image-profiles.json
 *     embedding-profiles.json
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from '@/lib/logger';
import {
  getUserDataBasePath,
  getLegacyDataPath,
  needsDataMigration,
  ensureUserDataDir,
} from '../user-data-path';

/** Directories to migrate to per-user structure */
const USER_DATA_DIRS = [
  'characters',
  'chats',
  'personas',
  'tags',
  'memories',
  'files',
  'vector-indices',
];

/** Files/directories that stay global */
const GLOBAL_PATHS = [
  'auth',
  'settings/connection-profiles.json',
  'settings/image-profiles.json',
  'settings/embedding-profiles.json',
];

export interface MigrationResult {
  success: boolean;
  userId?: string;
  migratedPaths: string[];
  errors: string[];
  backupPath?: string;
}

/**
 * Create a backup of the current data directory
 */
async function createBackup(): Promise<string> {
  const dataDir = getLegacyDataPath('');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(path.dirname(dataDir), `data-backup-${timestamp}`);

  logger.info('Creating backup of data directory', {
    context: 'createBackup',
    dataDir,
    backupDir,
  });

  // Copy entire data directory
  await copyDirectory(dataDir, backupDir);

  return backupDir;
}

/**
 * Recursively copy a directory
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Move a directory to the user's data directory
 */
async function moveDirectory(srcDir: string, destDir: string): Promise<void> {
  // Check if source exists
  try {
    await fs.access(srcDir);
  } catch {
    // Source doesn't exist, nothing to move
    return;
  }

  // Create destination directory
  await fs.mkdir(destDir, { recursive: true });

  // Copy all files
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }

  // Remove source directory
  await fs.rm(srcDir, { recursive: true, force: true });
}

/**
 * Extract user ID from the legacy general.json file
 */
async function extractUserIdFromLegacy(): Promise<string | null> {
  const generalPath = getLegacyDataPath('settings/general.json');

  try {
    const content = await fs.readFile(generalPath, 'utf-8');
    const data = JSON.parse(content);
    return data?.user?.id || null;
  } catch (error) {
    logger.error(
      'Failed to extract user ID from legacy general.json',
      { context: 'extractUserIdFromLegacy' },
      error instanceof Error ? error : undefined
    );
    return null;
  }
}

/**
 * Migrate general.json to user's settings.json
 */
async function migrateGeneralSettings(userId: string): Promise<void> {
  const legacyPath = getLegacyDataPath('settings/general.json');
  const userSettingsPath = path.join(getUserDataBasePath(userId), 'settings.json');

  try {
    const content = await fs.readFile(legacyPath, 'utf-8');
    await fs.writeFile(userSettingsPath, content, 'utf-8');

    logger.info('Migrated general.json to user settings', {
      context: 'migrateGeneralSettings',
      userId,
      from: legacyPath,
      to: userSettingsPath,
    });

    // Remove legacy file (keep directory for global settings)
    await fs.unlink(legacyPath);
  } catch (error) {
    logger.error(
      'Failed to migrate general.json',
      { context: 'migrateGeneralSettings', userId },
      error instanceof Error ? error : undefined
    );
    throw error;
  }
}

/**
 * Run the migration from single-user to per-user directory structure
 */
export async function runMigration(options?: {
  createBackup?: boolean;
  dryRun?: boolean;
}): Promise<MigrationResult> {
  const { createBackup: shouldBackup = true, dryRun = false } = options || {};

  const result: MigrationResult = {
    success: false,
    migratedPaths: [],
    errors: [],
  };

  logger.info('Starting data migration to per-user structure', {
    context: 'runMigration',
    dryRun,
    createBackup: shouldBackup,
  });

  try {
    // Check if migration is needed
    const needsMigration = await needsDataMigration();
    if (!needsMigration) {
      logger.info('No migration needed - already using per-user structure or no data exists');
      result.success = true;
      return result;
    }

    // Extract user ID from legacy data
    const userId = await extractUserIdFromLegacy();
    if (!userId) {
      result.errors.push('Could not extract user ID from legacy general.json');
      logger.error('Migration failed: could not extract user ID');
      return result;
    }
    result.userId = userId;

    logger.info('Found user ID for migration', {
      context: 'runMigration',
      userId,
    });

    if (dryRun) {
      logger.info('Dry run - would migrate data for user', { userId });
      result.success = true;
      return result;
    }

    // Create backup if requested
    if (shouldBackup) {
      result.backupPath = await createBackup();
      logger.info('Backup created', { backupPath: result.backupPath });
    }

    // Ensure user data directory exists
    await ensureUserDataDir(userId);

    // Migrate general.json to user's settings.json
    await migrateGeneralSettings(userId);
    result.migratedPaths.push('settings/general.json -> settings.json');

    // Migrate each user data directory
    for (const dir of USER_DATA_DIRS) {
      const legacyDir = getLegacyDataPath(dir);
      const userDir = path.join(getUserDataBasePath(userId), dir);

      try {
        await moveDirectory(legacyDir, userDir);
        result.migratedPaths.push(`${dir}/ -> users/${userId}/${dir}/`);

        logger.info('Migrated directory', {
          context: 'runMigration',
          from: legacyDir,
          to: userDir,
        });
      } catch (error) {
        const errorMsg = `Failed to migrate ${dir}: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMsg);
        logger.warn(errorMsg, { context: 'runMigration' });
      }
    }

    result.success = result.errors.length === 0;

    logger.info('Migration completed', {
      context: 'runMigration',
      success: result.success,
      migratedPaths: result.migratedPaths.length,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    result.errors.push(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
    logger.error(
      'Migration failed',
      { context: 'runMigration' },
      error instanceof Error ? error : undefined
    );
    return result;
  }
}

/**
 * Check if migration is needed and prompt user
 * This is a helper for startup checks
 */
export async function checkMigrationStatus(): Promise<{
  needsMigration: boolean;
  userId?: string;
}> {
  const needsMigration = await needsDataMigration();

  if (!needsMigration) {
    return { needsMigration: false };
  }

  const userId = await extractUserIdFromLegacy();

  return {
    needsMigration: true,
    userId: userId || undefined,
  };
}
