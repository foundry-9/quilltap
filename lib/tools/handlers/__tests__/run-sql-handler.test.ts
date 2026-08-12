/**
 * @jest-environment node
 *
 * Unit tests for the Brahma Console's read-only SQL handler (`executeRunSqlTool`).
 *
 * The load-bearing guarantee is read-only enforcement. We cover all three
 * defense layers: the keyword/statement pre-scan, the authoritative
 * `better-sqlite3` `stmt.readonly` check (driven in isolation with a stub
 * statement that reports `readonly: false` for an otherwise-allowed SELECT),
 * and the `max_rows` cap. Plus database routing, degraded-handle handling, and
 * row shaping (BLOB → placeholder, columns even for empty results).
 *
 * Strategy: real in-memory SQLite via the native binding (not the jest mock
 * stub), wired into the handler by mocking the three raw-database accessors.
 * The `@jest-environment node` docblock is mandatory for real-binding suites —
 * it keeps native Buffers off the jsdom realm boundary that segfaults SQLCipher.
 */

import path from 'path';

// ---------------------------------------------------------------------------
// Load the real native SQLite driver (not the jest mock alias).
//
// Path-based requires come first because they bypass jest's moduleNameMapper;
// the bare names are mapped to __mocks__/better-sqlite3.ts in the unit config,
// so a bare require can silently hand back the mock (whose statements never
// report readonly:true, which trips the handler's fail-closed guard). The
// probe below rejects any candidate that isn't a real binding.
// ---------------------------------------------------------------------------
function loadDriver() {
  const repoRoot = path.join(__dirname, '..', '..', '..', '..');
  const candidates = [
    () => require(path.join(repoRoot, 'packages', 'quilltap', 'node_modules', 'better-sqlite3-multiple-ciphers')),
    () => require(path.join(repoRoot, 'node_modules', 'better-sqlite3')),
    () => require('better-sqlite3-multiple-ciphers'),
  ];
  for (const candidate of candidates) {
    try {
      const Driver = candidate();
      const probe = new Driver(':memory:');
      const isReal = probe.prepare('SELECT 1').readonly === true;
      probe.close();
      if (isReal) return Driver;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('run-sql-handler.test: no real SQLite binding available (only the jest mock resolved)');
}
const Database = loadDriver();
type DatabaseInstance = ReturnType<typeof Database>;

// ── Mocks (bare factories; configured in beforeEach via jest.mocked) ──────────
jest.mock('@/lib/logger', () => {
  const l = {
    child: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  l.child.mockReturnValue(l);
  return { logger: l };
});

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(),
}));
jest.mock('@/lib/database/backends/sqlite/llm-logs-client', () => ({
  getRawLLMLogsDatabase: jest.fn(),
}));
jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  getRawMountIndexDatabase: jest.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { executeRunSqlTool } from '../run-sql-handler';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { getRawLLMLogsDatabase } from '@/lib/database/backends/sqlite/llm-logs-client';
import { getRawMountIndexDatabase } from '@/lib/database/backends/sqlite/mount-index-client';

const CTX = { userId: 'user-1' };

let mainDb: DatabaseInstance;
let llmLogsDb: DatabaseInstance;
let mountIndexDb: DatabaseInstance;

