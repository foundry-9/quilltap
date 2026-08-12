/**
 * Local Filesystem File Storage Backend
 *
 * Implements file storage on the local filesystem.
 * Supports streaming uploads/downloads, file copying, listing, and metadata retrieval.
 *
 * Files are stored at the configured basePath.
 * Path safety is enforced to prevent directory traversal attacks.
 *
 * Sidecar .meta.json files have been removed — all metadata is in the database.
 *
 * @module file-storage/backends/local
 */

import { readFile, writeFile, mkdir, access, copyFile, readdir, unlink, stat, rmdir } from 'fs/promises';
import { Readable } from 'stream';
import { dirname, join, normalize, relative } from 'path';
import { homedir } from 'os';
import { createLogger } from '../../../logging/create-logger';
import type {
  FileStorageBackend,
  FileBackendMetadata,
  FileMetadata,
} from '../../interfaces';
import { withFsRetry } from './retry';
import { FileContentMissingError } from '../../errors';

const logger = createLogger('file-storage:local');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for the local file storage backend
 */
interface LocalBackendConfig {
  /** Base directory path where files will be stored */
  basePath: string;
}

// ============================================================================
// LOCAL FILESYSTEM BACKEND IMPLEMENTATION
// ============================================================================

/**
 * Local filesystem file storage backend
 *
 * Stores files on the local filesystem with the following features:
 * - Path safety validation to prevent directory traversal
 * - Streaming upload and download support
 * - File copying, deletion, and existence checks
 * - Recursive directory listing with prefix matching
 */
export class LocalFileStorageBackend implements FileStorageBackend {
  private basePath: string;

  /**
   * Initialize the local file storage backend
   *
   * @param config - Configuration object with basePath
   * @throws {Error} If basePath is not provided
   */
  constructor(config: LocalBackendConfig) {
    if (!config.basePath) {
      throw new Error('Local file storage backend requires basePath configuration');
    }

    // Expand tilde to home directory (Node.js doesn't do this automatically)
    let resolvedPath = config.basePath;
    if (resolvedPath.startsWith('~/')) {
      resolvedPath = join(homedir(), resolvedPath.slice(2));
    } else if (resolvedPath === '~') {
      resolvedPath = homedir();
    }

    this.basePath = normalize(resolvedPath);
  }

  // ========================================================================
  // METADATA
  // ========================================================================

  /**
   * Get metadata about this storage backend
   */
  getMetadata(): FileBackendMetadata {
    return {
      providerId: 'local',
      displayName: 'Local Filesystem',
      description: 'Store files on the local filesystem',
      capabilities: {
        presignedUrls: false,
        publicUrls: false,
        streamingUpload: true,
        streamingDownload: true,
        copy: true,
        list: true,
        metadata: true,
        folders: true,
      },
    };
  }

  // ========================================================================
  // PATH SAFETY
  // ========================================================================

  /**
   * Build a safe file path by normalizing and validating against directory traversal
   *
   * Prevents directory traversal attacks by:
   * 1. Normalizing the path using path.normalize()
   * 2. Removing any `..` path components
   * 3. Joining with basePath
   * 4. Verifying the result is still under basePath
   *
   * @param key - The file key/path
   * @returns Safe absolute file path
   * @throws {Error} If path would escape basePath
   */
  private buildSafePath(key: string): string {
    // Normalize the key to remove any `..` or redundant separators
    const normalizedKey = normalize(key).replace(/\.\./g, '');

    // Join with basePath
    const fullPath = join(this.basePath, normalizedKey);

    // Verify the result is still under basePath
    const relativePath = relative(this.basePath, fullPath);
    if (relativePath.startsWith('..')) {
      logger.warn('Path traversal attempt detected', {
        key,
        basePath: this.basePath,
      });
      throw new Error(
        `Invalid file path: would escape base directory. Key: ${key}`
      );
    }
    return fullPath;
  }

  // ========================================================================
  // CONNECTION TEST
  // ========================================================================

