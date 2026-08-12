/**
 * Migration: Add customTools Field to Chat Settings
 *
 * This migration adds a customTools INTEGER field to the chat_settings table.
 * When enabled (default), Pascal's custom pseudo-tools are offered to models and
 * the composer gutter button is shown. When disabled, the run_custom pseudo-tool
 * is never offered and the gutter button is hidden.
 *
 * Migration ID: add-custom-tools-field-v1
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
 * Add customTools Field Migration
 */
export const addCustomToolsFieldMigration: Migration = {
  id: 'add-custom-tools-field-v1',
  description: 'Add customTools field to chat_settings table for Pascal custom pseudo-tools',
  introducedInVersion: '4.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if chat_settings table exists
    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    // Check if customTools column already exists
    const columns = getSQLiteTableColumns('chat_settings');
    const columnNames = columns.map((col) => col.name);

    if (!columnNames.includes('customTools')) {
      return true;
    }

    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      // Check and add customTools column
      const columns = getSQLiteTableColumns('chat_settings');
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes('customTools')) {
        // SQLite uses INTEGER for boolean, 1 = true (default enabled)
        db.exec(`ALTER TABLE "chat_settings" ADD COLUMN "customTools" INTEGER DEFAULT 1`);
        columnsAdded++;
        logger.info('Added customTools column to chat_settings table', {
          context: 'migration.add-custom-tools-field',
        });
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added customTools column to chat_settings table', {
        context: 'migration.add-custom-tools-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-custom-tools-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added customTools column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add customTools column', {
        context: 'migration.add-custom-tools-field',
        error: errorMessage,
      });

      return {
        id: 'add-custom-tools-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add customTools column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
