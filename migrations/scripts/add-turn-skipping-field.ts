/**
 * Migration: Add "nothing to add" turn-skipping field
 *
 * One nullable column powering the multi-character turn-skipping feature — the
 * per-turn option for a character to pass ("nothing to add") and for the human
 * Skip button to feed the same stall guard.
 *
 *  - chats.turnSkippingEnabled INTEGER DEFAULT NULL
 *    Per-chat boolean toggle. NULL = enabled (the default); 0 = disabled.
 *
 * Migration ID: add-turn-skipping-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addTurnSkippingFieldMigration: Migration = {
  id: 'add-turn-skipping-field-v1',
  description: 'Add turnSkippingEnabled column to chats',
  introducedInVersion: '4.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const chatCols = getSQLiteTableColumns('chats').map((c) => c.name);
    return !chatCols.includes('turnSkippingEnabled');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const chatCols = getSQLiteTableColumns('chats').map((c) => c.name);
      if (!chatCols.includes('turnSkippingEnabled')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "turnSkippingEnabled" INTEGER DEFAULT NULL`);
        columnsAdded++;
      }

      logger.info('Added turn-skipping toggle column', {
        context: 'migration.add-turn-skipping-field',
        columnsAdded,
      });

      return {
        id: 'add-turn-skipping-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} turn-skipping column(s)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add turn-skipping column', {
        context: 'migration.add-turn-skipping-field',
        error: errorMessage,
      });

      return {
        id: 'add-turn-skipping-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: `Failed to add turn-skipping column: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
