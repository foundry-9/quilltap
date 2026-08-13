/**
 * Migration: Add smartTypographySettings Field to Chat Settings
 *
 * This migration adds a smartTypographySettings TEXT (JSON) field to the
 * chat_settings table. It carries three flags:
 *
 * - `displayQuotes` — curl quotes when *rendering* messages. Off by default:
 *   the setting is reversible and touches no stored byte, but flipping it
 *   restyles the whole of an existing conversation history at once, which is
 *   startling if nobody asked for it.
 * - `dashes` / `ellipsis` — rewrite `--`/`---`/`...` into real characters as
 *   the writer types. On by default: unambiguous, genuinely part of the
 *   content, and one Backspace away from being undone.
 *
 * Migration ID: add-smart-typography-settings-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

/**
 * Column default. Must match `SmartTypographySettingsSchema`'s defaults in
 * `lib/schemas/settings.types.ts` and the repository's `updateForUser` seed.
 */
const DEFAULT_SMART_TYPOGRAPHY_SETTINGS = JSON.stringify({
  displayQuotes: false,
  dashes: true,
  ellipsis: true,
});

export const addSmartTypographySettingsFieldMigration: Migration = {
  id: 'add-smart-typography-settings-field-v1',
  description:
    'Add smartTypographySettings field to chat_settings table for render-time curly quotes and type-time dashes/ellipsis',
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

    return !columnNames.includes('smartTypographySettings');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const columns = getSQLiteTableColumns('chat_settings');
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes('smartTypographySettings')) {
        db.exec(
          `ALTER TABLE "chat_settings" ADD COLUMN "smartTypographySettings" TEXT DEFAULT '${DEFAULT_SMART_TYPOGRAPHY_SETTINGS}'`
        );
        columnsAdded++;
        logger.info('Added smartTypographySettings column to chat_settings table', {
          context: 'migration.add-smart-typography-settings-field',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-smart-typography-settings-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added smartTypographySettings column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add smartTypographySettings column', {
        context: 'migration.add-smart-typography-settings-field',
        error: errorMessage,
      });

      return {
        id: 'add-smart-typography-settings-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add smartTypographySettings column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
