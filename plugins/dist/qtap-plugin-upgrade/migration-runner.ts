/**
 * Migration Runner
 *
 * Handles running migrations in the correct order and tracking completed migrations.
 * Supports both file-based (JSON) and MongoDB backends for migration state storage.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@/lib/logger';
import packageJson from '@/package.json';
import type {
  Migration,
  MigrationResult,
  MigrationState,
  MigrationRecord,
  UpgradeResult,
} from './migration-types';

// Path to store migration state (file-based)
const MIGRATIONS_STATE_FILE = path.join(process.cwd(), 'data', 'settings', 'migrations.json');

/**
 * Check if MongoDB backend is enabled
 */
function isMongoDBBackend(): boolean {
  const backend = process.env.DATA_BACKEND || '';
  return backend === 'mongodb' || backend === 'dual';
}

/**
 * Get MongoDB migrations repository (lazy load to avoid circular deps)
 */
async function getMongoMigrationsRepo() {
  const { getMongoMigrationsRepository } = await import('@/lib/mongodb/repositories/migrations.repository');
  return getMongoMigrationsRepository();
}

/**
 * Load the current migration state from storage (MongoDB or file)
 */
export async function loadMigrationState(): Promise<MigrationState> {
  // Use MongoDB if configured
  if (isMongoDBBackend()) {
    try {
      const repo = await getMongoMigrationsRepo();
      return await repo.loadState();
    } catch (error) {
      logger.warn('Failed to load migration state from MongoDB, falling back to file', {
        context: 'migration-runner.loadMigrationState',
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to file-based loading
    }
  }

  // File-based loading
  try {
    const content = await fs.readFile(MIGRATIONS_STATE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    // File doesn't exist or is invalid - return empty state
    return {
      completedMigrations: [],
      lastChecked: new Date().toISOString(),
      quilltapVersion: packageJson.version,
    };
  }
}

/**
 * Save migration state to storage (MongoDB or file)
 */
export async function saveMigrationState(state: MigrationState): Promise<void> {
  // Save to MongoDB if configured
  if (isMongoDBBackend()) {
    try {
      const repo = await getMongoMigrationsRepo();
      await repo.saveState(state);
      logger.debug('Migration state saved to MongoDB', {
        context: 'migration-runner.saveMigrationState',
      });
      return;
    } catch (error) {
      logger.warn('Failed to save migration state to MongoDB, falling back to file', {
        context: 'migration-runner.saveMigrationState',
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to file-based saving
    }
  }

  // File-based saving
  const dir = path.dirname(MIGRATIONS_STATE_FILE);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(
    MIGRATIONS_STATE_FILE,
    JSON.stringify(state, null, 2),
    'utf-8'
  );
}

/**
 * Check if a migration has already been completed
 */
export function isMigrationCompleted(state: MigrationState, migrationId: string): boolean {
  return state.completedMigrations.some(m => m.id === migrationId);
}

/**
 * Record a completed migration
 */
export async function recordCompletedMigration(
  state: MigrationState,
  result: MigrationResult
): Promise<MigrationState> {
  const record: MigrationRecord = {
    id: result.id,
    completedAt: result.timestamp,
    quilltapVersion: packageJson.version,
    itemsAffected: result.itemsAffected,
    message: result.message,
  };

  const updatedState: MigrationState = {
    ...state,
    completedMigrations: [...state.completedMigrations, record],
    lastChecked: new Date().toISOString(),
    quilltapVersion: packageJson.version,
  };

  await saveMigrationState(updatedState);
  return updatedState;
}

/**
 * Sort migrations by dependencies
 */
function sortMigrationsByDependency(migrations: Migration[]): Migration[] {
  const sorted: Migration[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(migration: Migration): void {
    if (visited.has(migration.id)) return;
    if (visiting.has(migration.id)) {
      throw new Error(`Circular dependency detected in migrations: ${migration.id}`);
    }

    visiting.add(migration.id);

    // Visit dependencies first
    if (migration.dependsOn) {
      for (const depId of migration.dependsOn) {
        const dep = migrations.find(m => m.id === depId);
        if (dep) {
          visit(dep);
        }
      }
    }

    visiting.delete(migration.id);
    visited.add(migration.id);
    sorted.push(migration);
  }

  for (const migration of migrations) {
    visit(migration);
  }

  return sorted;
}

/**
 * Run all pending migrations
 */
export async function runMigrations(migrations: Migration[]): Promise<UpgradeResult> {
  const startTime = Date.now();
  const results: MigrationResult[] = [];
  let migrationsRun = 0;
  let migrationsSkipped = 0;

  logger.info('Starting migration runner', {
    context: 'upgrade-plugin.runMigrations',
    totalMigrations: migrations.length,
  });

  // Load current state
  let state = await loadMigrationState();

  // Sort migrations by dependency
  const sortedMigrations = sortMigrationsByDependency(migrations);

  for (const migration of sortedMigrations) {
    // Check if already completed
    if (isMigrationCompleted(state, migration.id)) {
      logger.debug('Migration already completed, skipping', {
        context: 'upgrade-plugin.runMigrations',
        migrationId: migration.id,
      });
      migrationsSkipped++;
      continue;
    }

    // Check if migration should run
    const shouldRun = await migration.shouldRun();
    if (!shouldRun) {
      logger.debug('Migration conditions not met, skipping', {
        context: 'upgrade-plugin.runMigrations',
        migrationId: migration.id,
      });
      migrationsSkipped++;
      continue;
    }

    // Run the migration
    logger.info('Running migration', {
      context: 'upgrade-plugin.runMigrations',
      migrationId: migration.id,
      description: migration.description,
    });

    try {
      const result = await migration.run();
      results.push(result);

      if (result.success) {
        state = await recordCompletedMigration(state, result);
        migrationsRun++;
        logger.info('Migration completed successfully', {
          context: 'upgrade-plugin.runMigrations',
          migrationId: migration.id,
          itemsAffected: result.itemsAffected,
          durationMs: result.durationMs,
        });
      } else {
        logger.error('Migration failed', {
          context: 'upgrade-plugin.runMigrations',
          migrationId: migration.id,
          error: result.error,
        });
        // Stop on first failure
        break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Migration threw an exception', {
        context: 'upgrade-plugin.runMigrations',
        migrationId: migration.id,
        error: errorMessage,
      });

      results.push({
        id: migration.id,
        success: false,
        itemsAffected: 0,
        message: 'Migration failed with exception',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
      break;
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const allSucceeded = results.every(r => r.success);

  logger.info('Migration runner completed', {
    context: 'upgrade-plugin.runMigrations',
    success: allSucceeded,
    migrationsRun,
    migrationsSkipped,
    totalDurationMs,
  });

  return {
    success: allSucceeded,
    migrationsRun,
    migrationsSkipped,
    results,
    totalDurationMs,
  };
}

/**
 * Get list of pending migration IDs
 */
export async function getPendingMigrations(migrations: Migration[]): Promise<string[]> {
  const state = await loadMigrationState();
  const pending: string[] = [];

  for (const migration of migrations) {
    if (!isMigrationCompleted(state, migration.id)) {
      const shouldRun = await migration.shouldRun();
      if (shouldRun) {
        pending.push(migration.id);
      }
    }
  }

  return pending;
}