beforeEach(() => {
  jest.clearAllMocks();

  // main DB: a notes table (writable target) + a memories table with a BLOB.
  mainDb = new Database(':memory:');
  mainDb.exec(`
    CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
    CREATE TABLE memories (id TEXT, importance REAL, embedding BLOB);
  `);
  const insertNote = mainDb.prepare('INSERT INTO notes (body) VALUES (?)');
  for (let i = 0; i < 5; i++) insertNote.run(`note-${i}`);
  mainDb
    .prepare('INSERT INTO memories (id, importance, embedding) VALUES (?, ?, ?)')
    .run('m1', 0.7, Buffer.from(new Uint8Array([1, 2, 3, 4])));

  // llm-logs DB: a distinguishing table to prove routing.
  llmLogsDb = new Database(':memory:');
  llmLogsDb.exec('CREATE TABLE llm_logs (id TEXT, marker TEXT)');
  llmLogsDb.prepare('INSERT INTO llm_logs (id, marker) VALUES (?, ?)').run('l1', 'LLMLOGS');

  // mount-index DB: a distinguishing table to prove routing.
  mountIndexDb = new Database(':memory:');
  mountIndexDb.exec('CREATE TABLE doc_mount_documents (fileId TEXT, marker TEXT)');
  mountIndexDb.prepare('INSERT INTO doc_mount_documents (fileId, marker) VALUES (?, ?)').run('f1', 'MOUNTINDEX');

  jest.mocked(getRawDatabase).mockReturnValue(mainDb as never);
  jest.mocked(getRawLLMLogsDatabase).mockReturnValue(llmLogsDb as never);
  jest.mocked(getRawMountIndexDatabase).mockReturnValue(mountIndexDb as never);
});

afterEach(() => {
  mainDb?.close();
  llmLogsDb?.close();
  mountIndexDb?.close();
});

describe('executeRunSqlTool — read-only guard', () => {
  const writeQueries: Array<[string, string]> = [
    ['UPDATE', "UPDATE notes SET body = 'x'"],
    ['DELETE', 'DELETE FROM notes'],
    ['INSERT', "INSERT INTO notes (body) VALUES ('x')"],
    ['DROP', 'DROP TABLE notes'],
    ['ALTER', 'ALTER TABLE notes ADD COLUMN extra TEXT'],
    ['CREATE', 'CREATE TABLE t (id INTEGER)'],
    ['VACUUM', 'VACUUM'],
    ['REINDEX', 'REINDEX'],
    ['mutating PRAGMA', 'PRAGMA journal_mode = WAL'],
    ['multi-statement', 'SELECT 1; DELETE FROM notes'],
    ['CTE wrapping a write', 'WITH x AS (SELECT 1) DELETE FROM notes'],
  ];

  for (const [label, sql] of writeQueries) {
    it(`rejects ${label}`, async () => {
      const result = await executeRunSqlTool({ sql }, CTX);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBeTruthy();
    });
  }

  const readQueries: Array<[string, string]> = [
    ['SELECT', 'SELECT id, body FROM notes ORDER BY id'],
    ['WITH … SELECT', 'WITH t AS (SELECT 1 AS n) SELECT n FROM t'],
    ['EXPLAIN', 'EXPLAIN SELECT * FROM notes'],
    ['read-only PRAGMA', 'PRAGMA table_info(memories)'],
  ];

  for (const [label, sql] of readQueries) {
    it(`allows ${label}`, async () => {
      const result = await executeRunSqlTool({ sql }, CTX);
      expect(result.success).toBe(true);
    });
  }

  it('allows a scalar REPLACE() function call (not the INSERT OR REPLACE statement)', async () => {
    const result = await executeRunSqlTool(
      { sql: "SELECT REPLACE(body, 'note', 'item') AS renamed FROM notes LIMIT 1" },
      CTX
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.rows[0].renamed).toBe('item-0');
  });

  it('fails closed via the stmt.readonly check when a SELECT prepares to a non-readonly statement', async () => {
    // A statement that sails past the keyword pre-scan (leading SELECT, no
    // forbidden keyword) but whose prepared form reports readonly:false. This
    // isolates layer 2 — the authoritative better-sqlite3 guard.
    const stubDb = {
      prepare: jest.fn().mockReturnValue({ readonly: false, reader: false }),
    };
    jest.mocked(getRawDatabase).mockReturnValue(stubDb as never);

    const result = await executeRunSqlTool({ sql: 'SELECT writes_somehow()' }, CTX);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/read-only/i);
  });

  it('documents the guard basis: a real prepared write reports readonly === false', () => {
    expect(mainDb.prepare("INSERT INTO notes (body) VALUES ('z')").readonly).toBe(false);
    expect(mainDb.prepare('SELECT * FROM notes').readonly).toBe(true);
  });
});

