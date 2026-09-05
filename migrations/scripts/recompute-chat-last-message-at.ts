/**
 * Migration: Recompute chats.lastMessageAt from character-authored messages only
 *
 * `lastMessageAt` is the timestamp every chat list, sort, and card reads — "when did this
 * conversation last move?" But it was written by `addMessage`/`addMessages` on *any*
 * `type: 'message'` row, and the Staff (Lantern, Aurora, Librarian, Concierge, Prospero, Host,
 * Commonplace Book, Ariel, Carina, Suparṇā, Pascal) persist their announcements as message rows
 * too. A story background finishing its render, a summary being folded, a Concierge notice — each
 * stamped the chat as freshly active and floated a months-dead conversation to the top of the
 * list. Raw `TOOL` result rows and user announcement bubbles did the same.
 *
 * The write path now bumps `lastMessageAt` only for character-authored content, per
 * `isCharacterAuthoredMessage` (`lib/chat/chat-activity.ts`) — role USER/ASSISTANT, no
 * `systemSender`, no `customAnnouncer`. Whispers count; a character murmuring to one other
 * character is still a character speaking.
 *
 * This recomputes the column for every existing chat under the same rule, so history reads the
 * way new activity will. Chats with no character-authored message at all are set to NULL, where
 * readers fall back to `createdAt` (`chatActivityAt`) rather than to the drifting `updatedAt`.
 *
 * `updatedAt` is deliberately left alone — it keeps its meaning of "anything about this row
 * changed", it is simply no longer what the reader is shown.
 *
 * Migration ID: recompute-chat-last-message-at-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

const MIGRATION_ID = 'recompute-chat-last-message-at-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

/** Columns this migration reads. Absent any of them, there is nothing to recompute from. */
const REQUIRED_MESSAGE_COLUMNS = ['chatId', 'type', 'role', 'systemSender', 'customAnnouncer', 'createdAt'];

/**
 * The SQL mirror of `isCharacterAuthoredMessage`. Kept as one string so the correct/incorrect
 * comparison and the rewrite can never drift apart.
 */
const CHARACTER_AUTHORED_PREDICATE = `
  "type" = 'message'
  AND "role" IN ('USER', 'ASSISTANT')
  AND "systemSender" IS NULL
  AND "customAnnouncer" IS NULL
`;

interface DriftRow {
  id: string;
  stored: string | null;
  correct: string | null;
}

/**
 * Every chat whose stored `lastMessageAt` disagrees with the recomputed one. Uses
 * `IS NOT` rather than `<>` so a NULL on either side counts as a difference — the
 * Staff-only chats that must be cleared are exactly the rows going to NULL.
 */
function findDrift(): DriftRow[] {
  const db = getSQLiteDatabase();
  return db
    .prepare(
      `SELECT c."id"            AS "id",
              c."lastMessageAt" AS "stored",
              (SELECT MAX(m."createdAt")
                 FROM "chat_messages" m
                WHERE m."chatId" = c."id"
                  AND ${CHARACTER_AUTHORED_PREDICATE}) AS "correct"
         FROM "chats" c
        WHERE c."lastMessageAt" IS NOT (SELECT MAX(m."createdAt")
                 FROM "chat_messages" m
                WHERE m."chatId" = c."id"
                  AND ${CHARACTER_AUTHORED_PREDICATE})`
    )
    .all() as DriftRow[];
}

export const recomputeChatLastMessageAtMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Recompute chats.lastMessageAt from character-authored messages, so Staff announcements no longer read as conversational activity',
  introducedInVersion: '4.9.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('chats') || !sqliteTableExists('chat_messages')) return false;

    const chatColumns = getSQLiteTableColumns('chats').map((col) => col.name);
    if (!chatColumns.includes('lastMessageAt')) return false;

    const messageColumns = getSQLiteTableColumns('chat_messages').map((col) => col.name);
    if (!REQUIRED_MESSAGE_COLUMNS.every((name) => messageColumns.includes(name))) return false;

    return findDrift().length > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      const drifted = findDrift();

      logger.debug('Scanning chats for last-activity drift', {
        context: LOG_CONTEXT,
        drifted: drifted.length,
      });

      const cleared = drifted.filter((row) => row.correct === null).length;

      if (drifted.length > 0) {
        const statement = db.prepare(`UPDATE "chats" SET "lastMessageAt" = ? WHERE "id" = ?`);
        // One synchronous transaction: nothing reaches the loading screen
        // mid-flight, so the progress tick lands once the rows are written.
        const applyAll = db.transaction((rows: DriftRow[]) => {
          for (const row of rows) statement.run(row.correct, row.id);
        });
        applyAll(drifted);
        reportProgress(drifted.length, drifted.length, 'chats');
      }

      logger.info('Recomputed chat last-activity timestamps', {
        context: LOG_CONTEXT,
        updated: drifted.length,
        clearedToNull: cleared,
      });

      const durationMs = Date.now() - startTime;

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: drifted.length,
        message:
          drifted.length > 0
            ? `Recomputed last-activity for ${drifted.length} chat${drifted.length === 1 ? '' : 's'} (${cleared} with no character-authored messages)`
            : 'All chat last-activity timestamps already reflect character-authored messages',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to recompute chat last-activity timestamps', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to recompute chat last-activity timestamps',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
