/**
 * S3 File Service
 * High-level file service that combines S3 operations with file metadata
 * Provides a simplified interface for file upload, download, and management operations
 */

import { Readable } from 'node:stream';
import { logger } from '@/lib/logger';
import { validateS3Config } from './config';
import {
  uploadFile,
  downloadFile,
  deleteFile,
  fileExists,
  getPresignedUrl,
  getPresignedUploadUrl,
  getPublicUrl,
  getFileMetadata,
  listFiles,
} from './operations';
import { buildS3Key } from './client';

/**
 * File metadata for upload operations
 */
export interface FileUploadMetadata {
  userId: string;
  fileId: string;
  filename: string;
  category: string;
  content: Buffer | Readable;
  contentType: string;
  size?: number;
  sha256?: string;
  mimeType?: string;
}

/**
 * File metadata response from S3
 */
export interface FileMetadataInfo {
  size: number;
  contentType: string;
  lastModified: Date;
}

/**
 * Options for getting file URLs
 */
export interface GetUrlOptions {
  presigned?: boolean;
  expiresIn?: number;
}

/**
 * Service class for managing files in S3
 */
class S3FileService {
  private moduleLogger = logger.child({ module: 's3:file-service' });

  /**
   * Upload a file with automatic S3 key generation
   * @param userId The user ID
   * @param fileId The file ID
   * @param filename The original filename
   * @param category The file category
   * @param content The file content as Buffer or Readable
   * @param contentType The MIME type of the file
   * @returns Promise that resolves when upload is complete
   * @throws Error if upload fails
   */
  async uploadUserFile(
    userId: string,
    fileId: string,
    filename: string,
    category: string,
    content: Buffer | Readable,
    contentType: string
  ): Promise<void> {

    const s3Key = buildS3Key(userId, fileId, filename, category);

    this.moduleLogger.debug('Uploading user file to S3', {
      userId,
      fileId,
      filename,
      category,
      s3Key,
      contentType,
    });

    try {
      await uploadFile(s3Key, content, contentType, {
        userId,
        fileId,
        category,
        filename,
      });

      this.moduleLogger.info('User file uploaded successfully', {
        userId,
        fileId,
        filename,
        category,
        s3Key,
      });
    } catch (error) {
      this.moduleLogger.error(
        'Failed to upload user file',
        { userId, fileId, filename, category, s3Key },
        error as Error
      );
      throw error;
    }
  }

  /**
   * Upload a file with complete metadata
   * @param metadata File upload metadata including content and S3 key components
   * @returns Promise that resolves when upload is complete
   * @throws Error if upload fails
   */
  async uploadWithMetadata(metadata: FileUploadMetadata): Promise<void> {
    const s3Key = buildS3Key(
      metadata.userId,
      metadata.fileId,
      metadata.filename,
      metadata.category
    );

    this.moduleLogger.debug('Uploading file with metadata', {
      userId: metadata.userId,
      fileId: metadata.fileId,
      filename: metadata.filename,
      category: metadata.category,
      s3Key,
      contentType: metadata.contentType,
      hasSize: !!metadata.size,
      hasSha256: !!metadata.sha256,
      hasMimeType: !!metadata.mimeType,
    });

    try {
      const s3Metadata: Record<string, string> = {
        userId: metadata.userId,
        fileId: metadata.fileId,
        category: metadata.category,
        filename: metadata.filename,
      };

      if (metadata.size !== undefined) {
        s3Metadata.size = String(metadata.size);
      }

      if (metadata.sha256) {
        s3Metadata.sha256 = metadata.sha256;
      }

      if (metadata.mimeType) {
        s3Metadata.mimeType = metadata.mimeType;
      }

      await uploadFile(s3Key, metadata.content, metadata.contentType, s3Metadata);

      this.moduleLogger.info('File uploaded with metadata', {
        userId: metadata.userId,
        fileId: metadata.fileId,
        filename: metadata.filename,
        category: metadata.category,
        s3Key,
      });
    } catch (error) {
      this.moduleLogger.error(
        'Failed to upload file with metadata',
        {
          userId: metadata.userId,
          fileId: metadata.fileId,
          filename: metadata.filename,
          category: metadata.category,
        },
        error as Error
      );
      throw error;
    }
  }

