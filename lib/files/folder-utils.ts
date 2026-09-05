/**
 * Folder Path Utilities
 *
 * Helper functions for working with folder paths in the file system.
 * Folder paths follow these conventions:
 * - "/" represents the root folder
 * - Subfolders always start and end with "/" (e.g., "/documents/", "/documents/reports/")
 * - No double slashes
 * - Case-sensitive
 * - No ".." path traversal allowed
 *
 * @module files/folder-utils
 */

import { logger } from '@/lib/logger';
import type { FileEntry } from '@/lib/schemas/file.types';

/**
 * Normalize a folder path to ensure proper format.
 *
 * - Ensures path starts with "/"
 * - Ensures path ends with "/"
 * - Removes duplicate slashes
 * - Removes any ".." segments (security)
 * - Returns "/" for empty or invalid paths
 *
 * @param path - The folder path to normalize
 * @returns Normalized folder path
 */
export function normalizeFolderPath(path: string | undefined | null): string {
  if (!path || path.trim() === '') {
    return '/';
  }

  // Remove any ".." segments for security
  let normalized = path.replace(/\.\./g, '');

  // Ensure starts with /
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }

  // Remove duplicate slashes
  normalized = normalized.replace(/\/+/g, '/');

  // Ensure ends with / (unless it's just "/")
  if (normalized !== '/' && !normalized.endsWith('/')) {
    normalized = normalized + '/';
  }

  // If we ended up with just slashes or empty after cleaning, return root
  if (normalized === '' || normalized.replace(/\//g, '') === '') {
    return '/';
  }
  return normalized;
}

/**
 * Derive folderPath from a storageKey.
 *
 * Storage keys follow the pattern: <projectId|_general>/[folder1/.../folderN/]<filename>
 * The first segment is the project/scope identifier, the last segment is the filename,
 * and any middle segments form the folder path.
 *
 * @param storageKey - The storage key to derive folderPath from
 * @returns The derived folder path (e.g., "/story-backgrounds/") or "/"
 *
 * @example
 * deriveFolderPathFromStorageKey("_general/story-backgrounds/image.png") // "/story-backgrounds/"
 * deriveFolderPathFromStorageKey("_general/image.png") // "/"
 * deriveFolderPathFromStorageKey("project123/docs/reports/file.md") // "/docs/reports/"
 */
export function deriveFolderPathFromStorageKey(storageKey: string | null | undefined): string {
  if (!storageKey) return '/';
  const parts = storageKey.split('/');
  if (parts.length > 2) {
    return '/' + parts.slice(1, parts.length - 1).join('/') + '/';
  }
  return '/';
}

/**
 * Resolve the effective folderPath for a file.
 *
 * Uses the stored folderPath if it's a non-empty value, otherwise derives it from
 * the storageKey. This handles legacy records that were created before folderPath
 * was consistently set.
 *
 * @param folderPath - The stored folderPath (may be null/empty)
 * @param storageKey - The storage key to derive from as fallback
 * @returns The resolved folder path
 */
export function resolveEffectiveFolderPath(
  folderPath: string | null | undefined,
  storageKey: string | null | undefined
): string {
  if (folderPath && folderPath !== '/') return normalizeFolderPath(folderPath);
  // If folderPath is null/empty/'/', check if storageKey implies a subfolder
  const derived = deriveFolderPathFromStorageKey(storageKey);
  if (derived !== '/') return derived;
  return folderPath || '/';
}

/**
 * Get the parent folder path.
 *
 * @param path - The folder path
 * @returns Parent folder path, or "/" if already at root
 *
 * @example
 * getParentPath("/documents/reports/") // returns "/documents/"
 * getParentPath("/documents/") // returns "/"
 * getParentPath("/") // returns "/"
 */
export function getParentPath(path: string): string {
  const normalized = normalizeFolderPath(path);

  if (normalized === '/') {
    return '/';
  }

  // Remove trailing slash, find last slash, return up to and including it
  const withoutTrailing = normalized.slice(0, -1);
  const lastSlashIndex = withoutTrailing.lastIndexOf('/');

  if (lastSlashIndex <= 0) {
    return '/';
  }

  return withoutTrailing.slice(0, lastSlashIndex + 1);
}

/**
 * Get the folder name (last segment) from a path.
 *
 * @param path - The folder path
 * @returns The folder name without slashes
 *
 * @example
 * getFolderName("/documents/reports/") // returns "reports"
 * getFolderName("/documents/") // returns "documents"
 * getFolderName("/") // returns ""
 */
export function getFolderName(path: string): string {
  const normalized = normalizeFolderPath(path);

  if (normalized === '/') {
    return '';
  }

  // Remove trailing slash, split, get last segment
  const withoutTrailing = normalized.slice(0, -1);
  const segments = withoutTrailing.split('/').filter(Boolean);

  return segments[segments.length - 1] || '';
}

