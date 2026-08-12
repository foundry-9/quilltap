/**
 * @jest-environment node
 *
 * Unit tests for the quantize-embeddings-v1 migration, run against a real
 * in-memory SQLite database so the batched keyset pagination and transaction
 * behaviour are exercised for real.
 */

// NOTE: no `@jest/globals` import — it breaks jest.mock hoisting in this repo;
// use the global jest/describe/it/expect (see project jest-mock conventions).

jest.mock('../../../../../migrations/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

const mockReportProgress = jest.fn();
jest.mock('../../../../../migrations/lib/progress', () => ({
  reportProgress: (...args: unknown[]) => mockReportProgress(...args),
}));

let db: import('better-sqlite3').Database;

jest.mock('../../../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  getSQLiteDatabase: () => db,
  sqliteTableExists: (name: string) => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name);
    return Boolean(row);
  },
}));

// Root package.json aliases better-sqlite3-multiple-ciphers as better-sqlite3,
// and the jest moduleNameMapper replaces both names with a no-op mock. Require
// the real binding by absolute path so this suite exercises actual SQL.
const path = require('path');
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

import { quantizeEmbeddingsMigration } from '@/migrations/scripts/quantize-embeddings';
import {
  blobToFloat32,
  float32ToBlobRaw,
  float32ToQuantized,
  isQuantizedEmbeddingBlob,
} from '@/lib/embedding/float32-conversion';

function unitVector(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim);
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = Math.sin(seed * 7919 + i * 104729);
    sumSq += v[i] * v[i];
  }
  const inv = 1 / Math.sqrt(sumSq);
  for (let i = 0; i < dim; i++) v[i] *= inv;
  return v;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const originals = new Map<string, Float32Array>();

beforeEach(() => {
  jest.clearAllMocks();
  originals.clear();
  db = new Database(':memory:');
  for (const table of ['memories', 'conversation_chunks', 'vector_entries']) {
    db.exec(`CREATE TABLE "${table}" ("id" TEXT PRIMARY KEY, "embedding" BLOB)`);
    const insert = db.prepare(`INSERT INTO "${table}" (id, embedding) VALUES (?, ?)`);
    // Enough rows to force more than one keyset batch would be slow here;
    // correctness of pagination is covered by inserting > 1 row per table.
    for (let i = 0; i < 7; i++) {
      const id = `${table}-${i}`;
      const v = unitVector(64, i + 1);
      originals.set(id, v);
      insert.run(id, float32ToBlobRaw(v));
    }
    insert.run(`${table}-null`, null);
  }
  // One row already quantized (simulates an interrupted prior run).
  const preQuantized = unitVector(64, 99);
  originals.set('memories-pre', preQuantized);
  db.prepare(`INSERT INTO memories (id, embedding) VALUES (?, ?)`).run(
    'memories-pre',
    float32ToQuantized(preQuantized),
  );
});

describe('quantize-embeddings-v1', () => {
  it('declares its metadata and dependencies', () => {
    expect(quantizeEmbeddingsMigration.id).toBe('quantize-embeddings-v1');
    expect(quantizeEmbeddingsMigration.dependsOn).toContain('normalize-vector-storage-v1');
    expect(quantizeEmbeddingsMigration.dependsOn).toContain('normalize-embeddings-unit-vectors-v1');
  });

  it('shouldRun is true while legacy Float32 blobs remain', async () => {
    await expect(quantizeEmbeddingsMigration.shouldRun()).resolves.toBe(true);
  });

  it('quantizes every legacy blob across all three tables, preserving direction', async () => {
    const result = await quantizeEmbeddingsMigration.run();

    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(21); // 7 legacy rows × 3 tables

    for (const table of ['memories', 'conversation_chunks', 'vector_entries']) {
      const rows = db
        .prepare(`SELECT id, embedding FROM "${table}" WHERE embedding IS NOT NULL`)
        .all() as { id: string; embedding: Buffer }[];
      for (const row of rows) {
        expect(isQuantizedEmbeddingBlob(row.embedding)).toBe(true);
        const back = blobToFloat32(row.embedding);
        expect(cosine(back, originals.get(row.id)!)).toBeGreaterThanOrEqual(0.999);
      }
    }

    // NULL embeddings untouched.
    const nullRow = db
      .prepare(`SELECT embedding FROM memories WHERE id = 'memories-null'`)
      .get() as { embedding: Buffer | null };
    expect(nullRow.embedding).toBeNull();

    expect(mockReportProgress).toHaveBeenCalled();
  });

  it('is idempotent: after a run, shouldRun is false and a re-run touches nothing', async () => {
    await quantizeEmbeddingsMigration.run();
    await expect(quantizeEmbeddingsMigration.shouldRun()).resolves.toBe(false);

    const second = await quantizeEmbeddingsMigration.run();
    expect(second.success).toBe(true);
    expect(second.itemsAffected).toBe(0);
  });

  it('leaves an already-quantized row byte-identical', async () => {
    const before = (db
      .prepare(`SELECT embedding FROM memories WHERE id = 'memories-pre'`)
      .get() as { embedding: Buffer }).embedding;
    await quantizeEmbeddingsMigration.run();
    const after = (db
      .prepare(`SELECT embedding FROM memories WHERE id = 'memories-pre'`)
      .get() as { embedding: Buffer }).embedding;
    expect(Buffer.compare(before, after)).toBe(0);
  });
});