  /**
   * Test the connection to the storage backend
   *
   * Verifies that the basePath exists and is writable by attempting to
   * create a temporary test file, then cleaning it up.
   *
   * @returns Object with success status and message
   */
  async testConnection(): Promise<{
    success: boolean;
    message: string;
    latencyMs?: number;
  }> {
    const startTime = Date.now();

    try {
      // First, ensure the directory exists
      await mkdir(this.basePath, { recursive: true });
      // Try to create and delete a test file
      const testFilePath = join(this.basePath, '.connection-test-' + Date.now());
      const testContent = 'connection test';

      await writeFile(testFilePath, testContent);
      await unlink(testFilePath);
      const latencyMs = Date.now() - startTime;
      return {
        success: true,
        message: `Local filesystem backend is accessible at ${this.basePath}`,
        latencyMs,
      };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown error during connection test';

      logger.error('Connection test failed', {
        error: errorMsg,
        basePath: this.basePath,
      });

      return {
        success: false,
        message: `Failed to verify local filesystem access: ${errorMsg}`,
      };
    }
  }

  // ========================================================================
  // CORE OPERATIONS
  // ========================================================================

  /**
   * Upload a file to storage
   *
   * Creates parent directories if needed and writes the file content.
   *
   * @param key - Storage key/path for the file
   * @param body - File content as Buffer or Readable stream
   * @param contentType - MIME type of the file (stored in DB, not on disk)
   * @param metadata - Optional custom metadata (stored in DB, not on disk)
   * @throws {Error} If upload fails
   */
  async upload(
    key: string,
    body: Buffer | Readable,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<void> {
    const filePath = this.buildSafePath(key);

    try {
      // Ensure parent directory exists
      const directory = dirname(filePath);
      await withFsRetry(
        () => mkdir(directory, { recursive: true }),
        { operation: 'upload:mkdir', key },
      );

      // Convert Readable to Buffer if necessary
      let fileContent: Buffer;
      if (Buffer.isBuffer(body)) {
        fileContent = body;
      } else {
        // Read from stream
        const chunks: Uint8Array[] = [];
        for await (const chunk of body) {
          chunks.push(chunk as Uint8Array);
        }
        fileContent = Buffer.concat(chunks as any[]);
      }

      // Write file (no sidecar — metadata lives in DB)
      await withFsRetry(
        () => writeFile(filePath, fileContent as any),
        { operation: 'upload:writeFile', key },
      );
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown upload error';

      logger.error('Upload failed', {
        key,
        error: errorMsg,
      });

      throw new Error(`Failed to upload file '${key}': ${errorMsg}`);
    }
  }

  /**
   * Download a file from storage
   *
   * Retrieves the complete file content as a Buffer.
   *
   * @param key - Storage key/path of the file
   * @returns File content as a Buffer
   * @throws {Error} If file not found or download fails
   */
  async download(key: string): Promise<Buffer> {
    const filePath = this.buildSafePath(key);

    try {
      const content = await withFsRetry(
        () => readFile(filePath),
        { operation: 'download', key },
      );
      return content;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown download error';

      // Nothing at that path is a "gone" condition, not a read fault — the
      // caller needs to tell the two apart to answer 404 instead of 500.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        logger.warn('Download found no file at the storage key', { key });
        throw new FileContentMissingError(key, `No file at storage key '${key}'`);
      }

      logger.error('Download failed', {
        key,
        error: errorMsg,
      });

      throw new Error(`Failed to download file '${key}': ${errorMsg}`);
    }
  }

