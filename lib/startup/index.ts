/**
 * Startup Module Exports
 *
 * Centralized exports for all startup/initialization functionality.
 */

import { getMongoDatabase, setupMongoDBShutdownHandlers } from '@/lib/mongodb/client';
import { validateMongoDBConfig, testMongoDBConnection } from '@/lib/mongodb/config';
import { ensureIndexes } from '@/lib/mongodb/indexes';
import { testS3Connection } from '@/lib/s3/client';
import { validateS3Config } from '@/lib/s3/config';
import { logger } from '@/lib/logger';

// Plugin initialization
export {
  initializePlugins,
  isPluginSystemInitialized,
  resetPluginSystem,
  getPluginSystemState,
  type PluginInitializationResult,
} from './plugin-initialization';

/**
 * Result of service initialization attempt
 */
export interface ServiceInitializationResult {
  service: string;
  initialized: boolean;
  message: string;
  latencyMs?: number;
}

/**
 * Initialize MongoDB if enabled in configuration
 *
 * Checks DATA_BACKEND environment variable to determine if MongoDB
 * should be initialized. If enabled, validates configuration, tests
 * connection, ensures indexes are created, and sets up shutdown handlers.
 */
export async function initializeMongoDBIfNeeded(): Promise<ServiceInitializationResult> {
  const startTime = Date.now();
  const dataBackend = process.env.DATA_BACKEND?.toLowerCase() || 'sqlite';

  logger.debug('Checking MongoDB initialization requirement', { dataBackend });

  // Check if MongoDB is enabled
  if (dataBackend !== 'mongodb' && dataBackend !== 'dual') {
    logger.debug('MongoDB not enabled', { dataBackend });
    return {
      service: 'mongodb',
      initialized: false,
      message: 'MongoDB not enabled',
      latencyMs: Date.now() - startTime,
    };
  }

  try {
    logger.info('Initializing MongoDB', { dataBackend });

    // Validate configuration
    logger.debug('Validating MongoDB configuration');
    validateMongoDBConfig();

    // Test connection
    logger.debug('Testing MongoDB connection');
    await testMongoDBConnection();

    // Get database and ensure indexes
    logger.debug('Getting MongoDB database connection');
    const db = await getMongoDatabase();

    logger.debug('Ensuring MongoDB indexes');
    await ensureIndexes(db);

    // Setup shutdown handlers
    logger.debug('Setting up MongoDB shutdown handlers');
    setupMongoDBShutdownHandlers();

    const latency = Date.now() - startTime;
    logger.info('MongoDB initialized successfully', { latencyMs: latency });

    return {
      service: 'mongodb',
      initialized: true,
      message: 'MongoDB initialized successfully',
      latencyMs: latency,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('MongoDB initialization failed', { error: errorMessage, latencyMs: latency });

    return {
      service: 'mongodb',
      initialized: false,
      message: `MongoDB initialization failed: ${errorMessage}`,
      latencyMs: latency,
    };
  }
}

/**
 * Initialize S3 if enabled in configuration
 *
 * Checks S3_MODE environment variable to determine if S3 should be
 * initialized. If not disabled, validates configuration and tests connection.
 */
export async function initializeS3IfNeeded(): Promise<ServiceInitializationResult> {
  const startTime = Date.now();
  const s3Mode = process.env.S3_MODE?.toLowerCase() || 'disabled';

  logger.debug('Checking S3 initialization requirement', { s3Mode });

  // Check if S3 is disabled
  if (s3Mode === 'disabled') {
    logger.debug('S3 not enabled');
    return {
      service: 's3',
      initialized: false,
      message: 'S3 not enabled',
      latencyMs: Date.now() - startTime,
    };
  }

  try {
    logger.info('Initializing S3', { s3Mode });

    // Validate configuration
    logger.debug('Validating S3 configuration');
    validateS3Config();

    // Test connection
    logger.debug('Testing S3 connection');
    await testS3Connection();

    const latency = Date.now() - startTime;
    logger.info('S3 initialized successfully', { latencyMs: latency });

    return {
      service: 's3',
      initialized: true,
      message: 'S3 initialized successfully',
      latencyMs: latency,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('S3 initialization failed', { error: errorMessage, latencyMs: latency });

    return {
      service: 's3',
      initialized: false,
      message: `S3 initialization failed: ${errorMessage}`,
      latencyMs: latency,
    };
  }
}

/**
 * Initialize all services in parallel where possible
 *
 * Coordinates initialization of MongoDB, S3, and the plugin system.
 * Services are initialized in parallel to minimize startup time.
 */
export async function initializeAllServices(): Promise<{
  mongodb: ServiceInitializationResult;
  s3: ServiceInitializationResult;
  plugins: any; // Using any to avoid circular dependency with PluginInitializationResult
}> {
  logger.info('Starting service initialization');

  try {
    // Initialize MongoDB and S3 in parallel
    const [mongodbResult, s3Result] = await Promise.all([
      initializeMongoDBIfNeeded(),
      initializeS3IfNeeded(),
    ]);

    // Import plugins initialization dynamically to avoid circular deps
    const { initializePlugins } = await import('./plugin-initialization');

    // Initialize plugins
    logger.debug('Initializing plugin system');
    const pluginsResult = await initializePlugins();

    logger.info('All services initialized', {
      mongodb: { initialized: mongodbResult.initialized, service: mongodbResult.service },
      s3: { initialized: s3Result.initialized, service: s3Result.service },
      plugins: { success: pluginsResult.success },
    });

    return {
      mongodb: mongodbResult,
      s3: s3Result,
      plugins: pluginsResult,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Service initialization failed', { error: errorMessage });
    throw error;
  }
}
