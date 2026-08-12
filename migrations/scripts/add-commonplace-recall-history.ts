/**
 * Migration: Add Commonplace Book recall-history ring buffer to chats.
 *
 * The per-turn Commonplace Book whisper surfaces the memories most relevant to
 * the current moment. Without any memory of what was *just* whispered, a memory
 * that stays the top match across several turns gets whispered every turn and
 * reads as a stuck record. This column holds a small ring buffer of the memory
 * IDs whispered in the last few turns so the recall path can apply a bounded
 * anti-repetition penalty (see lib/memory/recall-tags.ts `recentlyWhispered`).
 *
 * Stored as JSON: `string[][]` — one inner array of memory IDs per recent turn,
 * most recent last, capped to the last few turns. Ephemeral per-chat UX state,
 * like `commonplaceSceneCache`; it is NOT part of .qtap export.
 *
 * Migration ID: add-commonplace-recall-history-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCommonplaceRecallHistoryMigration: Migration = {
  id: 'add-commonplace-recall-history-v1',
  description: 'Add commonplaceRecallHistory column to chats for recall anti-repetition',
  introducedInVersion: '4.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const cols = getSQLiteTableColumns('chats').map((c) => c.name);
    return !cols.includes('commonplaceRecallHistory');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      db.exec(`ALTER TABLE "chats" ADD COLUMN "commonplaceRecallHistory" TEXT DEFAULT NULL`);

      logger.info('Added commonplaceRecallHistory column to chats', {
        context: 'migration.add-commonplace-recall-history',
      });

      return {
        id: 'add-commonplace-recall-history-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added commonplaceRecallHistory column to chats',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add commonplaceRecallHistory column', {
        context: 'migration.add-commonplace-recall-history',
        error: errorMessage,
      });

      return {
        id: 'add-commonplace-recall-history-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add commonplaceRecallHistory column: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