  /**
   * Delete a file from storage
   *
   * Removes the file. Also removes any leftover .meta.json sidecar (legacy cleanup).
   * Succeeds silently if the file does not exist (idempotent).
   *
   * @param key - Storage key/path of the file
   * @throws {Error} If deletion fails due to permissions or other issues
   */
  async delete(key: string): Promise<void> {
    const filePath = this.buildSafePath(key);

    try {
      // Delete the file
      try {
        await withFsRetry(
          () => unlink(filePath),
          { operation: 'delete', key },
        );
      } catch (error) {
        // File doesn't exist, which is fine for idempotent delete
        if (
          error instanceof Error &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
        } else {
          throw error;
        }
      }

      // Clean up any leftover legacy sidecar file
      try {
        await withFsRetry(
          () => unlink(`${filePath}.meta.json`),
          { operation: 'delete:sidecar', key },
        );
      } catch (error) {
        // Sidecar doesn't exist, which is expected in the new format
        if (
          error instanceof Error &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
        } else {
          // Log but don't throw for sidecar cleanup failure
        }
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown deletion error';

      logger.error('Delete failed', {
        key,
        error: errorMsg,
      });

      throw new Error(`Failed to delete file '${key}': ${errorMsg}`);
    }
  }

  /**
   * Check if a file exists in storage
   *
   * @param key - Storage key/path to check
   * @returns True if file exists, false otherwise
   * @throws {Error} If the check fails (permissions, etc.)
   */
  async exists(key: string): Promise<boolean> {
    const filePath = this.buildSafePath(key);

    try {
      await withFsRetry(
        () => access(filePath),
        { operation: 'exists', key },
      );
      return true;
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }

      const errorMsg =
        error instanceof Error ? error.message : 'Unknown existence check error';

      logger.error('Existence check failed', {
        key,
        error: errorMsg,
      });

      throw new Error(
        `Failed to check if file '${key}' exists: ${errorMsg}`
      );
    }
  }

  /**
   * Get a proxy URL for accessing the file
   *
   * Returns a URL path that the application can use to proxy access to the file.
   *
   * @param key - Storage key/path of the file
   * @returns URL for proxied access
   */
  getProxyUrl(key: string): string {
    const encodedKey = encodeURIComponent(key);
    const proxyUrl = `/api/v1/files/proxy/${encodedKey}`;
    return proxyUrl;
  }

  // ========================================================================
  // OPTIONAL OPERATIONS
  // ========================================================================

  /**
   * Copy a file server-side
   *
   * Copies a file from source to destination (no sidecar).
   *
   * @param sourceKey - Storage key of the source file
   * @param destinationKey - Storage key for the destination file
   * @throws {Error} If copy fails
   */
  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const sourcePath = this.buildSafePath(sourceKey);
    const destinationPath = this.buildSafePath(destinationKey);

