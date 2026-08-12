/**
 * @jest-environment node
 *
 * Unit tests for the shared graph-integrity scanner used by
 * `quilltap memories status` and `quilltap memories validate`.
 *
 * Uses a real in-memory SQLite DB (matching memories-commands.test.js) so the
 * JSON parsing, cross-character valid-ID set, and dangling-edge counting are
 * exercised end-to-end.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const QUILLTAP_PKG = path.join(__dirname, '..', '..', '..', '..', 'packages', 'quilltap');
const { scanDanglingEdges } = require(path.join(QUILLTAP_PKG, 'lib', 'graph-integrity'));

function loadDriver() {
  try {
    return require(path.join(QUILLTAP_PKG, 'node_modules', 'better-sqlite3-multiple-ciphers'));
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers');
    } catch {
      // Root package.json aliases better-sqlite3-multiple-ciphers as better-sqlite3, so
      // in CI (where only the root install runs) the driver lives at
      // <root>/node_modules/better-sqlite3. Require by absolute path so the jest
      // moduleNameMapper that mocks 'better-sqlite3' for the rest of the suite does
      // not intercept this load — we want the real native binding here.
      return require(path.join(QUILLTAP_PKG, '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}

describe('scanDanglingEdges', () => {
  let db;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-graph-integrity-test-'));
    const dbPath = path.join(tempDir, 'test.db');
    const Database = loadDriver();
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        characterId TEXT NOT NULL,
        relatedMemoryIds TEXT
      )
    `);
  });

  afterEach(() => {
    if (db) db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function insert(id, characterId, related) {
    db.prepare('INSERT INTO memories (id, characterId, relatedMemoryIds) VALUES (?, ?, ?)')
      .run(id, characterId, related === null ? null : JSON.stringify(related));
  }

  test('reports zero dangling on a clean graph', () => {
    insert('a', 'c1', ['b']);
    insert('b', 'c1', ['a']);
    const stats = scanDanglingEdges(db);
    expect(stats.danglingEdges).toBe(0);
    expect(stats.withLinks).toBe(2);
    expect(stats.isolated).toBe(0);
    expect(stats.totalEdges).toBe(2);
  });

  test('counts UUIDs that do not resolve as dangling', () => {
    insert('a', 'c1', ['b', 'ghost-1']);
    insert('b', 'c1', ['a', 'ghost-2']);
    const stats = scanDanglingEdges(db);
    expect(stats.danglingEdges).toBe(2);
  });

  test('cross-character links are not dangling', () => {
    insert('x', 'char-A', ['y']);
    insert('y', 'char-B', ['x']);
    const stats = scanDanglingEdges(db);
    expect(stats.danglingEdges).toBe(0);
  });

  test('character scoping still counts globals as valid', () => {
    // Holder=char-A. Link points at a memory owned by char-B (still valid).
    insert('a', 'char-A', ['b', 'ghost']);
    insert('b', 'char-B', []);
    const stats = scanDanglingEdges(db, { characterId: 'char-A' });
    expect(stats.nodes).toBe(1);
    expect(stats.danglingEdges).toBe(1);
  });

  test('isolated nodes are counted separately', () => {
    insert('a', 'c1', []);
    insert('b', 'c1', null);
    insert('c', 'c1', ['a']);
    const stats = scanDanglingEdges(db);
    expect(stats.isolated).toBe(2);
    expect(stats.withLinks).toBe(1);
  });

  test('includePairs returns per-source dangling lists', () => {
    insert('a', 'c1', ['ghost1', 'ghost2']);
    insert('b', 'c1', ['ghost3']);
    const stats = scanDanglingEdges(db, { includePairs: true });
    expect(stats.danglingEdges).toBe(3);
    expect(stats.danglingPairs).toEqual(
      expect.arrayContaining([
        { sourceId: 'a', characterId: 'c1', targetIds: ['ghost1', 'ghost2'] },
        { sourceId: 'b', characterId: 'c1', targetIds: ['ghost3'] },
      ])
    );
  });

  test('avgDegree rounds to two decimal places', () => {
    // Two nodes with links, total 3 edges → avg 1.5.
    insert('a', 'c1', ['b']);
    insert('b', 'c1', ['a', 'a-extra']);
    insert('a-extra', 'c1', []);
    const stats = scanDanglingEdges(db);
    expect(stats.withLinks).toBe(2);
    expect(stats.avgDegree).toBe(1.5);
  });

  test('handles malformed JSON gracefully (treats as empty)', () => {
    db.prepare('INSERT INTO memories (id, characterId, relatedMemoryIds) VALUES (?, ?, ?)')
      .run('busted', 'c1', '{not-json');
    insert('good', 'c1', []);
    const stats = scanDanglingEdges(db);
    expect(stats.danglingEdges).toBe(0);
    expect(stats.isolated).toBe(2);
  });
});
