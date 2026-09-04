/**
 * Migration: Add Character Archive Fields
 *
 * Adds archivedAt, archiveFileId, and archivedAvatarFileId columns to the
 * characters table so archived characters can be tombstoned while preserving
 * their archive bundle and avatar thumbnail.
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'archivedAt', ddl: 'TEXT' },
  { name: 'archiveFileId', ddl: 'TEXT' },
  { name: 'archivedAvatarFileId', ddl: 'TEXT' },
];

export const addCharacterArchiveFieldsMigration: Migration = {
  id: 'add-character-archive-fields-v1',
  description: 'Add archive fields to the characters table',
  introducedInVersion: '4.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('characters')) {
      return false;
    }

    return COLUMNS.some((col) => !sqliteColumnExists('characters', col.name));
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      if (sqliteTableExists('characters')) {
        for (const col of COLUMNS) {
          if (addColumnIfMissing('characters', col.name, col.ddl)) {
            columnsAdded++;
          }
        }
      }

      logger.info('Added archive columns to characters table', {
        context: 'migration.add-character-archive-fields',
        columnsAdded,
      });

      return {
        id: 'add-character-archive-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to characters table`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add archive columns to characters table', {
        context: 'migration.add-character-archive-fields',
        error: message,
      });

      return {
        id: 'add-character-archive-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add archive columns to characters table',
        error: message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
