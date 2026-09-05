/**
 * Migration: Add composerEmoji Field to Chat Settings
 *
 * This migration adds a composerEmoji INTEGER field to the chat_settings table.
 * When enabled (the default), typing `:` plus at least two characters opens the
 * emoji typeahead in the Salon ChatComposer and the Document Mode rich editor.
 * The formatting toolbar's emoji picker is deliberately NOT gated by this flag —
 * an explicit button press is never a surprise.
 *
 * Migration ID: add-composer-emoji-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

export const addComposerEmojiFieldMigration: Migration = {
  id: 'add-composer-emoji-field-v1',
  description: 'Add composerEmoji field to chat_settings table for the composer emoji typeahead toggle',
  introducedInVersion: '4.8.2',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    return !sqliteColumnExists('chat_settings', 'composerEmoji');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      if (addColumnIfMissing('chat_settings', 'composerEmoji', 'INTEGER DEFAULT 1')) {
        columnsAdded++;
        logger.info('Added composerEmoji column to chat_settings table', {
          context: 'migration.add-composer-emoji-field',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-composer-emoji-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added composerEmoji column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add composerEmoji column', {
        context: 'migration.add-composer-emoji-field',
        error: errorMessage,
      });

      return {
        id: 'add-composer-emoji-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add composerEmoji column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
