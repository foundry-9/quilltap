/**
 * Migration: Retire the `[Name]` Prefill on Thinking Profiles
 *
 * `add-profile-multi-character-prefill-field-v1` gave every connection profile
 * a `multiCharacterPrefill` column and backfilled it by provider: 0 for
 * ANTHROPIC, 1 for everything else. That preserved the behaviour of the day,
 * including its blind spot — the prefill's hostility is a property of the
 * *model*, not the provider, and a model that reasons is the one it breaks on:
 *
 *   - **DeepSeek** thinking mode reads a trailing assistant `[Name]` message
 *     as a turn to continue and rejects the request with *"The
 *     `reasoning_content` in the thinking mode must be passed back to the
 *     API"* — an HTTP 400 on every multi-character turn, which is every turn
 *     in a character chat (bug 85).
 *   - **Ollama** opens a thinking model's reasoning block from the chat
 *     template at the start of the assistant turn, so a prefill means the
 *     block is never opened and the reasoning vanishes however the profile's
 *     Enable Thinking box is set (bug 68).
 *
 * Fixing the default alone fixes nothing for rows already written: the literal
 * `1` those profiles carry was put there by the old provider default at
 * creation, not by any user choice, and it outranks any default thereafter.
 * This pass clears it — and only it. Rows already at 0 are untouched, rows on
 * a profile that is not running a thinking turn are untouched, and anyone who
 * wants the prefill back on a thinking profile can tick the box, which is
 * still honoured over every default.
 *
 * **The rule table below is a deliberate frozen copy.** At runtime the same
 * question is answered by the provider plugin's declared `thinkingTurnRule`
 * plus its model catalogue's `thinksByDefault` flag, evaluated by
 * `lib/llm/thinking-turn`. Migrations run before the plugin registry is up, so
 * this one carries its own snapshot of what those plugins declared the day it
 * was written. Do not "fix" it to follow the plugins later — a migration
 * describes the world it ran in.
 *
 * Migration ID: retire-prefill-on-thinking-profiles-v1
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
import { evaluateThinkingTurn, type ThinkingTurnRule } from '@/lib/llm/thinking-turn';

/**
 * Frozen snapshot of the `thinkingTurnRule` each provider plugin declared when
 * this migration was written. See the module note above.
 */
const FROZEN_RULES: Record<string, ThinkingTurnRule> = {
  DEEPSEEK: { optionKey: 'thinking', enabledValues: ['enabled'], disabledValues: ['disabled'] },
  OLLAMA: { optionKey: 'enable_thinking', enabledValues: [true], disabledValues: [false] },
};

/**
 * Frozen snapshot of the models whose catalogue entry said they reason without
 * being asked. Ollama contributes none — its models are whatever the user has
 * pulled, so only an explicit Enable Thinking counts there.
 */
const FROZEN_THINKS_BY_DEFAULT: Record<string, Set<string>> = {
  DEEPSEEK: new Set(['deepseek-v4-flash', 'deepseek-v4-pro']),
};

interface ProfileRow {
  id: string;
  provider: string | null;
  modelName: string | null;
  parameters: string | null;
}

function parseParameters(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const retirePrefillOnThinkingProfilesMigration: Migration = {
  id: 'retire-prefill-on-thinking-profiles-v1',
  description:
    'Turn the multi-character [Name] prefill off on connection profiles that run a thinking turn, which reject or silently swallow a prefilled assistant turn',
  introducedInVersion: '4.9.0',
  dependsOn: ['add-profile-multi-character-prefill-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('connection_profiles')) {
      return false;
    }

    const columns = getSQLiteTableColumns('connection_profiles');
    return columns.some((col) => col.name === 'multiCharacterPrefill');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // Only rows still carrying the prefill, and only on the providers that
      // declared a thinking rule — everything else is already correct.
      const providers = Object.keys(FROZEN_RULES);
      const placeholders = providers.map(() => '?').join(', ');
      const rows = db
        .prepare(
          `SELECT "id", "provider", "modelName", "parameters"
             FROM "connection_profiles"
            WHERE "multiCharacterPrefill" = 1
              AND upper("provider") IN (${placeholders})`
        )
        .all(...providers) as ProfileRow[];

      const clear = db.prepare(
        'UPDATE "connection_profiles" SET "multiCharacterPrefill" = 0 WHERE "id" = ?'
      );

      let cleared = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const provider = (row.provider ?? '').toUpperCase();
        const thinksByDefault =
          row.modelName != null && FROZEN_THINKS_BY_DEFAULT[provider]?.has(row.modelName) === true;

        const runsThinkingTurn = evaluateThinkingTurn({
          rule: FROZEN_RULES[provider] ?? null,
          parameters: parseParameters(row.parameters),
          model: { thinksByDefault },
        });

        if (runsThinkingTurn) {
          clear.run(row.id);
          cleared++;
        }

        reportProgress(i + 1, rows.length, 'connection profiles');
      }

      logger.info('Retired the [Name] prefill on thinking connection profiles', {
        context: 'migration.retire-prefill-on-thinking-profiles',
        examined: rows.length,
        cleared,
      });

      return {
        id: 'retire-prefill-on-thinking-profiles-v1',
        success: true,
        itemsAffected: cleared,
        message: `Examined ${rows.length} prefill-enabled profile(s) on thinking-capable providers; turned the [Name] prefill off on ${cleared}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to retire the [Name] prefill on thinking profiles', {
        context: 'migration.retire-prefill-on-thinking-profiles',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: 'retire-prefill-on-thinking-profiles-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to retire the [Name] prefill on thinking profiles: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
