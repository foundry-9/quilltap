/**
 * S3 Client Module
 * Provides singleton S3 client and utilities for AWS S3 operations
 * Supports both AWS S3 and S3-compatible services (e.g., MinIO)
 */

import { S3Client, S3ClientConfig, HeadBucketCommand } from '@aws-sdk/client-s3';
import { logger } from '@/lib/logger';
import { validateS3Config } from './config';

/**
 * Singleton S3 client instance
 */
let s3Client: S3Client | null = null;

/**
 * Sanitize filename for S3 key by replacing unsafe characters
 * Keeps alphanumeric, dots, hyphens; replaces everything else with underscore
 *
 * @param filename - The filename to sanitize
 * @returns Sanitized filename with only alphanumeric, dots, hyphens, and underscores
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Get or create the singleton S3 client
 * Creates the client lazily on first use with configuration from environment variables
 *
 * @throws Error if required credentials are missing or configuration is invalid
 * @returns The singleton S3Client instance
 */
export function getS3Client(): S3Client {
  const moduleLogger = logger.child({ module: 's3:client' });

  // Return existing client if already initialized
  if (s3Client) {
    moduleLogger.debug('Returning existing S3 client');
    return s3Client;
  }

  moduleLogger.debug('Creating new S3 client instance');

  try {
    // Validate configuration
    const config = validateS3Config();

    // If configuration is invalid, throw error
    if (!config.isConfigured) {
      const errorMsg = `S3 configuration is invalid: ${config.errors.join('; ')}`;
      moduleLogger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Ensure credentials are available
    if (!config.accessKey || !config.secretKey) {
      const errorMsg = 'S3 credentials are not available (S3_ACCESS_KEY and S3_SECRET_KEY required)';
      moduleLogger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Build S3 client configuration
    const clientConfig: S3ClientConfig = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    };

    // Add endpoint configuration if provided (for S3-compatible services like MinIO)
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = config.forcePathStyle;
      moduleLogger.debug('S3 endpoint configured', {
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
      });
    }

    moduleLogger.debug('S3 client configuration created', {
      region: config.region,
      bucket: config.bucket,
      hasEndpoint: !!config.endpoint,
      forcePathStyle: config.forcePathStyle,
    });

    s3Client = new S3Client(clientConfig);

    moduleLogger.info('S3 client initialized', {
      region: config.region,
      bucket: config.bucket,
      endpoint: config.endpoint || 'AWS S3',
    });

    return s3Client;
  } catch (error) {
    const errorMsg = `Failed to initialize S3 client: ${error instanceof Error ? error.message : 'Unknown error'}`;
    moduleLogger.error(errorMsg, {}, error instanceof Error ? error : undefined);
    throw error;
  }
}

/**
 * Handle S3 error response with specific error messages
 *
 * @param error - The error object
 * @param bucket - The S3 bucket name
 * @param latencyMs - The response latency
 * @param moduleLogger - The logger instance
 * @returns Connection test response
 */
function handleS3Error(
  error: Error,
  bucket: string,
  latencyMs: number,
  moduleLogger: ReturnType<typeof logger.child>
): {
  success: boolean;
  message: string;
  latencyMs?: number;
} {
  const errorName = error.name;

  if (errorName === 'NotFound') {
    const errorMsg = `S3 bucket "${bucket}" does not exist or is not accessible`;
    moduleLogger.error(errorMsg, {}, error);
    return { success: false, message: errorMsg, latencyMs };
  }

  if (errorName === 'Forbidden') {
    const errorMsg = `Access denied to S3 bucket "${bucket}". Check credentials and bucket permissions`;
    moduleLogger.error(errorMsg, {}, error);
    return { success: false, message: errorMsg, latencyMs };
  }

  if (errorName === 'InvalidAccessKeyId' || errorName === 'SignatureDoesNotMatch') {
    const errorMsg = 'Invalid S3 credentials (access key or secret key)';
    moduleLogger.error(errorMsg, {}, error);
    return { success: false, message: errorMsg, latencyMs };
  }

  const errorMsg = `S3 connection test failed: ${error.message}`;
  moduleLogger.error(errorMsg, { errorName, bucket }, error);
  return { success: false, message: errorMsg, latencyMs };
}