    try {
      // Ensure destination directory exists
      const directory = dirname(destinationPath);
      await withFsRetry(
        () => mkdir(directory, { recursive: true }),
        { operation: 'copy:mkdir', key: destinationKey },
      );

      // Copy the file
      await withFsRetry(
        () => copyFile(sourcePath, destinationPath),
        { operation: 'copy', key: sourceKey },
      );
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown copy error';

      logger.error('Copy failed', {
        sourceKey,
        destinationKey,
        error: errorMsg,
      });

      throw new Error(
        `Failed to copy file from '${sourceKey}' to '${destinationKey}': ${errorMsg}`
      );
    }
  }

  /**
   * Get metadata about a stored file
   *
   * Returns stat-based metadata (size, mtime). Content type comes from DB.
   *
   * @param key - Storage key of the file
   * @returns File metadata or null if not found
   * @throws {Error} If metadata retrieval fails
   */
  async getFileMetadata(key: string): Promise<FileMetadata | null> {
    const filePath = this.buildSafePath(key);

    try {
      // Get file stats
      const stats = await withFsRetry(
        () => stat(filePath),
        { operation: 'getFileMetadata', key },
      );

      const metadata: FileMetadata = {
        size: stats.size,
        contentType: 'application/octet-stream', // Content type is in DB, not on disk
        lastModified: stats.mtime,
      };
      return metadata;
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }

      const errorMsg =
        error instanceof Error ? error.message : 'Unknown metadata retrieval error';

      logger.error('Failed to retrieve file metadata', {
        key,
        error: errorMsg,
      });

      throw new Error(`Failed to get metadata for file '${key}': ${errorMsg}`);
    }
  }

  /**
   * List files with a given prefix
   *
   * Recursively lists all files whose keys start with the specified prefix.
   * Filters out .meta.json sidecar files (legacy cleanup).
   *
   * @param prefix - Key prefix to match
   * @param maxKeys - Maximum number of keys to return (optional)
   * @returns Array of matching file keys
   * @throws {Error} If listing fails
   */
  async list(prefix: string, maxKeys?: number): Promise<string[]> {
    const prefixPath = this.buildSafePath(prefix);
    const results: string[] = [];

    try {
      /**
       * Recursively list files in a directory
       */
      const listDir = async (dirPath: string, currentPrefix: string) => {
        if (maxKeys && results.length >= maxKeys) {
          return;
        }

        try {
          const entries = await withFsRetry(
            () => readdir(dirPath, { withFileTypes: true }),
            { operation: 'list:readdir', key: currentPrefix },
          );

          for (const entry of entries) {
            if (maxKeys && results.length >= maxKeys) {
              break;
            }

            // Skip hidden files and legacy .meta.json sidecars
            if (entry.name.startsWith('.') || entry.name.endsWith('.meta.json')) {
              continue;
            }

            const fullKey = currentPrefix
              ? `${currentPrefix}/${entry.name}`
              : entry.name;

            if (entry.isDirectory()) {
              // Recurse into subdirectories
              await listDir(join(dirPath, entry.name), fullKey);
            } else {
              // Add file to results
              results.push(fullKey);
            }
          }
        } catch (error) {
          // Directory doesn't exist or isn't accessible
          if (
            error instanceof Error &&
            (error as NodeJS.ErrnoException).code === 'ENOENT'
          ) {
            return;
          }
          throw error;
        }
      };

      await listDir(prefixPath, prefix.replace(/\/$/, ''));
      return results;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown listing error';

      logger.error('Failed to list files', {
        prefix,
        error: errorMsg,
      });

      throw new Error(`Failed to list files with prefix '${prefix}': ${errorMsg}`);
    }
  }

  // ========================================================================
  // FOLDER OPERATIONS
  // ========================================================================

  /**
   * Create a folder/directory in storage
   *
   * Creates an empty directory at the specified path. Creates parent
   * directories recursively if they don't exist.
   *
   * @param folderPath - Path for the folder to create
   * @throws {Error} If folder creation fails
   */
  async createFolder(folderPath: string): Promise<void> {
    const fullPath = this.buildSafePath(folderPath);

    try {
      await withFsRetry(
        () => mkdir(fullPath, { recursive: true }),
        { operation: 'createFolder', key: folderPath },
      );
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown folder creation error';

      logger.error('Failed to create folder', {
        folderPath,
        error: errorMsg,
      });

      throw new Error(`Failed to create folder '${folderPath}': ${errorMsg}`);
    }
  }

  /**
   * Delete a folder/directory from storage
   *
   * Removes the directory at the specified path. The directory must be empty.
   * Succeeds silently if the directory does not exist (idempotent).
   *
   * @param folderPath - Path of the folder to delete
   * @throws {Error} If folder is not empty or deletion fails
   */
  async deleteFolder(folderPath: string): Promise<void> {
    const fullPath = this.buildSafePath(folderPath);

    try {
      await withFsRetry(
        () => rmdir(fullPath),
        { operation: 'deleteFolder', key: folderPath },
      );
    } catch (error) {
      // Directory doesn't exist, which is fine for idempotent delete
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return;
      }

      // Directory not empty
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === 'ENOTEMPTY'
      ) {
        logger.warn('Cannot delete non-empty folder', {
          folderPath,
        });
        throw new Error(`Cannot delete folder '${folderPath}': directory is not empty`);
      }

      const errorMsg =
        error instanceof Error ? error.message : 'Unknown folder deletion error';

      logger.error('Failed to delete folder', {
        folderPath,
        error: errorMsg,
      });

      throw new Error(`Failed to delete folder '${folderPath}': ${errorMsg}`);
    }
  }

  /**
   * Check if a folder/directory exists in storage
   *
   * @param folderPath - Path to check
   * @returns True if folder exists, false otherwise
   * @throws {Error} If the check fails
   */
  async folderExists(folderPath: string): Promise<boolean> {
    const fullPath = this.buildSafePath(folderPath);

    try {
      const stats = await withFsRetry(
        () => stat(fullPath),
        { operation: 'folderExists', key: folderPath },
      );
      const exists = stats.isDirectory();
      return exists;
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }

      const errorMsg =
        error instanceof Error ? error.message : 'Unknown folder existence check error';

      logger.error('Folder existence check failed', {
        folderPath,
        error: errorMsg,
      });

      throw new Error(
        `Failed to check if folder '${folderPath}' exists: ${errorMsg}`
      );
    }
  }
}
