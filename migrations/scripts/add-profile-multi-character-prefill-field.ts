/**
 * Migration: Add multiCharacterPrefill Field to Connection Profiles
 *
 * This migration adds the `multiCharacterPrefill` boolean field to
 * connection_profiles. It decides how a multi-character chat anchors a reply
 * to the character whose turn it is:
 *
 *   - 1 (true)  — append an assistant message containing `[Character Name]`,
 *                 so the model structurally continues only that character's
 *                 line. The tag is stripped downstream.
 *   - 0 (false) — append a prose instruction to the system prompt instead,
 *                 leaving the conversation ending on a user message.
 *
 * Until now this was hardcoded by provider: Anthropic took the prose route
 * (4.6+ rejects a request that ends with an assistant message), everything
 * else got the prefill. The prefill turns out to be actively harmful in two
 * further cases the hardcoding could not express — Ollama's thinking channel
 * is opened by the chat template at the start of the assistant turn, so a
 * prefill suppresses it entirely, and some models spend their reply working
 * out whether `[Name]` was an instruction or a previous speaker's slip.
 *
 * Backfill preserves today's behaviour exactly: ANTHROPIC profiles are set to
 * 0, every other profile to 1.
 *
 * Migration ID: add-profile-multi-character-prefill-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

export const addProfileMultiCharacterPrefillFieldMigration: Migration = {
  id: 'add-profile-multi-character-prefill-field-v1',
  description:
    'Add multiCharacterPrefill field to connection profiles, replacing the hardcoded Anthropic-only carve-out for the multi-character [Name] turn anchor',
  introducedInVersion: '4.9.0',
  dependsOn: ['add-pseudo-tool-mode-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('connection_profiles')) {
      return false;
    }

    return !sqliteColumnExists('connection_profiles', 'multiCharacterPrefill');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      addColumnIfMissing('connection_profiles', 'multiCharacterPrefill', 'INTEGER DEFAULT 1');

      // Preserve the pre-migration behaviour exactly: Anthropic was the sole
      // provider that never received the prefill, because it 400s on a request
      // that ends with an assistant message.
      const anthropic = db
        .prepare(
          'UPDATE "connection_profiles" SET "multiCharacterPrefill" = 0 WHERE upper("provider") = \'ANTHROPIC\''
        )
        .run();

      // Backfill any rows the column default may have missed.
      const rest = db
        .prepare(
          'UPDATE "connection_profiles" SET "multiCharacterPrefill" = 1 WHERE "multiCharacterPrefill" IS NULL'
        )
        .run();

      const itemsAffected = (anthropic.changes ?? 0) + (rest.changes ?? 0);

      // Verify
      if (!sqliteColumnExists('connection_profiles', 'multiCharacterPrefill')) {
        throw new Error('Column was not added successfully');
      }

      logger.info('Added multiCharacterPrefill column to connection_profiles', {
        context: 'migration.add-profile-multi-character-prefill-field',
        anthropicProfilesSetOff: anthropic.changes ?? 0,
        backfilledRows: rest.changes ?? 0,
      });

      return {
        id: 'add-profile-multi-character-prefill-field-v1',
        success: true,
        itemsAffected,
        message: `Added multiCharacterPrefill column to connection_profiles table (${anthropic.changes ?? 0} Anthropic profiles set off, ${rest.changes ?? 0} rows backfilled)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to add multiCharacterPrefill column', {
        context: 'migration.add-profile-multi-character-prefill-field',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: 'add-profile-multi-character-prefill-field-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add multiCharacterPrefill column: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
