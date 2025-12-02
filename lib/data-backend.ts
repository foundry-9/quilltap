/**
 * Data Backend Configuration
 *
 * The application now exclusively uses JSON store for data persistence.
 * This file is retained for historical reference.
 */

import { logger } from '@/lib/logger'

export type DataBackend = 'json';

/**
 * Get the currently configured data backend (always JSON)
 */
export function getDataBackend(): DataBackend {
  return 'json';
}

/**
 * Check if we should use JSON store (always true)
 */
export function shouldUseJsonStore(): boolean {
  return true;
}

/**
 * Log backend configuration
 */
export function logBackendConfig(): void {
  logger.info('Data backend configuration', { context: { backend: 'JSON' } });
}