  /**
   * Download a file using key components
   * @param userId The user ID
   * @param fileId The file ID
   * @param filename The filename
   * @param category The file category
   * @returns Promise resolving to file content as Buffer
   * @throws Error if file not found or download fails
   */
  async downloadUserFile(
    userId: string,
    fileId: string,
    filename: string,
    category: string
  ): Promise<Buffer> {
    const s3Key = buildS3Key(userId, fileId, filename, category);

    this.moduleLogger.debug('Downloading user file from S3', {
      userId,
      fileId,
      filename,
      category,
      s3Key,
    });

    try {
      const buffer = await downloadFile(s3Key);

      this.moduleLogger.debug('User file downloaded successfully', {
        userId,
        fileId,
        filename,
        category,
        s3Key,
        size: buffer.length,
      });

      return buffer;
    } catch (error) {
      this.moduleLogger.error(
        'Failed to download user file',
        { userId, fileId, filename, category, s3Key },
        error as Error
      );
      throw error;
    }
  }

  /**
   * Get a URL for accessing a file (presigned or public)
   * @param s3Key The S3 object key
   * @param options Optional URL options (presigned, expiresIn)
   * @returns Promise resolving to the URL string
   * @throws Error if URL generation fails
   */
  async getFileUrl(s3Key: string, options?: GetUrlOptions): Promise<string> {
    const { presigned = false, expiresIn = 3600 } = options || {};

    this.moduleLogger.debug('Getting file URL', {
      s3Key,
      presigned,
      expiresIn: presigned ? expiresIn : undefined,
    });

    try {
      let url: string;

      if (presigned) {
        url = await getPresignedUrl(s3Key, expiresIn);
        this.moduleLogger.debug('Presigned URL generated', {
          s3Key,
          expiresIn,
        });
      } else {
        url = await getPublicUrl(s3Key);
        this.moduleLogger.debug('Public URL generated', { s3Key });
      }

      return url;
    } catch (error) {
      this.moduleLogger.error(
        'Failed to get file URL',
        { s3Key, presigned },
        error as Error
      );
      throw error;
    }
  }

  /**
   * Delete a file by key components
   * @param userId The user ID
   * @param fileId The file ID
   * @param filename The filename
   * @param category The file category
   * @returns Promise that resolves when deletion is complete
   * @throws Error if deletion fails
   */
  async deleteUserFile(
    userId: string,
    fileId: string,
    filename: string,
    category: string
  ): Promise<void> {
    const s3Key = buildS3Key(userId, fileId, filename, category);

    this.moduleLogger.debug('Deleting user file from S3', {
      userId,
      fileId,
      filename,
      category,
      s3Key,
    });

    try {
      await deleteFile(s3Key);

      this.moduleLogger.info('User file deleted successfully', {
        userId,
        fileId,
        filename,
        category,
        s3Key,
      });
    } catch (error) {
      this.moduleLogger.error(
        'Failed to delete user file',
        { userId, fileId, filename, category, s3Key },
        error as Error
      );
      throw error;
    }
  }

  /**
   * Delete a file directly by S3 key
   * @param s3Key The S3 object key
   * @returns Promise that resolves when deletion is complete
   * @throws Error if deletion fails
   */
  async deleteByS3Key(s3Key: string): Promise<void> {
    this.moduleLogger.debug('Deleting file by S3 key', { s3Key });

    try {
      await deleteFile(s3Key);

      this.moduleLogger.info('File deleted by S3 key', { s3Key });
    } catch (error) {
      this.moduleLogger.error(
        'Failed to delete file by S3 key',
        { s3Key },
        error as Error
      );
      throw error;
    }
  }

  /**
   * Check if a file exists by S3 key
   * @param s3Key The S3 object key
   * @returns Promise resolving to true if file exists, false otherwise
   * @throws Error if check fails
   */
  async fileExistsByKey(s3Key: string): Promise<boolean> {
    this.moduleLogger.debug('Checking if file exists by S3 key', { s3Key });

    try {
      const exists = await fileExists(s3Key);

      this.moduleLogger.debug('File existence check complete', { s3Key, exists });

      return exists;
    } catch (error) {
      this.moduleLogger.error(
        'Failed to check file existence',
        { s3Key },
        error as Error
      );
      throw error;
    }
  }

