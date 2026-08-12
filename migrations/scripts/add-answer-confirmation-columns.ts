/**
 * Migration: Add Answer-Confirmation Columns
 *
 * Adds the schema substrate for the Salon answer-confirmation feature (the
 * cheap-LLM consistency check + character re-affirmation pass):
 *
 * chat_messages:
 *  - confirmed (INTEGER 0/1, nullable) — consistency verdict: 1 = consistent or
 *    successfully revised, 0 = character affirmed a flagged answer unchanged,
 *    NULL = check could not run / not applicable.
 *  - confirmationChecked (INTEGER 0/1, nullable) — 1 when a check actually ran;
 *    distinguishes a persisted "unverified" (confirmed NULL but checked) from
 *    "never checked" (both store confirmed as SQL NULL).
 *  - confirmationRevised (INTEGER 0/1, nullable) — the shown content is a
 *    re-affirmation rewrite of the original.
 *  - confirmationNotes (TEXT, nullable) — the cheap-LLM discrepancy explanation.
 *  - confirmationOriginalContent (TEXT, nullable) — the pre-revision text,
 *    retained for the logs when confirmationRevised is set.
 *
 * chats:
 *  - answerConfirmationOverride (TEXT, nullable) — per-chat tri-state:
 *    'ON' / 'OFF' / NULL (= inherit the project override, then the global
 *    setting).
 *
 * chat_settings:
 *  - answerConfirmationSettings (TEXT JSON) — the global default toggle
 *    ({ enabled: false }).
 *
 * The per-project override rides in the project's properties.json (no DB
 * column), so it needs no migration here.
 *
 * Migration ID: add-answer-confirmation-columns-v2
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

const MESSAGE_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'confirmed', ddl: 'INTEGER DEFAULT NULL' },
  { name: 'confirmationChecked', ddl: 'INTEGER DEFAULT NULL' },
  { name: 'confirmationRevised', ddl: 'INTEGER DEFAULT NULL' },
  { name: 'confirmationNotes', ddl: 'TEXT DEFAULT NULL' },
  { name: 'confirmationOriginalContent', ddl: 'TEXT DEFAULT NULL' },
];

export const addAnswerConfirmationColumnsMigration: Migration = {
  id: 'add-answer-confirmation-columns-v2',
  description: 'Add answer-confirmation columns to chat_messages and chats',
  introducedInVersion: '4.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    let needed = false;

    if (sqliteTableExists('chat_messages')) {
      const columnNames = getSQLiteTableColumns('chat_messages').map((col) => col.name);
      if (MESSAGE_COLUMNS.some((c) => !columnNames.includes(c.name))) {
        needed = true;
      }
    }

    if (sqliteTableExists('chats')) {
      const columnNames = getSQLiteTableColumns('chats').map((col) => col.name);
      if (!columnNames.includes('answerConfirmationOverride')) {
        needed = true;
      }
    }

    if (sqliteTableExists('chat_settings')) {
      const columnNames = getSQLiteTableColumns('chat_settings').map((col) => col.name);
      if (!columnNames.includes('answerConfirmationSettings')) {
        needed = true;
      }
    }

    return needed;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('chat_messages')) {
        const columnNames = getSQLiteTableColumns('chat_messages').map((col) => col.name);
        for (const col of MESSAGE_COLUMNS) {
          if (!columnNames.includes(col.name)) {
            db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "${col.name}" ${col.ddl}`);
            columnsAdded++;
            logger.info(`Added ${col.name} column to chat_messages table`, {
              context: 'migration.add-answer-confirmation-columns',
            });
          }
        }
      }

      if (sqliteTableExists('chats')) {
        const columnNames = getSQLiteTableColumns('chats').map((col) => col.name);
        if (!columnNames.includes('answerConfirmationOverride')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "answerConfirmationOverride" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added answerConfirmationOverride column to chats table', {
            context: 'migration.add-answer-confirmation-columns',
          });
        }
      }

      if (sqliteTableExists('chat_settings')) {
        const columnNames = getSQLiteTableColumns('chat_settings').map((col) => col.name);
        if (!columnNames.includes('answerConfirmationSettings')) {
          const defaultAnswerConfirmationSettings = JSON.stringify({ enabled: false });
          db.exec(
            `ALTER TABLE "chat_settings" ADD COLUMN "answerConfirmationSettings" TEXT DEFAULT '${defaultAnswerConfirmationSettings}'`
          );
          columnsAdded++;
          logger.info('Added answerConfirmationSettings column to chat_settings table', {
            context: 'migration.add-answer-confirmation-columns',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Completed answer-confirmation columns update', {
        context: 'migration.add-answer-confirmation-columns',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-answer-confirmation-columns-v2',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} answer-confirmation column(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add answer-confirmation columns', {
        context: 'migration.add-answer-confirmation-columns',
        error: errorMessage,
      });

      return {
        id: 'add-answer-confirmation-columns-v2',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add answer-confirmation columns',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
