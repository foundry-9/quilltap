/**
 * Migration: Validate S3 Configuration
 *
 * Validates S3 configuration and bucket access before file migration.
 * This migration ensures that the S3 backend is properly configured and accessible
 * before any file migration operations are attempted.
 *
 * What it does:
 * 1. Validates S3 configuration from environment variables
 * 2. Tests the S3 connection by accessing the configured bucket
 * 3. Ensures credentials are correct and bucket is accessible
 * 4. Measures latency to the S3 service
 *
 * This migration must pass before any file storage operations can proceed.
 */

import { validateS3Config, testS3Connection } from '@/lib/s3/config';
import { logger } from '@/lib/logger';
import type { Migration, MigrationResult } from '../migration-types';

/**
 * Validate S3 Configuration Migration
 */
export const validateS3ConfigMigration: Migration = {
  id: 'validate-s3-config-v1',
  description: 'Validate S3 configuration and bucket access before file migration',
  introducedInVersion: '2.0.0',

  async shouldRun(): Promise<boolean> {
    const logger_inst = logger.child({ context: 'migration.validate-s3-config' });

    logger_inst.debug('Checking if S3 config validation migration should run', {});

    // Validate S3 configuration
    const config = validateS3Config();

    // Only run if S3 is not disabled
    const shouldRun = config.mode !== 'disabled';

    logger_inst.debug('S3 config validation migration shouldRun check', {
      mode: config.mode,
      shouldRun,
      isConfigured: config.isConfigured,
    });

    return shouldRun;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const logger_inst = logger.child({ context: 'migration.validate-s3-config' });

    logger_inst.info('Starting S3 configuration validation migration', {});

    try {
      // Validate S3 configuration
      logger_inst.debug('Validating S3 configuration', {});
      const config = validateS3Config();

      if (!config.isConfigured) {
        const errorMsg = `S3 configuration is invalid: ${config.errors.join('; ')}`;
        logger_inst.error('S3 configuration validation failed', {
          errorCount: config.errors.length,
          errors: config.errors,
        });

        return {
          id: 'validate-s3-config-v1',
          success: false,
          itemsAffected: 0,
          message: errorMsg,
          error: errorMsg,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      logger_inst.debug('S3 configuration is valid, testing connection', {
        mode: config.mode,
        bucket: config.bucket,
      });

      // Test S3 connection
      const connectionTest = await testS3Connection();

      logger_inst.debug('S3 connection test completed', {
        success: connectionTest.success,
        message: connectionTest.message,
        latencyMs: connectionTest.latencyMs,
      });

      if (!connectionTest.success) {
        logger_inst.error('S3 connection test failed', {
          message: connectionTest.message,
          latencyMs: connectionTest.latencyMs,
        });

        return {
          id: 'validate-s3-config-v1',
          success: false,
          itemsAffected: 0,
          message: connectionTest.message,
          error: connectionTest.message,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const successMessage = `S3 configuration is valid and bucket is accessible (latency: ${connectionTest.latencyMs}ms)`;
      logger_inst.info('S3 configuration validation migration completed successfully', {
        bucket: config.bucket,
        latencyMs: connectionTest.latencyMs,
      });

      return {
        id: 'validate-s3-config-v1',
        success: true,
        itemsAffected: 1,
        message: successMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during S3 validation';
      logger_inst.error('S3 configuration validation migration failed with exception', {
        error: errorMessage,
      }, error instanceof Error ? error : undefined);

      return {
        id: 'validate-s3-config-v1',
        success: false,
        itemsAffected: 0,
        message: `S3 validation error: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
