/**
 * Data Backend Configuration
 *
 * The application now exclusively uses MongoDB for data persistence.
 * JSON file storage has been deprecated.
 *
 * For migration from JSON to MongoDB, use the qtap-plugin-upgrade migration plugin.
 */

import { logger } from '@/lib/logger'

export type DataBackend = 'mongodb';

/**
 * Get the currently configured data backend (always MongoDB)
 */
export function getDataBackend(): DataBackend {
  return 'mongodb';
}

/**
 * Check if we should use MongoDB (always true)
 */
export function shouldUseMongoDB(): boolean {
  return true;
}

/**
 * Log backend configuration
 */
export function logBackendConfig(): void {
  logger.info('Data backend configuration', { context: { backend: 'MongoDB' } });
}
