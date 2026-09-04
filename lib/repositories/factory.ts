/**
 * Repository Factory
 *
 * Provides access to the SQLite-backed data repositories.
 *
 * With the new migration system, migrations run in instrumentation.ts BEFORE
 * the server starts accepting requests, so data is always guaranteed to be
 * in the correct format.
 */

import { logger } from '@/lib/logger';
import {
  getRepositories as getDatabaseRepos,
  RepositoryContainer as DatabaseRepositoryContainer,
} from '@/lib/database/repositories';
import { getDatabaseConfig } from '@/lib/database/config';
import {
  getUserRepositories,
  clearUserRepositoryCache,
  type UserScopedRepositoryContainer,
} from './user-scoped';
import { startupState } from '@/lib/startup/startup-state';

/**
 * Type alias for repository container
 * Uses the database abstraction container as the canonical interface
 */
export type RepositoryContainer = DatabaseRepositoryContainer;

/**
 * Lazy-loaded repository cache
 */
let cachedRepositories: RepositoryContainer | null = null;

/**
 * Track if we've already waited for migrations (safety check only)
 */
let migrationWaitComplete = false;

/**
 * Ensure migrations have completed before serving data
 *
 * With the new migration system, migrations run in instrumentation.ts
 * BEFORE the server starts accepting any requests. If migrations fail,
 * the process exits immediately.
 */
async function ensureMigrationsComplete(): Promise<void> {
  // Only check once per process
  if (migrationWaitComplete) {
    return;
  }

  // Check in-memory state first (fastest check)
  if (startupState.areMigrationsComplete()) {
    migrationWaitComplete = true;
    return;
  }

  // Fall back to the in-memory wait for edge cases
  const phase = startupState.getPhase();
  if (phase === 'pending' || phase === 'migrations' || phase === 'plugins') {
    logger.info('Waiting for migrations to complete before serving data', {
      context: 'repository-factory.ensureMigrationsComplete',
      currentPhase: phase,
    });

    // Wait for migrations (with 30 second timeout)
    const migrationsComplete = await startupState.waitForMigrations(30000);

    if (migrationsComplete) {
      logger.info('Migrations complete, proceeding with data access', {
        context: 'repository-factory.ensureMigrationsComplete',
      });
    } else {
      // Final fallback - proceed anyway since migrations likely completed in another process
      logger.warn('In-memory migration wait timed out, proceeding (migrations likely completed in instrumentation)', {
        context: 'repository-factory.ensureMigrationsComplete',
        currentPhase: startupState.getPhase(),
      });
    }
  }

  migrationWaitComplete = true;
}

/**
 * Get the repository container
 *
 * Uses the database abstraction layer which automatically selects
 * the appropriate backend based on configuration.
 *
 * @returns RepositoryContainer for the configured backend
 */
export function getRepositories(): RepositoryContainer {
  // Return cached repositories if already initialized
  if (cachedRepositories) {
    return cachedRepositories;
  }

  // Inside the forked job-runner child, hand back a proxy that intercepts
  // writes (buffering them for the parent to apply) and passes reads
  // through to the readonly SQLCipher connection.
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    // Lazy require keeps proxy code out of the parent's module graph.
    const { getChildRepositoriesProxy } = require('@/lib/background-jobs/child/child-repositories-proxy') as
      typeof import('@/lib/background-jobs/child/child-repositories-proxy');
    cachedRepositories = getChildRepositoriesProxy();
    return cachedRepositories;
  }

  cachedRepositories = getDatabaseRepos();
  return cachedRepositories;
}

/**
 * Get the repository container with migration safety check
 *
 * With the new migration system, migrations run before the server accepts
 * any requests, so this is now just a safety check. The await call is kept
 * for backwards compatibility with existing code patterns.
 *
 * Use this for API routes and other request handlers.
 *
 * @returns Promise<RepositoryContainer> for SQLite backend
 */
export async function getRepositoriesSafe(): Promise<RepositoryContainer> {
  // Safety check - migrations should already be complete
  await ensureMigrationsComplete();

  return getRepositories();
}

/**
 * Reset repository caches
 * Useful for testing or resetting state
 */
export function resetRepositories(): void {
  cachedRepositories = null;
  clearUserRepositoryCache();
  logger.info('Repository caches cleared');
}

// Re-export user-scoped repository functions
export { getUserRepositories, clearUserRepositoryCache };
export type { UserScopedRepositoryContainer };
