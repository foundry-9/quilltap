/**
 * User Data Path Resolver
 *
 * Handles per-user data directory structure for multi-user support.
 * User data is stored in data/users/[user-uuid]/ directory.
 */

import path from 'path';
import fs from 'fs/promises';

/** Base data directory */
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

/** Per-user data subdirectory */
const USERS_DIR = 'users';

/**
 * Get the base path for a user's data directory
 * @param userId - The user's UUID
 * @returns Path to user's data directory (e.g., data/users/[uuid])
 */
export function getUserDataBasePath(userId: string): string {
  const userPath = path.join(DATA_DIR, USERS_DIR, userId);
  console.log('Resolved user data base path', {
    userId,
    userPath,
  });
  return userPath;
}

/**
 * Get a specific path within a user's data directory
 * @param userId - The user's UUID
 * @param subPath - Relative path within user's data directory
 * @returns Full path to the file/directory
 */
export function getUserDataPath(userId: string, subPath: string): string {
  const basePath = getUserDataBasePath(userId);
  const fullPath = path.join(basePath, subPath);
  console.log('Resolved user data path', {
    userId,
    subPath,
    fullPath,
  });
  return fullPath;
}

/**
 * Ensure the user's data directory exists
 * Creates the directory structure if it doesn't exist
 * @param userId - The user's UUID
 */
export async function ensureUserDataDir(userId: string): Promise<void> {
  const userPath = getUserDataBasePath(userId);

  try {
    // Check if directory exists
    const stats = await fs.stat(userPath);
    if (stats.isDirectory()) {
      console.log('User data directory already exists', { userId, userPath });
      return;
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.error(
        'Failed to check user data directory status',
        { userId, userPath },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
    // Directory doesn't exist, create it
  }

  try {
    await fs.mkdir(userPath, { recursive: true });
    console.log('Created user data directory', {
      userId,
      userPath,
    });
  } catch (error: any) {
    console.error(
      'Failed to create user data directory',
      { userId, userPath },
      error instanceof Error ? error : undefined
    );
    throw error;
  }
}

/**
 * Check if user data directory exists (for migration detection)
 * @param userId - The user's UUID
 * @returns true if user data directory exists
 */
export async function userDataDirExists(userId: string): Promise<boolean> {
  const userPath = getUserDataBasePath(userId);

  try {
    const stats = await fs.stat(userPath);
    const exists = stats.isDirectory();
    console.log('User data directory existence check', {
      userId,
      userPath,
      exists,
    });
    return exists;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('User data directory does not exist', {
        userId,
        userPath,
      });
      return false;
    }
    console.error(
      'Failed to check if user data directory exists',
      { userId, userPath },
      error instanceof Error ? error : undefined
    );
    throw error;
  }
}

/**
 * Check if data needs migration from old single-user layout to new per-user layout
 * Checks if old structure exists (data/settings/general.json)
 * AND new structure doesn't exist (data/users/)
 * @returns true if migration is needed
 */
export async function needsDataMigration(): Promise<boolean> {
  try {
    // Check if new structure exists
    const usersPath = path.join(DATA_DIR, USERS_DIR);
    const usersDirExists = await directoryExists(usersPath);

    if (usersDirExists) {
      console.log('New user data structure already exists, no migration needed');
      return false;
    }

    // Check if old structure exists
    const legacyGeneralPath = path.join(DATA_DIR, 'settings', 'general.json');
    const legacyFileExists = await fileExists(legacyGeneralPath);

    const needsMigration = legacyFileExists;

    console.log('Data migration check', {
      usersDirExists,
      legacyFileExists,
      needsMigration,
    });

    return needsMigration;
  } catch (error: any) {
    console.error(
      'Failed to check if data migration is needed',
      {},
      error instanceof Error ? error : undefined
    );
    throw error;
  }
}

/**
 * Get the legacy (single-user) data path
 * @param subPath - Relative path in legacy structure
 * @returns Path in legacy structure
 */
export function getLegacyDataPath(subPath: string): string {
  const legacyPath = path.join(DATA_DIR, subPath);
  console.log('Resolved legacy data path', {
    subPath,
    legacyPath,
  });
  return legacyPath;
}

/**
 * Helper function to check if a file exists
 * @param filePath - Path to check
 * @returns true if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Helper function to check if a directory exists
 * @param dirPath - Path to check
 * @returns true if directory exists
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
