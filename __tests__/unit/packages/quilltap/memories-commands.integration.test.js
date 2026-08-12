/**
 * @jest-environment node
 *
 * Unit tests for `quilltap memories` pure helpers.
 *
 * These tests exercise the in-process JavaScript: argument parsing, sort/order
 * SQL building, the graph-traversal helper, and the line-matching utility.
 * The CLI itself is smoke-tested separately against a real instance.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const QUILLTAP_PKG = path.join(__dirname, '..', '..', '..', '..', 'packages', 'quilltap');
const {
  parseFlags,
  buildOrderBy,
  traverseMemoryGraph,
  findMatches,
  resolveMemoryId,
} = require(path.join(QUILLTAP_PKG, 'lib', 'memories-commands'));

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

// ---------- parseFlags ----------

describe('parseFlags', () => {
  test('parses shared filters', () => {
    const { flags, positional } = parseFlags([
      '--character', 'Ariadne',
      '--about', 'self',
      '--source', 'AUTO',
      '--chat', 'none',
      '--project', 'Side',
      '--since', '2026-01-01',
      '--until', '2026-12-31',
      '--min-importance', '0.4',
      '--min-reinforced', '0.6',
      '--has-embedding',
      'ls',
    ]);
    expect(flags.character).toBe('Ariadne');
    expect(flags.about).toBe('self');
    expect(flags.source).toBe('AUTO');
    expect(flags.chat).toBe('none');
    expect(flags.project).toBe('Side');
    expect(flags.since).toBe('2026-01-01');
    expect(flags.until).toBe('2026-12-31');
    expect(flags.minImportance).toBeCloseTo(0.4);
    expect(flags.minReinforced).toBeCloseTo(0.6);
    expect(flags.hasEmbedding).toBe(true);
    expect(positional).toEqual(['ls']);
  });

  test('--no-embedding sets hasEmbedding=false', () => {
    const { flags } = parseFlags(['--no-embedding']);
    expect(flags.hasEmbedding).toBe(false);
  });

  test('-i and -l grep shorthands', () => {
    const { flags, positional } = parseFlags(['grep', '-i', '-l', 'needle']);
    expect(flags.ignoreCase).toBe(true);
    expect(flags.pathsOnly).toBe(true);
    expect(positional).toEqual(['grep', 'needle']);
  });

  test('--instance and --data-dir are stripped to globals', () => {
    const { flags, positional } = parseFlags(['--instance', 'Friday', 'ls', '--limit', '10']);
    expect(flags.instance).toBe('Friday');
    expect(flags.limit).toBe(10);
    expect(positional).toEqual(['ls']);
  });

  test('--sort and -r reverse', () => {
    const { flags } = parseFlags(['--sort', 'created', '-r']);
    expect(flags.sort).toBe('created');
    expect(flags.reverse).toBe(true);
  });
});

// ---------- buildOrderBy ----------

describe('buildOrderBy', () => {
  test('defaults to reinforced', () => {
    const ob = buildOrderBy('', false);
    expect(ob.order).toContain('reinforcedImportance DESC');
    expect(ob.impField).toBe('reinforcedImportance');
  });

  test('importance sort uses raw importance and switches imp column', () => {
    const ob = buildOrderBy('importance', false);
    expect(ob.order).toContain('m.importance DESC');
    expect(ob.impField).toBe('importance');
  });

  test('reverse flips DESC to ASC', () => {
    const ob = buildOrderBy('created', true);
    expect(ob.order).toContain('m.createdAt ASC');
    expect(ob.order).not.toMatch(/\bDESC\b/);
  });

  test('unknown sort field throws', () => {
    expect(() => buildOrderBy('bogus', false)).toThrow(/Unknown --sort field/);
  });
});

// ---------- findMatches ----------

describe('findMatches', () => {
  test('returns line numbers + context windows', () => {
    const text = ['alpha', 'beta needle line', 'gamma', 'delta needle again', 'epsilon'].join('\n');
    const matches = findMatches(text, 'needle', { ignoreCase: false, max: 10, context: 1 });
    expect(matches.length).toBe(2);
    expect(matches[0].line).toBe(2);
    expect(matches[0].context).toEqual(['alpha', 'beta needle line', 'gamma']);
    expect(matches[0].matchIndexInContext).toBe(1);
    expect(matches[1].line).toBe(4);
  });

  test('respects max', () => {
    const text = 'x\n'.repeat(20).split('\n').map((_, i) => `line${i} needle`).join('\n');
    const matches = findMatches(text, 'needle', { ignoreCase: false, max: 3, context: 0 });
    expect(matches.length).toBe(3);
  });

  test('case-insensitive', () => {
    const matches = findMatches('Hello NEEDLE', 'needle', { ignoreCase: true, max: 5, context: 0 });
    expect(matches.length).toBe(1);
  });

  test('empty text returns no matches', () => {
    expect(findMatches('', 'needle', { ignoreCase: false, max: 5, context: 0 })).toEqual([]);
  });
});

// ---------- traverseMemoryGraph (uses real better-sqlite3) ----------

describe('traverseMemoryGraph', () => {
  let db;
  let tempDir;
  let dbPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-memories-test-'));
    dbPath = path.join(tempDir, 'test.db');
    const Database = loadDriver();
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        summary TEXT,
        reinforcedImportance REAL,
        relatedMemoryIds TEXT
      )
    `);
  });

  afterEach(() => {
    if (db) db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function insert(id, summary, imp, related) {
    db.prepare('INSERT INTO memories (id, summary, reinforcedImportance, relatedMemoryIds) VALUES (?, ?, ?, ?)')
      .run(id, summary, imp, JSON.stringify(related));
  }

  test('linear chain walks to depth', () => {
    insert('a', 'A', 0.8, ['b']);
    insert('b', 'B', 0.7, ['c']);
    insert('c', 'C', 0.6, []);
    const result = traverseMemoryGraph(db, 'a', 5, 100);
    expect(result.visited).toBe(3);
    expect(result.cycles).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.root.children[0].children[0].id).toBe('c');
  });

  test('cycle detected via visited-set', () => {
    insert('a', 'A', 0.8, ['b']);
    insert('b', 'B', 0.7, ['a']);
    const result = traverseMemoryGraph(db, 'a', 5, 100);
    expect(result.cycles).toBeGreaterThan(0);
    // The cycle node should be marked as cycle: true
    expect(result.root.children[0].children[0].cycle).toBe(true);
  });

  test('self-loop is a cycle', () => {
    insert('a', 'A', 0.8, ['a']);
    const result = traverseMemoryGraph(db, 'a', 3, 100);
    expect(result.cycles).toBe(1);
  });

  test('dangling edge becomes missing leaf', () => {
    insert('a', 'A', 0.8, ['b', 'ghost']);
    insert('b', 'B', 0.7, []);
    const result = traverseMemoryGraph(db, 'a', 3, 100);
    const children = result.root.children;
    expect(children).toHaveLength(2);
    const ghost = children.find(c => c.id === 'ghost');
    expect(ghost.missing).toBe(true);
  });

  test('depth cap prevents further walking', () => {
    insert('a', 'A', 0.8, ['b']);
    insert('b', 'B', 0.7, ['c']);
    insert('c', 'C', 0.6, []);
    const result = traverseMemoryGraph(db, 'a', 1, 100);
    expect(result.visited).toBe(2);
    // depth 1 means root is visited and its direct neighbour, but the grandchild is not walked.
    expect(result.root.children[0].children).toEqual([]);
  });

  test('max-nodes cap truncates and sets flag', () => {
    for (let i = 0; i < 5; i++) {
      const next = i < 4 ? [`m${i + 1}`] : [];
      insert(`m${i}`, `Summary ${i}`, 0.5, next);
    }
    const result = traverseMemoryGraph(db, 'm0', 10, 2);
    expect(result.truncated).toBe(true);
    expect(result.visited).toBeLessThanOrEqual(2);
  });
});

// ---------- resolveMemoryId ----------

describe('resolveMemoryId', () => {
  let db;
  let tempDir;
  let dbPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-memories-test-'));
    dbPath = path.join(tempDir, 'test.db');
    const Database = loadDriver();
    db = new Database(dbPath);
    db.exec('CREATE TABLE memories (id TEXT PRIMARY KEY, summary TEXT)');
    db.prepare('INSERT INTO memories (id) VALUES (?)').run('abc12345-1111-2222-3333-444455556666');
    db.prepare('INSERT INTO memories (id) VALUES (?)').run('abc12399-1111-2222-3333-444455556666');
    db.prepare('INSERT INTO memories (id) VALUES (?)').run('def00000-1111-2222-3333-444455556666');
  });

  afterEach(() => {
    if (db) db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('full UUID resolves', () => {
    const id = resolveMemoryId(db, 'def00000-1111-2222-3333-444455556666');
    expect(id).toBe('def00000-1111-2222-3333-444455556666');
  });

  test('unique 8-char prefix resolves', () => {
    const id = resolveMemoryId(db, 'def00000');
    expect(id).toBe('def00000-1111-2222-3333-444455556666');
  });

  test('prefix shorter than 8 chars rejected', () => {
    expect(() => resolveMemoryId(db, 'abc')).toThrow(/at least 8/);
  });

  test('ambiguous prefix throws with .ambiguous flag', () => {
    let caught;
    try {
      resolveMemoryId(db, 'abc12');  // matches 2 rows but is too short
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/at least 8/);
  });

  test('ambiguous 8-char prefix throws', () => {
    db.prepare('INSERT INTO memories (id) VALUES (?)').run('abc12345-aaaa-bbbb-cccc-dddddddddddd');
    let caught;
    try {
      resolveMemoryId(db, 'abc12345');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.ambiguous).toBe(true);
    expect(caught.message).toMatch(/Multiple memories/);
  });

  test('non-existent prefix throws', () => {
    expect(() => resolveMemoryId(db, 'zz000000')).toThrow(/No memory/);
  });
});
