/**
 * S3 Configuration Module
 * Handles configuration validation and connection testing for S3 storage
 * Supports AWS S3, MinIO, and other S3-compatible services
 */

import { z } from 'zod';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { logger } from '@/lib/logger';

/**
 * Zod schema for S3 configuration validation
 */
const s3ConfigSchema = z.object({
  mode: z.enum(['embedded', 'external', 'disabled']),
  endpoint: z.string().url().optional(),
  region: z.string().min(1, 'S3 region is required'),
  accessKey: z.string().optional(),
  secretKey: z.string().optional(),
  bucket: z.string().min(1, 'S3 bucket name is required'),
  pathPrefix: z.string().optional(),
  publicUrl: z.string().url().optional(),
  forcePathStyle: z.boolean(),
});

/**
 * S3 storage mode type
 */
export type S3Mode = 'embedded' | 'external' | 'disabled';

/**
 * S3 Configuration Interface
 * Contains all configuration settings and validation state
 */
export interface S3Config {
  /** Storage mode: embedded (app-managed), external (user-provided), or disabled */
  mode: S3Mode;
  /** Optional endpoint URL for MinIO or other S3-compatible services */
  endpoint?: string;
  /** AWS region (default: us-east-1) */
  region: string;
  /** Access key ID for authentication */
  accessKey?: string;
  /** Secret access key for authentication */
  secretKey?: string;
  /** S3 bucket name */
  bucket: string;
  /** Optional prefix for all object keys */
  pathPrefix?: string;
  /** Optional public URL for serving files (CDN) */
  publicUrl?: string;
  /** Use path-style URLs instead of virtual-hosted-style */
  forcePathStyle: boolean;
  /** Whether configuration is valid and complete */
  isConfigured: boolean;
  /** Array of validation errors, if any */
  errors: string[];
}

/**
 * Sanitize S3 credentials for logging by masking sensitive data
 * @param accessKey - The S3 access key
 * @param secretKey - The S3 secret key
 * @returns Object with masked credentials for safe logging
 */
function sanitizeCredentials(
  accessKey?: string,
  secretKey?: string
): { accessKey: string; secretKey: string } {
  const maskSecret = () => '****';
  return {
    accessKey: accessKey ? `${accessKey.slice(0, 4)}...${accessKey.slice(-4)}` : maskSecret(),
    secretKey: maskSecret(),
  };
}

/**
 * Sanitize S3 endpoint URL for logging
 * @param endpoint - The S3 endpoint URL
 * @returns Sanitized endpoint URL or undefined
 */
function sanitizeEndpoint(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;
  try {
    const url = new URL(endpoint);
    return url.toString();
  } catch {
    return '****';
  }
}

/**
 * Validate required credentials for non-disabled mode
 * @param mode - S3 mode
 * @param accessKey - S3 access key
 * @param secretKey - S3 secret key
 * @param logger_inst - Logger instance
 * @returns Array of validation errors
 */
function validateCredentials(
  mode: S3Mode,
  accessKey: string | undefined,
  secretKey: string | undefined,
  logger_inst: ReturnType<typeof logger.child>
): string[] {
  const errors: string[] = [];

  if (mode === 'disabled') {
    return errors;
  }

  if (!accessKey) {
    const errorMsg = 'S3_ACCESS_KEY is required when S3_MODE is not disabled';
    logger_inst.warn(errorMsg);
    errors.push(errorMsg);
  }

  if (!secretKey) {
    const errorMsg = 'S3_SECRET_KEY is required when S3_MODE is not disabled';
    logger_inst.warn(errorMsg);
    errors.push(errorMsg);
  }

  return errors;
}

/**
 * Validate region and endpoint configuration
 * @param mode - S3 mode
 * @param endpoint - S3 endpoint URL
 * @param region - S3 region
 * @param logger_inst - Logger instance
 * @returns Array of validation errors
 */
