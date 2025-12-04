/**
 * MongoDB configuration module
 * Handles validation and connection testing for MongoDB
 */

import { z } from 'zod';
import { MongoClient } from 'mongodb';
import { logger } from '@/lib/logger';

/**
 * Zod schema for MongoDB configuration validation
 */
const mongoDBConfigSchema = z.object({
  uri: z.string().min(1, 'MongoDB URI is required'),
  database: z.string().min(1, 'Database name is required'),
  mode: z.enum(['external', 'embedded']).default('external'),
  dataDir: z.string().optional(),
  connectionTimeoutMs: z.number().int().positive().default(10000),
  maxPoolSize: z.number().int().positive().default(10),
});

/**
 * MongoDB configuration interface
 */
export interface MongoDBConfig {
  uri: string;
  database: string;
  mode: 'external' | 'embedded';
  dataDir?: string;
  connectionTimeoutMs: number;
  maxPoolSize: number;
  isConfigured: boolean;
  errors: string[];
}

/**
 * Sanitize MongoDB URI for logging by masking password
 * @param uri - The MongoDB connection URI
 * @returns Sanitized URI with masked password
 */
function sanitizeURI(uri: string): string {
  try {
    // Pattern: mongodb://[username[:password]@]host[:port]/[database]
    return uri.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1****$2');
  } catch {
    return uri.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1****$2');
  }
}

/**
 * Get MongoDB configuration from environment variables
 * @returns Parsed MongoDB configuration
 */
function getMongoDBConfigFromEnv(): Partial<MongoDBConfig> {
  const dataBackend = process.env.DATA_BACKEND || 'json';
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const database = process.env.MONGODB_DATABASE || 'quilltap';
  const mode = (process.env.MONGODB_MODE || 'external') as 'external' | 'embedded';
  const dataDir = process.env.MONGODB_DATA_DIR || '/data/mongodb';
  const connectionTimeoutMs = process.env.MONGODB_CONNECTION_TIMEOUT_MS
    ? Number.parseInt(process.env.MONGODB_CONNECTION_TIMEOUT_MS)
    : 10000;
  const maxPoolSize = process.env.MONGODB_MAX_POOL_SIZE
    ? Number.parseInt(process.env.MONGODB_MAX_POOL_SIZE)
    : 10;

  return {
    uri,
    database,
    mode,
    dataDir,
    connectionTimeoutMs,
    maxPoolSize,
  };
}

/**
 * Validate MongoDB configuration
 * Returns configuration object with isConfigured flag and any validation errors
 *
 * @returns MongoDBConfig object with validation results
 */
export function validateMongoDBConfig(): MongoDBConfig {
  logger.debug('Validating MongoDB configuration', {
    dataBackend: process.env.DATA_BACKEND,
    mode: process.env.MONGODB_MODE,
  });

  const config = getMongoDBConfigFromEnv();
  const errors: string[] = [];
  let isConfigured = false;

  try {
    const validated = mongoDBConfigSchema.parse(config);

    logger.debug('MongoDB configuration validated successfully', {
      database: validated.database,
      mode: validated.mode,
      uri: sanitizeURI(validated.uri),
      connectionTimeoutMs: validated.connectionTimeoutMs,
      maxPoolSize: validated.maxPoolSize,
    });

    isConfigured = true;

    return {
      ...validated,
      isConfigured,
      errors,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const validationErrors = error.errors.map((err) => {
        const path = err.path.join('.');
        return `${path}: ${err.message}`;
      });

      errors.push(...validationErrors);

      logger.warn('MongoDB configuration validation failed', {
        errors: validationErrors,
      });
    } else {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(errorMessage);
      logger.error('MongoDB configuration validation error', {
        error: errorMessage,
      });
    }

    return {
      uri: config.uri || '',
      database: config.database || '',
      mode: (config.mode as 'external' | 'embedded') || 'external',
      dataDir: config.dataDir,
      connectionTimeoutMs: config.connectionTimeoutMs || 10000,
      maxPoolSize: config.maxPoolSize || 10,
      isConfigured,
      errors,
    };
  }
}

/**
 * Test MongoDB connection
 * Attempts to connect and run a ping command, measuring latency
 *
 * @returns Promise with success status, message, and optional latency
 */
export async function testMongoDBConnection(): Promise<{
  success: boolean;
  message: string;
  latencyMs?: number;
}> {
  // Return early if using JSON backend
  if (process.env.DATA_BACKEND === 'json') {
    logger.debug('Data backend is JSON, skipping MongoDB connection test');
    return {
      success: true,
      message: 'JSON backend is configured, MongoDB not required',
    };
  }

  const config = validateMongoDBConfig();

  if (!config.isConfigured) {
    const errorMessage = `MongoDB configuration invalid: ${config.errors.join(', ')}`;
    logger.error('Cannot test MongoDB connection - configuration invalid', {
      errors: config.errors,
    });
    return {
      success: false,
      message: errorMessage,
    };
  }

  let client: MongoClient | null = null;
  const startTime = Date.now();

  try {
    logger.debug('Attempting MongoDB connection', {
      uri: sanitizeURI(config.uri),
      timeout: config.connectionTimeoutMs,
    });

    client = new MongoClient(config.uri, {
      serverSelectionTimeoutMS: config.connectionTimeoutMs,
      connectTimeoutMS: config.connectionTimeoutMs,
      maxPoolSize: config.maxPoolSize,
    });

    // Attempt to connect and ping the server
    await client.connect();
    const admin = client.db('admin');
    await admin.command({ ping: 1 });

    const latencyMs = Date.now() - startTime;

    logger.info('MongoDB connection test successful', {
      uri: sanitizeURI(config.uri),
      database: config.database,
      latencyMs,
    });

    return {
      success: true,
      message: `Successfully connected to MongoDB (${latencyMs}ms)`,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('MongoDB connection test failed', {
      uri: sanitizeURI(config.uri),
      error: errorMessage,
      latencyMs,
    });

    return {
      success: false,
      message: `MongoDB connection failed: ${errorMessage}`,
      latencyMs,
    };
  } finally {
    if (client) {
      try {
        await client.close();
        logger.debug('MongoDB client connection closed');
      } catch (error) {
        const closeError = error instanceof Error ? error.message : 'Unknown error';
        logger.warn('Error closing MongoDB connection', {
          error: closeError,
        });
      }
    }
  }
}