  /**
   * List all files for a user, optionally filtered by category
   * @param userId The user ID
   * @param category Optional category to filter by
   * @param maxKeys Optional maximum number of keys to return (default: 1000)
   * @returns Promise resolving to array of S3 keys
   * @throws Error if listing fails
   */
  async listUserFiles(userId: string, category?: string, maxKeys?: number): Promise<string[]> {
    const config = validateS3Config();
    const prefix = config.pathPrefix || '';
    const listPrefix = category
      ? `${prefix}users/${userId}/${category}/`
      : `${prefix}users/${userId}/`;

    this.moduleLogger.debug('Listing user files', {
      userId,
      category,
      prefix: listPrefix,
      maxKeys,
    });

    try {
      const keys = await listFiles(listPrefix, maxKeys);

      this.moduleLogger.debug('User files listed', {
        userId,
        category,
        count: keys.length,
      });

      return keys;
    } catch (error) {
      this.moduleLogger.error(
        'Failed to list user files',
        { userId, category },
        error as Error
      );
      throw error;
    }
  }

  /**
   * Get file metadata from S3
   * @param s3Key The S3 object key
   * @returns Promise resolving to file metadata or null if file doesn't exist
   * @throws Error if metadata retrieval fails
   */
  async getFileInfo(s3Key: string): Promise<FileMetadataInfo | null> {
    this.moduleLogger.debug('Getting file metadata', { s3Key });

    try {
      const metadata = await getFileMetadata(s3Key);

      if (!metadata) {
        this.moduleLogger.debug('File does not exist', { s3Key });
        return null;
      }

      this.moduleLogger.debug('File metadata retrieved', {
        s3Key,
        size: metadata.size,
        contentType: metadata.contentType,
      });

      return metadata;
    } catch (error) {
      this.moduleLogger.error(
        'Failed to get file metadata',
        { s3Key },
        error as Error
      );
      throw error;
    }
  }

  /**
   * Generate an S3 key using key components
   * Exposes the key generation utility from the client module
   * @param userId The user ID
   * @param fileId The file ID
   * @param filename The filename
   * @param category The file category
   * @returns The generated S3 key
   */
  generateS3Key(
    userId: string,
    fileId: string,
    filename: string,
    category: string
  ): string {
    this.moduleLogger.debug('Generating S3 key', {
      userId,
      fileId,
      filename,
      category,
    });

    const key = buildS3Key(userId, fileId, filename, category);

    this.moduleLogger.debug('S3 key generated', { key });

    return key;
  }

  /**
   * Generate a presigned upload URL for direct client uploads
   * @param userId The user ID
   * @param fileId The file ID
   * @param filename The filename
   * @param category The file category
   * @param contentType The MIME type
   * @param expiresIn The URL expiration time in seconds (default: 3600)
   * @returns Promise resolving to the presigned upload URL
   * @throws Error if URL generation fails
   */
  async generatePresignedUploadUrl(
    userId: string,
    fileId: string,
    filename: string,
    category: string,
    contentType: string,
    expiresIn: number = 3600
  ): Promise<string> {
    const s3Key = buildS3Key(userId, fileId, filename, category);

    this.moduleLogger.debug('Generating presigned upload URL', {
      userId,
      fileId,
      filename,
      category,
      s3Key,
      contentType,
      expiresIn,
    });

    try {
      const url = await getPresignedUploadUrl(s3Key, contentType, expiresIn);

      this.moduleLogger.debug('Presigned upload URL generated', {
        userId,
        fileId,
        s3Key,
        expiresIn,
      });

      return url;
    } catch (error) {
      this.moduleLogger.error(
        'Failed to generate presigned upload URL',
        { userId, fileId, filename, category, contentType, expiresIn },
        error as Error
      );
      throw error;
    }
  }
}

// Export singleton instance
export const s3FileService = new S3FileService();

// Export class for type reference
export { S3FileService };