function validateRegionEndpoint(
  mode: S3Mode,
  endpoint: string | undefined,
  region: string,
  logger_inst: ReturnType<typeof logger.child>
): string[] {
  const errors: string[] = [];

  if (mode === 'external' && !endpoint && !region.trim()) {
    const errorMsg = 'S3_REGION is required for external S3 mode when S3_ENDPOINT is not set';
    logger_inst.warn(errorMsg);
    errors.push(errorMsg);
  }

  return errors;
}

/**
 * Validates S3 configuration from environment variables
 * Collects all validation errors without throwing
 *
 * Validation rules:
 * - If mode !== 'disabled', accessKey and secretKey are required
 * - If mode === 'external' and no endpoint, region is required
 * - If endpoint is set, forcePathStyle defaults to true
 *
 * @returns S3Config object with validation status and errors array
 */
export function validateS3Config(): S3Config {
  const logger_inst = logger.child({ module: 's3:config' });

  const mode = (process.env.S3_MODE || 'disabled') as S3Mode;
  const errors: string[] = [];

  logger_inst.debug('Starting S3 configuration validation', {
    mode,
    endpoint: sanitizeEndpoint(process.env.S3_ENDPOINT),
    bucket: process.env.S3_BUCKET,
  });

  // If disabled, return early with minimal config
  if (mode === 'disabled') {
    logger_inst.debug('S3 mode is disabled, skipping validation');
    return {
      mode,
      region: 'us-east-1',
      bucket: '',
      forcePathStyle: false,
      isConfigured: true,
      errors: [],
    };
  }

  // Extract configuration values from environment
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || 'us-east-1';
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET || 'quilltap-files';
  const pathPrefix = process.env.S3_PATH_PREFIX;
  const publicUrl = process.env.S3_PUBLIC_URL;
  const forcePathStyle = endpoint ? true : process.env.S3_FORCE_PATH_STYLE === 'true';

  // Perform custom validation checks
  errors.push(
    ...validateCredentials(mode, accessKey, secretKey, logger_inst),
    ...validateRegionEndpoint(mode, endpoint, region, logger_inst)
  );

  // Build configuration object for Zod validation
  const configData = {
    mode,
    endpoint: endpoint || undefined,
    region,
    accessKey: accessKey || undefined,
    secretKey: secretKey || undefined,
    bucket,
    pathPrefix: pathPrefix || undefined,
    publicUrl: publicUrl || undefined,
    forcePathStyle,
  };

  // If custom validation errors exist, return early
  if (errors.length > 0) {
    logger_inst.info('S3 configuration validation complete', {
      mode,
      isConfigured: false,
      errorCount: errors.length,
      hasEndpoint: !!endpoint,
      hasPublicUrl: !!publicUrl,
      bucket,
    });

    return {
      ...configData,
      isConfigured: false,
      errors,
    };
  }

  // Validate with Zod schema
  try {
    const validated = s3ConfigSchema.parse(configData);

    logger_inst.debug('S3 configuration validated successfully with Zod schema', {
      mode: validated.mode,
      endpoint: sanitizeEndpoint(validated.endpoint),
      region: validated.region,
      bucket: validated.bucket,
      forcePathStyle: validated.forcePathStyle,
      credentials: sanitizeCredentials(validated.accessKey, validated.secretKey),
    });

    logger_inst.info('S3 configuration validation complete', {
      mode: validated.mode,
      isConfigured: true,
      errorCount: 0,
      hasEndpoint: !!validated.endpoint,
      hasPublicUrl: !!validated.publicUrl,
      bucket: validated.bucket,
    });

    return {
      ...validated,
      isConfigured: true,
      errors: [],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const validationErrors = error.errors.map((err) => {
        const path = err.path.join('.');
        return `${path}: ${err.message}`;
      });

      errors.push(...validationErrors);

      logger_inst.warn('S3 configuration validation failed with Zod schema', {
        errors: validationErrors,
        mode,
      });
    } else {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(errorMessage);
      logger_inst.error('S3 configuration validation error', {
        error: errorMessage,
        mode,
      });
    }

    logger_inst.info('S3 configuration validation complete', {
      mode,
      isConfigured: false,
      errorCount: errors.length,
      hasEndpoint: !!endpoint,
      hasPublicUrl: !!publicUrl,
      bucket,
    });

    return {
      ...configData,
      isConfigured: false,
      errors,
    };
  }
}

