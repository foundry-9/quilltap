/**
 * Health check endpoint for monitoring
 * Checks connectivity for JSON store, MongoDB (optional), and S3 (optional)
 * Returns 200 OK if healthy, 503 if degraded or unhealthy
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/json-store/repositories';
import { validateMongoDBConfig, testMongoDBConnection } from '@/lib/mongodb/config';
import { validateS3Config, testS3Connection } from '@/lib/s3/config';

export const dynamic = 'force-dynamic';

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

interface ServiceHealth {
  status: HealthStatus;
  message: string;
  latencyMs?: number;
  mode?: string;
}

interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  environment: string | undefined;
  services: {
    json?: ServiceHealth;
    mongodb?: ServiceHealth;
    s3?: ServiceHealth;
  };
}

/**
 * Check JSON store health
 */
async function checkJsonStoreHealth(
  healthLogger: ReturnType<typeof logger.child>,
  services: HealthResponse['services'],
  serviceStatuses: HealthStatus[]
): Promise<void> {
  healthLogger.debug('Checking JSON store health');
  try {
    const repos = getRepositories();
    await repos.users.getCurrentUser();

    services.json = {
      status: 'healthy',
      message: 'JSON store is operational',
    };
    serviceStatuses.push('healthy');
    healthLogger.debug('JSON store health check passed');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    services.json = {
      status: 'unhealthy',
      message: `JSON store check failed: ${errorMessage}`,
    };
    serviceStatuses.push('unhealthy');
    healthLogger.warn('JSON store health check failed', { error: errorMessage });
  }
}

/**
 * Check MongoDB health
 */
async function checkMongoDBHealth(
  healthLogger: ReturnType<typeof logger.child>,
  services: HealthResponse['services'],
  serviceStatuses: HealthStatus[]
): Promise<void> {
  healthLogger.debug('Checking MongoDB health', { dataBackend: process.env.DATA_BACKEND });

  const mongoConfig = validateMongoDBConfig();

  if (mongoConfig.isConfigured) {
    try {
      const mongoResult = await testMongoDBConnection();

      if (mongoResult.success) {
        services.mongodb = {
          status: 'healthy',
          message: mongoResult.message,
          latencyMs: mongoResult.latencyMs,
        };
        serviceStatuses.push('healthy');
        healthLogger.debug('MongoDB health check passed', {
          latencyMs: mongoResult.latencyMs,
        });
      } else {
        services.mongodb = {
          status: 'unhealthy',
          message: mongoResult.message,
          latencyMs: mongoResult.latencyMs,
        };
        serviceStatuses.push('unhealthy');
        healthLogger.warn('MongoDB health check failed', {
          message: mongoResult.message,
          latencyMs: mongoResult.latencyMs,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      services.mongodb = {
        status: 'unhealthy',
        message: `MongoDB connection test error: ${errorMessage}`,
      };
      serviceStatuses.push('unhealthy');
      healthLogger.error('MongoDB health check error', { error: errorMessage });
    }
  } else {
    services.mongodb = {
      status: 'degraded',
      message: `MongoDB not properly configured: ${mongoConfig.errors.join('; ')}`,
    };
    serviceStatuses.push('degraded');
    healthLogger.warn('MongoDB configuration invalid', { errors: mongoConfig.errors });
  }
}

/**
 * Check S3 health
 */
async function checkS3Health(
  healthLogger: ReturnType<typeof logger.child>,
  services: HealthResponse['services'],
  serviceStatuses: HealthStatus[]
): Promise<void> {
  healthLogger.debug('Checking S3 health', { s3Mode: process.env.S3_MODE });

  const s3Config = validateS3Config();

  if (s3Config.isConfigured) {
    try {
      const s3Result = await testS3Connection();

      if (s3Result.success) {
        services.s3 = {
          status: 'healthy',
          message: s3Result.message,
          latencyMs: s3Result.latencyMs,
          mode: s3Config.mode,
        };
        serviceStatuses.push('healthy');
        healthLogger.debug('S3 health check passed', {
          latencyMs: s3Result.latencyMs,
          mode: s3Config.mode,
        });
      } else {
        services.s3 = {
          status: 'unhealthy',
          message: s3Result.message,
          latencyMs: s3Result.latencyMs,
          mode: s3Config.mode,
        };
        serviceStatuses.push('unhealthy');
        healthLogger.warn('S3 health check failed', {
          message: s3Result.message,
          latencyMs: s3Result.latencyMs,
          mode: s3Config.mode,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      services.s3 = {
        status: 'unhealthy',
        message: `S3 connection test error: ${errorMessage}`,
        mode: s3Config.mode,
      };
      serviceStatuses.push('unhealthy');
      healthLogger.error('S3 health check error', { error: errorMessage });
    }
  } else {
    services.s3 = {
      status: 'degraded',
      message: `S3 not properly configured: ${s3Config.errors.join('; ')}`,
      mode: s3Config.mode,
    };
    serviceStatuses.push('degraded');
    healthLogger.warn('S3 configuration invalid', {
      errors: s3Config.errors,
      mode: s3Config.mode,
    });
  }
}

/**
 * Determine overall health status from service statuses
 */
function getOverallStatus(serviceStatuses: HealthStatus[]): HealthStatus {
  if (serviceStatuses.includes('unhealthy')) {
    return 'unhealthy';
  }
  if (serviceStatuses.includes('degraded')) {
    return 'degraded';
  }
  return 'healthy';
}

/**
 * Get HTTP status code based on overall health status
 */
function getStatusCode(status: HealthStatus): number {
  return status === 'healthy' ? 200 : 503;
}

export async function GET() {
  const healthLogger = logger.child({ module: 'health' });
  const startTime = Date.now();

  try {
    healthLogger.debug('Starting health check');

    const timestamp = new Date().toISOString();
    const uptime = process.uptime();
    const environment = process.env.NODE_ENV;
    const dataBackend = process.env.DATA_BACKEND || 'json';
    const s3Mode = process.env.S3_MODE || 'disabled';

    const services: HealthResponse['services'] = {};
    const serviceStatuses: HealthStatus[] = [];

    // Check JSON store (always available as fallback)
    await checkJsonStoreHealth(healthLogger, services, serviceStatuses);

    // Check MongoDB if configured as data backend
    if (dataBackend === 'mongodb' || dataBackend === 'dual') {
      await checkMongoDBHealth(healthLogger, services, serviceStatuses);
    }

    // Check S3 if enabled
    if (s3Mode !== 'disabled') {
      await checkS3Health(healthLogger, services, serviceStatuses);
    }

    // Determine overall status
    const overallStatus = getOverallStatus(serviceStatuses);
    const statusCode = getStatusCode(overallStatus);

    const health: HealthResponse = {
      status: overallStatus,
      timestamp,
      uptime,
      environment,
      services,
    };

    const checkDuration = Date.now() - startTime;
    healthLogger.info('Health check complete', {
      status: overallStatus,
      statusCode,
      durationMs: checkDuration,
      servicesChecked: Object.keys(services),
    });

    return NextResponse.json(health, { status: statusCode });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const checkDuration = Date.now() - startTime;

    const health: HealthResponse = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      services: {
        json: {
          status: 'unhealthy',
          message: `Unexpected health check error: ${errorMessage}`,
        },
      },
    };

    healthLogger.error('Health check failed with unexpected error', {
      error: errorMessage,
      durationMs: checkDuration,
    });

    return NextResponse.json(health, { status: 503 });
  }
}
