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
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

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

    const columns = getSQLiteTableColumns('characters');
    const columnNames = columns.map((col) => col.name);
    return !columnNames.includes('archivedAt') || !columnNames.includes('archiveFileId') || !columnNames.includes('archivedAvatarFileId');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('characters')) {
        const columns = getSQLiteTableColumns('characters');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('archivedAt')) {
          db.exec('ALTER TABLE "characters" ADD COLUMN "archivedAt" TEXT');
          columnsAdded++;
        }

        if (!columnNames.includes('archiveFileId')) {
          db.exec('ALTER TABLE "characters" ADD COLUMN "archiveFileId" TEXT');
          columnsAdded++;
        }

        if (!columnNames.includes('archivedAvatarFileId')) {
          db.exec('ALTER TABLE "characters" ADD COLUMN "archivedAvatarFileId" TEXT');
          columnsAdded++;
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