describe('executeRunSqlTool — database routing', () => {
  it('routes database:"main" to the main accessor', async () => {
    const result = await executeRunSqlTool({ sql: 'SELECT body FROM notes LIMIT 1', database: 'main' }, CTX);
    expect(result.success).toBe(true);
    if (result.success) expect(result.database).toBe('main');
    expect(getRawDatabase).toHaveBeenCalled();
  });

  it('routes database:"llm-logs" to the llm-logs accessor', async () => {
    const result = await executeRunSqlTool({ sql: 'SELECT marker FROM llm_logs', database: 'llm-logs' }, CTX);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.database).toBe('llm-logs');
      expect(result.rows[0].marker).toBe('LLMLOGS');
    }
    expect(getRawLLMLogsDatabase).toHaveBeenCalled();
  });

  it('routes database:"mount-index" to the mount-index accessor', async () => {
    const result = await executeRunSqlTool(
      { sql: 'SELECT marker FROM doc_mount_documents', database: 'mount-index' },
      CTX
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.database).toBe('mount-index');
      expect(result.rows[0].marker).toBe('MOUNTINDEX');
    }
    expect(getRawMountIndexDatabase).toHaveBeenCalled();
  });

  it('defaults to the main database when no database is given', async () => {
    const result = await executeRunSqlTool({ sql: 'SELECT body FROM notes LIMIT 1' }, CTX);
    expect(result.success).toBe(true);
    if (result.success) expect(result.database).toBe('main');
  });

  it('returns a clean error (not a throw) for a degraded/null handle', async () => {
    jest.mocked(getRawLLMLogsDatabase).mockReturnValue(null);
    const result = await executeRunSqlTool({ sql: 'SELECT 1', database: 'llm-logs' }, CTX);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/not available/i);
  });
});

describe('executeRunSqlTool — shaping', () => {
  it('replaces BLOB columns with a <blob: N bytes> placeholder', async () => {
    const result = await executeRunSqlTool({ sql: 'SELECT id, importance, embedding FROM memories' }, CTX);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows[0].embedding).toBe('<blob: 4 bytes>');
      expect(result.rows[0].importance).toBe(0.7);
    }
  });

  it('can still test BLOB presence with IS NOT NULL', async () => {
    const result = await executeRunSqlTool(
      { sql: 'SELECT COUNT(*) AS n FROM memories WHERE embedding IS NOT NULL' },
      CTX
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.rows[0].n).toBe(1);
  });

  it('sets truncated:true and caps rowCount when the result exceeds max_rows', async () => {
    const result = await executeRunSqlTool({ sql: 'SELECT id FROM notes ORDER BY id', max_rows: 2 }, CTX);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rowCount).toBe(2);
      expect(result.rows).toHaveLength(2);
      expect(result.truncated).toBe(true);
    }
  });

  it('sets truncated:false when the result fits under max_rows', async () => {
    const result = await executeRunSqlTool({ sql: 'SELECT id FROM notes ORDER BY id', max_rows: 100 }, CTX);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rowCount).toBe(5);
      expect(result.truncated).toBe(false);
    }
  });

  it('populates columns even when the result set is empty', async () => {
    const result = await executeRunSqlTool({ sql: 'SELECT id, body FROM notes WHERE 1 = 0' }, CTX);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows).toHaveLength(0);
      expect(result.columns).toEqual(['id', 'body']);
    }
  });
});

describe('executeRunSqlTool — input validation', () => {
  it('rejects an empty sql string', async () => {
    const result = await executeRunSqlTool({ sql: '' }, CTX);
    expect(result.success).toBe(false);
  });

  it('rejects max_rows above the hard cap (1000)', async () => {
    const result = await executeRunSqlTool({ sql: 'SELECT 1', max_rows: 5000 }, CTX);
    expect(result.success).toBe(false);
  });

  it('rejects a missing sql argument', async () => {
    const result = await executeRunSqlTool({}, CTX);
    expect(result.success).toBe(false);
  });

  it('returns a clean error for a SQL syntax error (errors are data, not throws)', async () => {
    const result = await executeRunSqlTool({ sql: 'SELECT * FROM no_such_table' }, CTX);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/SQL error/i);
  });
});
