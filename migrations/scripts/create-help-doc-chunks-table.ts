/**
 * Migration: Create Help Doc Chunks Table
 *
 * Creates the help_doc_chunks table, which holds one row per section of each
 * help document so semantic search can match a *section* rather than only a
 * whole document. The existing whole-document embedding on help_docs stays as
 * a coarse fallback for docs that have no chunk rows yet.
 *
 * No backfill is needed: the rows are rebuilt from disk by the help-doc sync
 * that runs on every boot, and their embeddings are filled by the ordinary
 * HELP_DOC embedding job.
 *
 * Migration ID: create-help-doc-chunks-table-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

/**
 * Create Help Doc Chunks Table Migration
 */
export const createHelpDocChunksTableMigration: Migration = {
  id: 'create-help-doc-chunks-table-v1',
  description: 'Create help_doc_chunks table for section-level help search',
  introducedInVersion: '4.9.0',
  dependsOn: ['create-help-docs-table-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    return !sqliteTableExists('help_doc_chunks');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let tablesCreated = 0;
    let indexesCreated = 0;

    try {
      const db = getSQLiteDatabase();

      const createTables = db.transaction(() => {
        if (!sqliteTableExists('help_doc_chunks')) {
          db.exec(`CREATE TABLE IF NOT EXISTS "help_doc_chunks" (
            "id" TEXT PRIMARY KEY,
            "docId" TEXT NOT NULL,
            "chunkIndex" INTEGER NOT NULL,
            "heading" TEXT,
            "content" TEXT NOT NULL,
            "embedding" BLOB,
            "createdAt" TEXT NOT NULL,
            "updatedAt" TEXT NOT NULL,
            UNIQUE("docId", "chunkIndex"),
            FOREIGN KEY ("docId") REFERENCES "help_docs"("id") ON DELETE CASCADE
          )`);
          tablesCreated++;

          db.exec(`CREATE INDEX IF NOT EXISTS "idx_help_doc_chunks_docId" ON "help_doc_chunks" ("docId")`);
          indexesCreated++;

          logger.info('Created help_doc_chunks table', {
            context: 'migration.create-help-doc-chunks-table',
          });
        }
      });

      createTables();

      const durationMs = Date.now() - startTime;

      logger.info('Help doc chunks table migration completed', {
        context: 'migration.create-help-doc-chunks-table',
        tablesCreated,
        indexesCreated,
        durationMs,
      });

      return {
        id: 'create-help-doc-chunks-table-v1',
        success: true,
        itemsAffected: tablesCreated + indexesCreated,
        message: `Created ${tablesCreated} tables and ${indexesCreated} indexes`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Help doc chunks table migration failed', {
        context: 'migration.create-help-doc-chunks-table',
        error: errorMessage,
      });

      return {
        id: 'create-help-doc-chunks-table-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to create help_doc_chunks table',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