/**
 * Check if S3 is enabled in the current configuration
 * Returns false if S3_MODE is 'disabled'
 *
 * @returns boolean True if S3 is enabled, false if disabled
 */
export function isS3Enabled(): boolean {
  const mode = (process.env.S3_MODE || 'disabled') as S3Mode;
  return mode !== 'disabled';
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
  const logger_inst = logger.child({ module: 's3:config' });

  const config = validateS3Config();

  // Return early if S3 is disabled
  if (config.mode === 'disabled') {
    logger_inst.debug('S3 mode is disabled, skipping connection test');
    return {
      success: true,
      message: 'S3 is disabled',
    };
  }

  // Check for configuration errors
  if (!config.isConfigured) {
    const errorMsg = `S3 configuration is invalid: ${config.errors.join('; ')}`;
    logger_inst.error(errorMsg);
    return {
      success: false,
      message: errorMsg,
    };
  }

  // Ensure credentials are available
  if (!config.accessKey || !config.secretKey) {
    const errorMsg = 'S3 credentials are not available';
    logger_inst.error(errorMsg);
    return {
      success: false,
      message: errorMsg,
    };
  }

  try {
    logger_inst.debug('Creating S3 client for connection test', {
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
      forcePathStyle: config.forcePathStyle,
    });

    // Create S3 client with configuration
    const client = new S3Client({
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

    // Measure latency
    const startTime = Date.now();

    try {
      // Use HeadBucketCommand to test access to the bucket
      const command = new HeadBucketCommand({
        Bucket: config.bucket,
      });

      logger_inst.debug('Sending HeadBucketCommand', { bucket: config.bucket });

      await client.send(command);

      const latencyMs = Date.now() - startTime;

      logger_inst.info('S3 connection test successful', {
        bucket: config.bucket,
        latencyMs,
      });

      return {
        success: true,
        message: `Successfully connected to S3 bucket "${config.bucket}"`,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      // Handle specific S3 errors
      if (error instanceof Error) {
        const errorName = error.name;

        if (errorName === 'NotFound') {
          const errorMsg = `S3 bucket "${config.bucket}" does not exist or is not accessible`;
          logger_inst.error(errorMsg, {}, error);
          return {
            success: false,
            message: errorMsg,
            latencyMs,
          };
        }

        if (errorName === 'Forbidden') {
          const errorMsg = `Access denied to S3 bucket "${config.bucket}". Check credentials and bucket permissions`;
          logger_inst.error(errorMsg, {}, error);
          return {
            success: false,
            message: errorMsg,
            latencyMs,
          };
        }

        if (errorName === 'InvalidAccessKeyId' || errorName === 'SignatureDoesNotMatch') {
          const errorMsg = 'Invalid S3 credentials (access key or secret key)';
          logger_inst.error(errorMsg, {}, error);
          return {
            success: false,
            message: errorMsg,
            latencyMs,
          };
        }

        const errorMsg = `S3 connection test failed: ${error.message}`;
        logger_inst.error(errorMsg, {
          errorName,
          bucket: config.bucket,
        }, error);
        return {
          success: false,
          message: errorMsg,
          latencyMs,
        };
      }

      logger_inst.error('S3 connection test failed with unknown error', {
        bucket: config.bucket,
      });
      return {
        success: false,
        message: 'S3 connection test failed with unknown error',
        latencyMs,
      };
    } finally {
      // Clean up client
      client.destroy();
    }
  } catch (error) {
    const errorMsg = `Failed to initialize S3 client: ${error instanceof Error ? error.message : 'Unknown error'}`;
    logger_inst.error(errorMsg, {}, error instanceof Error ? error : undefined);
    return {
      success: false,
      message: errorMsg,
    };
  }
}
