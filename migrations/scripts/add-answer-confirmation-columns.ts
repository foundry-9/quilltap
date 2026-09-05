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
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const COLUMNS: Array<{ table: string; name: string; ddl: string }> = [
  { table: 'chat_messages', name: 'confirmed', ddl: 'INTEGER DEFAULT NULL' },
  { table: 'chat_messages', name: 'confirmationChecked', ddl: 'INTEGER DEFAULT NULL' },
  { table: 'chat_messages', name: 'confirmationRevised', ddl: 'INTEGER DEFAULT NULL' },
  { table: 'chat_messages', name: 'confirmationNotes', ddl: 'TEXT DEFAULT NULL' },
  { table: 'chat_messages', name: 'confirmationOriginalContent', ddl: 'TEXT DEFAULT NULL' },
  { table: 'chats', name: 'answerConfirmationOverride', ddl: 'TEXT DEFAULT NULL' },
  {
    table: 'chat_settings',
    name: 'answerConfirmationSettings',
    ddl: `TEXT DEFAULT '${JSON.stringify({ enabled: false })}'`,
  },
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

    return COLUMNS.some(
      (col) => sqliteTableExists(col.table) && !sqliteColumnExists(col.table, col.name)
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      for (const col of COLUMNS) {
        if (sqliteTableExists(col.table) && addColumnIfMissing(col.table, col.name, col.ddl)) {
          columnsAdded++;
          logger.info(`Added ${col.name} column to ${col.table} table`, {
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
