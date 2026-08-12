/**
 * Migration: Anchor Fictional Story Clocks to Real Time
 *
 * Chats using fictional time advance their story clock 1:1 with the wall clock, measured from
 * `timestampConfig.fictionalBaseRealTime`. Nothing ever wrote that field — its only writer was
 * an uncalled helper — so `calculateCurrentTimestamp` fell back to "now", measured zero elapsed
 * time, and re-reported the configured base instant on every turn. The Host announced the same
 * moment forever and the story clock never moved.
 *
 * The write path now stamps the anchor at chat creation. This backfills chats created before
 * that, using each chat's own `createdAt` — the instant its base timestamp was chosen, and so
 * the anchor it would have carried had the field ever been written. Story time therefore resumes
 * exactly where 1:1 tracking from chat creation would have put it, rather than lurching.
 *
 * Only touches rows that need it: fictional time on, a base set, and no anchor recorded. Chats
 * on real time, or already anchored, are left alone.
 *
 * Migration ID: anchor-fictional-clock-base-v1
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

const MIGRATION_ID = 'anchor-fictional-clock-base-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

interface ChatRow {
  id: string;
  createdAt: string | null;
  timestampConfig: string | null;
}

/**
 * Shape we care about inside the timestampConfig JSON blob. Everything else rides along
 * untouched — we re-serialize the parsed object, so unknown keys are preserved.
 */
interface StoredTimestampConfig {
  useFictionalTime?: boolean;
  fictionalBaseTimestamp?: string | null;
  fictionalBaseRealTime?: string | null;
  [key: string]: unknown;
}

/**
 * A chat needs anchoring when its clock is fictional, has a base to count from, and has no
 * record of when that base was set.
 */
function needsAnchor(config: StoredTimestampConfig): boolean {
  return Boolean(
    config.useFictionalTime &&
      config.fictionalBaseTimestamp &&
      !config.fictionalBaseRealTime
  );
}

/**
 * Parse a stored blob, tolerating the malformed and the empty. A chat whose config we cannot
 * read is a chat we must not rewrite.
 */
function parseConfig(raw: string | null): StoredTimestampConfig | null {
  if (!raw || raw.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as StoredTimestampConfig;
  } catch {
    return null;
  }
}

/**
 * Candidate rows: cheap SQL pre-filter on the JSON text, refined by real parsing in run().
 * `fictionalBaseRealTime` may legitimately appear as an explicit null, so its presence in the
 * text is not on its own proof of an anchor.
 */
function findCandidates(): ChatRow[] {
  const db = getSQLiteDatabase();
  return db
    .prepare(
      `SELECT "id", "createdAt", "timestampConfig"
         FROM "chats"
        WHERE "timestampConfig" IS NOT NULL
          AND "timestampConfig" LIKE '%"useFictionalTime":true%'`
    )
    .all() as ChatRow[];
}

export const anchorFictionalClockBaseMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Backfill timestampConfig.fictionalBaseRealTime from chat createdAt so fictional story clocks advance',
  introducedInVersion: '4.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('chats')) return false;

    const columnNames = getSQLiteTableColumns('chats').map((col) => col.name);
    if (!columnNames.includes('timestampConfig') || !columnNames.includes('createdAt')) {
      return false;
    }

    return findCandidates().some((row) => {
      const config = parseConfig(row.timestampConfig);
      return config !== null && needsAnchor(config);
    });
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      const candidates = findCandidates();

      logger.debug('Scanning chats for unanchored fictional clocks', {
        context: LOG_CONTEXT,
        candidates: candidates.length,
      });

      const updates: Array<{ id: string; config: string }> = [];

      for (let i = 0; i < candidates.length; i++) {
        const row = candidates[i];
        reportProgress(i + 1, candidates.length, 'chats');

        const config = parseConfig(row.timestampConfig);
        if (!config || !needsAnchor(config)) continue;

        // createdAt is the instant the base was chosen. Fall back to now if a row somehow
        // lacks one — an anchor of now still beats a clock frozen forever.
        const anchor = row.createdAt ? new Date(row.createdAt) : new Date();
        const resolved = Number.isNaN(anchor.getTime()) ? new Date() : anchor;

        updates.push({
          id: row.id,
          config: JSON.stringify({
            ...config,
            fictionalBaseRealTime: resolved.toISOString(),
          }),
        });
      }

      if (updates.length > 0) {
        const statement = db.prepare(
          `UPDATE "chats" SET "timestampConfig" = ? WHERE "id" = ?`
        );
        const applyAll = db.transaction((rows: Array<{ id: string; config: string }>) => {
          for (const row of rows) statement.run(row.config, row.id);
        });
        applyAll(updates);
      }

      logger.info('Anchored fictional story clocks to real time', {
        context: LOG_CONTEXT,
        scanned: candidates.length,
        anchored: updates.length,
      });

      const durationMs = Date.now() - startTime;

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: updates.length,
        message:
          updates.length > 0
            ? `Anchored ${updates.length} fictional story clock${updates.length === 1 ? '' : 's'} to real time`
            : 'No unanchored fictional story clocks found',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to anchor fictional story clocks', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to anchor fictional story clocks',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
