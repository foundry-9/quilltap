/**
 * Migration: Episodic spine — event time, place, and entities on memories.
 *
 * The memory system had no concept of an episode: a row knew when it was
 * WRITTEN (`createdAt`) but not when the event it records HAPPENED. This
 * migration adds the episodic spine:
 *
 *  - memories.occurredAt     TEXT  — ISO wall-clock event time
 *  - memories.narrativeTime  TEXT  — free-text in-story time (fictional
 *                                    timelines only)
 *  - memories.entities       TEXT  — JSON string[] of the episode's proper
 *                                    nouns (places, people, named things)
 *  - memories.kind           TEXT  — 'semantic' (default) | 'episodic'
 *  - index on occurredAt (descending, like createdAt)
 *  - chats.timelineMode      TEXT  — 'realtime' (NULL reads as realtime) |
 *                                    'narrative'
 *
 * Backfill (pure SQL, no LLM): occurredAt := the source message's createdAt
 * where sourceMessageId resolves, else the memory's own createdAt. entities /
 * narrativeTime stay empty/null; kind stays 'semantic'.
 *
 * Migration ID: add-episodic-memory-fields-v1
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

const MIGRATION_ID = 'add-episodic-memory-fields-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

interface WorkNeeded {
  memoryColumns: string[];
  needsIndex: boolean;
  needsTimelineMode: boolean;
  needsBackfill: boolean;
}

function assessWork(): WorkNeeded {
  const work: WorkNeeded = {
    memoryColumns: [],
    needsIndex: false,
    needsTimelineMode: false,
    needsBackfill: false,
  };
  if (!isSQLiteBackend()) return work;

  const db = getSQLiteDatabase();

  if (sqliteTableExists('memories')) {
    const cols = getSQLiteTableColumns('memories').map((c) => c.name);
    for (const col of ['occurredAt', 'narrativeTime', 'entities', 'kind']) {
      if (!cols.includes(col)) work.memoryColumns.push(col);
    }
    const hasIndex = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_memories_occurredAt'`)
      .get();
    work.needsIndex = !hasIndex;
    if (cols.includes('occurredAt')) {
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM memories WHERE occurredAt IS NULL`)
        .get() as { n: number | bigint };
      work.needsBackfill = Number(row.n) > 0;
    } else {
      // Column about to be added — every existing row will need the backfill.
      const row = db.prepare(`SELECT COUNT(*) AS n FROM memories`).get() as { n: number | bigint };
      work.needsBackfill = Number(row.n) > 0;
    }
  }

  if (sqliteTableExists('chats')) {
    const chatCols = getSQLiteTableColumns('chats').map((c) => c.name);
    work.needsTimelineMode = !chatCols.includes('timelineMode');
  }

  return work;
}

export const addEpisodicMemoryFieldsMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Add occurredAt/narrativeTime/entities/kind to memories (+ occurredAt index, chats.timelineMode) and backfill event time from source messages',
  introducedInVersion: '4.9.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    const work = assessWork();
    return (
      work.memoryColumns.length > 0 ||
      work.needsIndex ||
      work.needsTimelineMode ||
      work.needsBackfill
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();
      const work = assessWork();

      const columnDDL: Record<string, string> = {
        occurredAt: `ALTER TABLE "memories" ADD COLUMN "occurredAt" TEXT DEFAULT NULL`,
        narrativeTime: `ALTER TABLE "memories" ADD COLUMN "narrativeTime" TEXT DEFAULT NULL`,
        entities: `ALTER TABLE "memories" ADD COLUMN "entities" TEXT DEFAULT '[]'`,
        kind: `ALTER TABLE "memories" ADD COLUMN "kind" TEXT DEFAULT 'semantic'`,
      };
      for (const col of work.memoryColumns) {
        db.exec(columnDDL[col]);
        itemsAffected++;
        logger.info(`Added memories.${col} column`, { context: LOG_CONTEXT });
      }

      if (work.needsIndex && sqliteTableExists('memories')) {
        db.exec(`CREATE INDEX IF NOT EXISTS "idx_memories_occurredAt" ON "memories" ("occurredAt" DESC)`);
        itemsAffected++;
        logger.info('Created idx_memories_occurredAt', { context: LOG_CONTEXT });
      }

      if (work.needsTimelineMode) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "timelineMode" TEXT DEFAULT NULL`);
        itemsAffected++;
        logger.info('Added chats.timelineMode column', { context: LOG_CONTEXT });
      }

      // Backfill occurredAt in batches so the loading screen can show progress
      // on instances with tens of thousands of memories. Two-step rule per row:
      // source message createdAt when sourceMessageId resolves, else the
      // memory's own createdAt.
      if (sqliteTableExists('memories')) {
        const totalRow = db
          .prepare(`SELECT COUNT(*) AS n FROM memories WHERE occurredAt IS NULL`)
          .get() as { n: number | bigint };
        const total = Number(totalRow.n);

        if (total > 0) {
          const hasMessages = sqliteTableExists('chat_messages');
          const BATCH = 2000;
          let done = 0;

          const fromMessage = hasMessages
            ? db.prepare(`
                UPDATE memories SET occurredAt = (
                  SELECT m.createdAt FROM chat_messages m WHERE m.id = memories.sourceMessageId
                )
                WHERE occurredAt IS NULL
                  AND sourceMessageId IS NOT NULL
                  AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.id = memories.sourceMessageId)
                  AND id IN (
                    SELECT id FROM memories WHERE occurredAt IS NULL LIMIT ?
                  )
              `)
            : null;
          const fromCreatedAt = db.prepare(`
            UPDATE memories SET occurredAt = createdAt
            WHERE occurredAt IS NULL
              AND id IN (SELECT id FROM memories WHERE occurredAt IS NULL LIMIT ?)
          `);

          // Pass 1: message-anchored rows (batched).
          if (fromMessage) {
            while (true) {
              const info = fromMessage.run(BATCH);
              if (info.changes === 0) break;
              done += info.changes;
              itemsAffected += info.changes;
              reportProgress(Math.min(done, total), total, 'memories');
            }
          }

          // Pass 2: everything still NULL falls back to the write clock (batched).
          while (true) {
            const info = fromCreatedAt.run(BATCH);
            if (info.changes === 0) break;
            done += info.changes;
            itemsAffected += info.changes;
            reportProgress(Math.min(done, total), total, 'memories');
          }

          reportProgress(total, total, 'memories');
          logger.info('Backfilled memories.occurredAt', {
            context: LOG_CONTEXT,
            backfilled: done,
          });
        }
      }

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected,
        message: `Episodic spine in place (${itemsAffected} changes)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Episodic-spine migration failed', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected,
        message: `Episodic-spine migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
