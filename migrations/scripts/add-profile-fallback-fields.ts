/**
 * Migration: Add fallback-chain fields to connection profiles
 *
 * Adds two columns to `connection_profiles`:
 *
 *   - `fallbackProfileId` TEXT — the understudy: another profile to try when a
 *     call through this one fails outright. NULL means "no understudy named".
 *   - `allowTierFallback` INTEGER — whether Quilltap may draft one further
 *     candidate of the same or better model class when both named players are
 *     indisposed. 0 (off) for every existing profile: an auto-picked
 *     replacement spends money at a provider the user did not choose, so it is
 *     opt-in rather than something an upgrade turns on behind their back.
 *
 * No backfill beyond those defaults — there is no prior behaviour to preserve.
 * Before this, a dead or erroring provider simply failed the call.
 *
 * Migration ID: add-profile-fallback-fields-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'fallbackProfileId', ddl: 'TEXT' },
  { name: 'allowTierFallback', ddl: 'INTEGER DEFAULT 0' },
];

export const addProfileFallbackFieldsMigration: Migration = {
  id: 'add-profile-fallback-fields-v1',
  description:
    'Add fallbackProfileId and allowTierFallback columns to connection profiles, so every profile can name an understudy for when its provider fails',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-profile-multi-character-prefill-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('connection_profiles')) {
      return false;
    }

    return COLUMNS.some((col) => !sqliteColumnExists('connection_profiles', col.name));
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      let columnsAdded = 0;
      for (const col of COLUMNS) {
        if (addColumnIfMissing('connection_profiles', col.name, col.ddl)) {
          columnsAdded += 1;
        }
      }

      // Backfill any row the column default may have missed.
      const backfilled = db
        .prepare(
          'UPDATE "connection_profiles" SET "allowTierFallback" = 0 WHERE "allowTierFallback" IS NULL'
        )
        .run();

      // Verify
      if (COLUMNS.some((col) => !sqliteColumnExists('connection_profiles', col.name))) {
        throw new Error('Columns were not added successfully');
      }

      logger.info('Added fallback-chain columns to connection_profiles', {
        context: 'migration.add-profile-fallback-fields',
        columnsAdded,
        backfilledRows: backfilled.changes ?? 0,
      });

      return {
        id: 'add-profile-fallback-fields-v1',
        success: true,
        itemsAffected: backfilled.changes ?? 0,
        message: `Added ${columnsAdded} fallback column(s) to connection_profiles table (${backfilled.changes ?? 0} rows backfilled)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to add fallback-chain columns', {
        context: 'migration.add-profile-fallback-fields',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: 'add-profile-fallback-fields-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add fallback columns: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
