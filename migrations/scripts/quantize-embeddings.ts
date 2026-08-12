/**
 * Migration: Quantize Embedding BLOBs (int8 symmetric)
 *
 * Re-packs every stored embedding from raw Float32 bytes into the
 * self-describing quantized format defined in
 * `lib/embedding/float32-conversion.ts` (magic 0xEB, version 0x01, int8
 * symmetric with a per-vector float32 scale) — roughly 4× smaller. Stored
 * embeddings are unit-normalized, so symmetric per-vector quantization is
 * well-conditioned (mean cosine similarity to the original ≥ 0.999).
 *
 * Tables: `memories`, `conversation_chunks`, `vector_entries` (main DB).
 * Rows already in the quantized format are skipped, so the migration is
 * idempotent and safe to resume after an interruption. Legacy JSON-text
 * embeddings (pre normalize-vector-storage-v1) are not touched here — that
 * migration runs first via dependsOn.
 *
 * ONE-WAY: recovering exact Float32 afterwards requires re-embedding from
 * source text. Operators should take a physical backup before upgrading
 * across this migration (see docs/developer/features/db-size-reduction-spec.md §6).
 *
 * NULLing/rewriting only frees pages inside the file — run
 * `npx quilltap db optimize` (VACUUM) afterwards to shrink the file itself.
 *
 * Migration ID: quantize-embeddings-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import {
  blobToFloat32,
  float32ToQuantized,
  isQuantizedEmbeddingBlob,
} from '@/lib/embedding/float32-conversion';

const TABLES = ['memories', 'conversation_chunks', 'vector_entries'] as const;

/** Rows fetched (keyset-paginated by rowid) and updated per transaction. */
const BATCH_SIZE = 500;

/** shouldRun() samples at most this many rows per table. */
const SAMPLE_LIMIT = 50;

export const quantizeEmbeddingsMigration: Migration = {
  id: 'quantize-embeddings-v1',
  description: 'Quantize stored embeddings from raw Float32 to int8 (self-describing format, ~4x smaller)',
  introducedInVersion: '4.8.0',
  dependsOn: ['sqlite-initial-schema-v1', 'normalize-vector-storage-v1', 'normalize-embeddings-unit-vectors-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    // Sample a bounded number of non-null blob embeddings per table; run if
    // any is still legacy raw Float32. (Migration state prevents re-runs;
    // this guards re-entry if a prior run was interrupted mid-table.)
    const db = getSQLiteDatabase();
    for (const table of TABLES) {
      if (!sqliteTableExists(table)) continue;
      const rows = db
        .prepare(
          `SELECT embedding FROM "${table}"
            WHERE embedding IS NOT NULL AND typeof(embedding) = 'blob'
            LIMIT ${SAMPLE_LIMIT}`,
        )
        .all() as { embedding: Buffer }[];
      if (rows.some((r) => !isQuantizedEmbeddingBlob(r.embedding))) {
        return true;
      }
    }
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let quantized = 0;
    let alreadyQuantized = 0;
    let skippedUnreadable = 0;

    try {
      const db = getSQLiteDatabase();

      // Count everything upfront so the loading screen can show a single
      // running x/total across all three tables.
      const tableTotals = new Map<string, number>();
      let grandTotal = 0;
      for (const table of TABLES) {
        if (!sqliteTableExists(table)) continue;
        const row = db
          .prepare(
            `SELECT COUNT(*) AS count FROM "${table}"
              WHERE embedding IS NOT NULL AND typeof(embedding) = 'blob'`,
          )
          .get() as { count: number };
        tableTotals.set(table, row.count);
        grandTotal += row.count;
      }

      let totalScanned = 0;

      for (const table of TABLES) {
        const tableTotal = tableTotals.get(table);
        if (!tableTotal) continue;

        const selectBatch = db.prepare(
          `SELECT rowid AS rid, id, embedding FROM "${table}"
            WHERE embedding IS NOT NULL AND typeof(embedding) = 'blob' AND rowid > ?
            ORDER BY rowid
            LIMIT ${BATCH_SIZE}`,
        );
        const updateStmt = db.prepare(`UPDATE "${table}" SET embedding = ? WHERE id = ?`);
        const writeMany = db.transaction((items: { id: string; blob: Buffer }[]) => {
          for (const item of items) updateStmt.run(item.blob, item.id);
        });

        let lastRowid = -1;
        for (;;) {
          const rows = selectBatch.all(lastRowid) as {
            rid: number;
            id: string;
            embedding: Buffer;
          }[];
          if (rows.length === 0) break;
          lastRowid = rows[rows.length - 1].rid;

          const batch: { id: string; blob: Buffer }[] = [];
          for (const row of rows) {
            totalScanned++;
            reportProgress(totalScanned, grandTotal, 'embeddings');

            if (isQuantizedEmbeddingBlob(row.embedding)) {
              alreadyQuantized++;
              continue;
            }
            if (row.embedding.byteLength % 4 !== 0) {
              // Not a valid Float32 buffer either — leave it for the read
              // path's legacy handling rather than corrupt it further.
              skippedUnreadable++;
              logger.warn('Unreadable embedding blob — skipping', {
                context: 'migrations.quantize-embeddings',
                table,
                id: row.id,
                byteLength: row.embedding.byteLength,
              });
              continue;
            }
            const vector = blobToFloat32(row.embedding);
            batch.push({ id: row.id, blob: float32ToQuantized(vector) });
          }

          if (batch.length > 0) {
            writeMany(batch);
            quantized += batch.length;
          }
        }

        logger.info('Quantized embeddings for table', {
          context: 'migrations.quantize-embeddings',
          table,
          tableTotal,
        });
      }

      const durationMs = Date.now() - startTime;
      logger.info('Embedding quantization migration completed', {
        context: 'migrations.quantize-embeddings',
        quantized,
        alreadyQuantized,
        skippedUnreadable,
        durationMs,
      });

      return {
        id: 'quantize-embeddings-v1',
        success: true,
        itemsAffected: quantized,
        message: `Quantized ${quantized} embeddings to int8 (${alreadyQuantized} already quantized, ${skippedUnreadable} unreadable skipped)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Embedding quantization migration failed', {
        context: 'migrations.quantize-embeddings',
        error: errorMessage,
        quantized,
      });

      return {
        id: 'quantize-embeddings-v1',
        success: false,
        itemsAffected: quantized,
        message: 'Failed to quantize embeddings',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