/**
 * Get the depth level of a folder path.
 *
 * @param path - The folder path
 * @returns Depth level (0 for root, 1 for top-level folders, etc.)
 *
 * @example
 * getFolderDepth("/") // returns 0
 * getFolderDepth("/documents/") // returns 1
 * getFolderDepth("/documents/reports/") // returns 2
 */
export function getFolderDepth(path: string): number {
  const normalized = normalizeFolderPath(path);

  if (normalized === '/') {
    return 0;
  }

  // Count non-empty segments
  return normalized.split('/').filter(Boolean).length;
}

/**
 * Extract unique folder paths from a list of files.
 *
 * Returns all unique folder paths including parent folders.
 * For example, if files are in "/documents/reports/", this will
 * return both "/documents/" and "/documents/reports/".
 *
 * @param files - Array of file entries
 * @returns Array of unique folder paths, sorted by depth then alphabetically
 */
export function listFolders(files: FileEntry[]): string[] {
  const folders = new Set<string>();

  // Always include root
  folders.add('/');

  for (const file of files) {
    const fileFolderPath = normalizeFolderPath(file.folderPath);

    if (fileFolderPath !== '/') {
      // Add this folder and all parent folders
      let currentPath = fileFolderPath;
      while (currentPath !== '/') {
        folders.add(currentPath);
        currentPath = getParentPath(currentPath);
      }
    }
  }

  // Sort by depth, then alphabetically
  return Array.from(folders).sort((a, b) => {
    const depthA = getFolderDepth(a);
    const depthB = getFolderDepth(b);
    if (depthA !== depthB) {
      return depthA - depthB;
    }
    return a.localeCompare(b);
  });
}

/**
 * Folder segments that contain auto-generated images (avatars, story backgrounds).
 * Used by doc_list_files to suppress noise by default.
 */
export const GENERATED_IMAGE_FOLDER_SEGMENTS = ['character-avatars', 'story-backgrounds'] as const;

/**
 * Common image file extensions (lowercase, with leading dot).
 */
export const IMAGE_FILE_EXTENSIONS = [
  '.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.bmp', '.tiff', '.avif',
] as const;

/**
 * Returns true when `relativePath` is an image file located inside one of the
 * auto-generated image folders.  Uses segment matching (not substring) to
 * avoid false positives on names like "my-character-avatars-notes".
 *
 * @param relativePath - Relative path from the scope root (uses `/` separators)
 */
export function isAutomaticImagePath(relativePath: string): boolean {
  const segments = relativePath.split('/');
  const basename = segments[segments.length - 1] ?? '';
  const ext = basename.includes('.') ? basename.slice(basename.lastIndexOf('.')).toLowerCase() : '';
  if (!(IMAGE_FILE_EXTENSIONS as readonly string[]).includes(ext)) return false;
  return segments.some(seg => (GENERATED_IMAGE_FOLDER_SEGMENTS as readonly string[]).includes(seg));
}

/**
 * OS-generated cruft that should never be shown to an LLM or user.
 * Covers dot-files/dot-folders, Windows thumbnail DBs, and macOS artifacts.
 *
 * @param basename - The file or folder name (last path segment, no slashes)
 */
export function isOsCruftName(basename: string): boolean {
  if (basename.startsWith('.')) return true;
  const EXPLICIT_CRUFT = ['thumbs.db', 'desktop.ini', '__macosx'];
  return EXPLICIT_CRUFT.includes(basename.toLowerCase());
}

/**
 * Validate a folder path.
 *
 * Checks for:
 * - Path traversal attempts (..)
 * - Invalid characters
 * - Excessive depth
 *
 * @param path - The folder path to validate
 * @returns Object with isValid and optional error message
 */
export function validateFolderPath(path: string): { isValid: boolean; error?: string } {
  if (!path || typeof path !== 'string') {
    return { isValid: false, error: 'Path must be a non-empty string' };
  }

  // Check for path traversal
  if (path.includes('..')) {
    return { isValid: false, error: 'Path traversal (..) is not allowed' };
  }

  // Check for invalid characters (allowing alphanumeric, -, _, /, space, and common unicode)
  const invalidChars = /[<>:"|?*\x00-\x1f]/;
  if (invalidChars.test(path)) {
    return { isValid: false, error: 'Path contains invalid characters' };
  }

  // Check depth (max 10 levels deep)
  const normalized = normalizeFolderPath(path);
  if (getFolderDepth(normalized) > 10) {
    return { isValid: false, error: 'Path is too deeply nested (max 10 levels)' };
  }

  // Check segment length (max 100 chars per segment)
  const segments = normalized.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment.length > 100) {
      return { isValid: false, error: 'Folder names must be 100 characters or less' };
    }
  }

  return { isValid: true };
}
