/**
 * Quilltap Upgrade Plugin
 *
 * This plugin handles version upgrades and data migrations.
 * It runs automatically at startup to ensure data compatibility across versions.
 *
 * Features:
 * - Runs migrations in dependency order
 * - Tracks completed migrations to avoid re-running
 * - Enables required provider plugins based on existing profiles
 * - Provides a central place for all upgrade logic
 */

import { logger } from '@/lib/logger';
import type { UpgradePlugin, UpgradeResult, MigrationState, Migration } from './migration-types';
import { runMigrations, getPendingMigrations, loadMigrationState } from './migration-runner';
import { migrations } from './migrations';

// ============================================================================
// LOGGER SETUP
// ============================================================================

const upgradeLogger = logger.child({
  module: 'upgrade-plugin',
});

// ============================================================================
// UPGRADE PLUGIN IMPLEMENTATION
// ============================================================================

/**
 * The upgrade plugin export
 */
export const plugin: UpgradePlugin = {
  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<UpgradeResult> {
    upgradeLogger.info('Starting upgrade migrations', {
      context: 'upgrade-plugin.runMigrations',
      totalMigrations: migrations.length,
    });

    const result = await runMigrations(migrations);

    if (result.success) {
      upgradeLogger.info('Upgrade migrations completed successfully', {
        context: 'upgrade-plugin.runMigrations',
        migrationsRun: result.migrationsRun,
        migrationsSkipped: result.migrationsSkipped,
        totalDurationMs: result.totalDurationMs,
      });
    } else {
      upgradeLogger.error('Upgrade migrations failed', {
        context: 'upgrade-plugin.runMigrations',
        results: result.results.filter(r => !r.success),
      });
    }

    return result;
  },

  /**
   * Check which migrations need to run
   */
  async getPendingMigrations(): Promise<string[]> {
    return getPendingMigrations(migrations);
  },

  /**
   * Get list of all available migrations
   */
  getAllMigrations(): Migration[] {
    return migrations;
  },

  /**
   * Get current migration state
   */
  async getMigrationState(): Promise<MigrationState> {
    return loadMigrationState();
  },
};

// ============================================================================
// EXPORTS
// ============================================================================

export default plugin;

// Re-export types
export type {
  Migration,
  MigrationResult,
  MigrationState,
  MigrationRecord,
  UpgradeResult,
  UpgradePlugin,
} from './migration-types';

// Re-export migration runner utilities
export {
  runMigrations,
  getPendingMigrations,
  loadMigrationState,
} from './migration-runner';

// Re-export individual migrations for testing
export { migrations } from './migrations';
