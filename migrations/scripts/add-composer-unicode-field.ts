/**
 * Migration: Add composerUnicode Field to Chat Settings
 *
 * This migration adds a composerUnicode INTEGER field to the chat_settings table.
 * When enabled (the default), typing `\` plus at least two characters opens the
 * Unicode typeahead in the Salon ChatComposer and the Document Mode rich editor.
 * The formatting toolbar's symbol picker is deliberately NOT gated by this flag —
 * an explicit button press is never a surprise.
 *
 * Migration ID: add-composer-unicode-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addComposerUnicodeFieldMigration: Migration = {
  id: 'add-composer-unicode-field-v1',
  description:
    'Add composerUnicode field to chat_settings table for the composer Unicode typeahead toggle',
  introducedInVersion: '4.8.2',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chat_settings');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('composerUnicode');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const columns = getSQLiteTableColumns('chat_settings');
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes('composerUnicode')) {
        db.exec(`ALTER TABLE "chat_settings" ADD COLUMN "composerUnicode" INTEGER DEFAULT 1`);
        columnsAdded++;
        logger.info('Added composerUnicode column to chat_settings table', {
          context: 'migration.add-composer-unicode-field',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-composer-unicode-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added composerUnicode column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add composerUnicode column', {
        context: 'migration.add-composer-unicode-field',
        error: errorMessage,
      });

      return {
        id: 'add-composer-unicode-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add composerUnicode column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