/**
 * Test S3 connection by attempting to access the configured bucket
 * Measures latency and provides detailed error information
 *
 * @returns Promise with success status, message, and optional latency measurement
 */
export async function testS3Connection(): Promise<{
  success: boolean;
  message: string;
  latencyMs?: number;
}> {
  const moduleLogger = logger.child({ module: 's3:client' });
  const config = validateS3Config();

  // Check for configuration errors
  if (!config.isConfigured) {
    const errorMsg = `S3 configuration is invalid: ${config.errors.join('; ')}`;
    moduleLogger.error(errorMsg);
    return { success: false, message: errorMsg };
  }

  // Ensure credentials are available
  if (!config.accessKey || !config.secretKey) {
    const errorMsg = 'S3 credentials are not available';
    moduleLogger.error(errorMsg);
    return { success: false, message: errorMsg };
  }

  try {
    moduleLogger.debug('Creating S3 client for connection test', {
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
      forcePathStyle: config.forcePathStyle,
    });

    const testClient = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      ...(config.endpoint && {
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
      }),
    });

    const startTime = Date.now();

    try {
      const command = new HeadBucketCommand({ Bucket: config.bucket });
      moduleLogger.debug('Sending HeadBucketCommand', { bucket: config.bucket });

      await testClient.send(command);

      const latencyMs = Date.now() - startTime;
      moduleLogger.info('S3 connection test successful', { bucket: config.bucket, latencyMs });

      return {
        success: true,
        message: `Successfully connected to S3 bucket "${config.bucket}"`,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      if (error instanceof Error) {
        return handleS3Error(error, config.bucket, latencyMs, moduleLogger);
      }

      moduleLogger.error('S3 connection test failed with unknown error', {
        bucket: config.bucket,
      });
      return { success: false, message: 'S3 connection test failed with unknown error', latencyMs };
    } finally {
      testClient.destroy();
    }
  } catch (error) {
    const errorMsg = `Failed to initialize S3 client for test: ${
      error instanceof Error ? error.message : 'Unknown error'
    }`;
    moduleLogger.error(errorMsg, {}, error instanceof Error ? error : undefined);
    return { success: false, message: errorMsg };
  }
}

/**
 * Get the configured S3 bucket name
 * Validates S3 configuration and returns the bucket name
 *
 * @returns The S3 bucket name from configuration
 * @throws Error if bucket is not configured
 */
export function getS3Bucket(): string {
  const moduleLogger = logger.child({ module: 's3:client' });

  const config = validateS3Config();

  if (!config.bucket) {
    const errorMsg = 'S3 bucket not configured';
    moduleLogger.error(errorMsg);
    throw new Error(errorMsg);
  }

  moduleLogger.debug('Retrieved S3 bucket name', { bucket: config.bucket });
  return config.bucket;
}

/**
 * Build a properly formatted S3 key path for storing files
 * Respects S3_PATH_PREFIX if set, sanitizes the filename, and organizes by user/category
 *
 * Format: `{prefix}users/{userId}/{category}/{fileId}_{safeFilename}`
 * Example: `uploads/users/user123/documents/file456_my-document.pdf`
 *
 * @param userId - The user ID (usually a UUID)
 * @param fileId - The file ID (usually a UUID)
 * @param filename - The original filename (will be sanitized)
 * @param category - The category/folder (e.g., 'documents', 'images', 'uploads')
 * @returns The formatted S3 key path
 */
export function buildS3Key(
  userId: string,
  fileId: string,
  filename: string,
  category: string
): string {
  const moduleLogger = logger.child({ module: 's3:client' });

  const config = validateS3Config();
  const prefix = config.pathPrefix || '';
  const safeFilename = sanitizeFilename(filename);
  const key = `${prefix}users/${userId}/${category}/${fileId}_${safeFilename}`;

  moduleLogger.debug('Built S3 key', {
    userId,
    fileId,
    category,
    prefix: prefix || 'none',
    originalFilename: filename,
    safeFilename,
    key,
  });

  return key;
}
