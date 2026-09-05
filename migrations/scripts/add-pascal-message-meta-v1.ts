/**
 * Migration: Add Pascal Message Meta
 *
 * Adds the `pascalMeta` column to the chat_messages table. It holds the JSON
 * roll record for Pascal the Croupier's custom (pseudo-)tool outcomes:
 * `{ tool, definitionTier, definitionMountId, params, rollForm, notation?,
 * raw, diceRolls?, value, state, outcomeIndex, invokedBy, callerParticipantId? }`.
 * The server rolled and the server chose the outcome, so the record is the
 * authoritative account of what the table dealt — not the model's.
 *
 * NULL on every non-Pascal message.
 *
 * Migration ID: add-pascal-message-meta-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

export const addPascalMessageMetaMigration: Migration = {
  id: 'add-pascal-message-meta-v1',
  description: 'Add pascalMeta column to chat_messages table',
  introducedInVersion: '4.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_messages')) {
      return false;
    }

    return !sqliteColumnExists('chat_messages', 'pascalMeta');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      // JSON: the custom-tool roll record; NULL on every non-Pascal message
      const added = addColumnIfMissing('chat_messages', 'pascalMeta', 'TEXT DEFAULT NULL');

      const durationMs = Date.now() - startTime;

      logger.info('Added pascalMeta column to chat_messages table', {
        context: 'migration.add-pascal-message-meta',
        durationMs,
      });

      return {
        id: 'add-pascal-message-meta-v1',
        success: true,
        itemsAffected: added ? 1 : 0,
        message: 'Added pascalMeta column to chat_messages table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add pascalMeta field', {
        context: 'migration.add-pascal-message-meta',
        error: errorMessage,
      });

      return {
        id: 'add-pascal-message-meta-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add pascalMeta field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
