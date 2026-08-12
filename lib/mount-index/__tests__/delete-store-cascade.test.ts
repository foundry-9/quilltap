/**
 * @jest-environment node
 *
 * Bug 9 — deleting a document store must tear its children down atomically.
 *
 * The v4 route ran seven un-transacted repo calls in an order that left two
 * steps reading a table an earlier step had emptied (native-text documents
 * leaked) and never deleted `group_doc_mount_links` at all. `deleteStoreCascade`
 * replaces that with one mount-index transaction; `reapOrphanedStoreChildren`
 * mops up rows already stranded on existing instances.
 *
 * Strategy: a real in-memory SQLite database via the native binding, wired into
 * the cascade by mocking `getRawMountIndexDatabase`. The `@jest-environment
 * node` docblock is mandatory for real-binding suites (native Buffers segfault
 * on the jsdom realm boundary).
 */

import path from 'path';

// ── Load the real native SQLite driver (not the jest mock alias) ──────────────
function loadDriver() {
  const repoRoot = path.join(__dirname, '..', '..', '..');
  const candidates = [
    () => require(path.join(repoRoot, 'node_modules', 'better-sqlite3')),
    () => require(path.join(repoRoot, 'packages', 'quilltap', 'node_modules', 'better-sqlite3-multiple-ciphers')),
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
  throw new Error('delete-store-cascade.test: no real SQLite binding available');
}
const Database = loadDriver();
type DatabaseInstance = InstanceType<typeof Database>;

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('@/lib/logger', () => {
  const l = { child: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  l.child.mockReturnValue(l);
  return { logger: l };
});
jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  getRawMountIndexDatabase: jest.fn(),
}));
jest.mock('@/lib/mount-index/mount-chunk-cache', () => ({
  invalidateMountPoint: jest.fn(),
}));

import { deleteStoreCascade } from '../delete-store-cascade';
import { reapOrphanedStoreChildren } from '../orphan-store-reaper';
import { getRawMountIndexDatabase } from '@/lib/database/backends/sqlite/mount-index-client';

let db: DatabaseInstance;

function createSchema(database: DatabaseInstance) {
  database.exec(`
    CREATE TABLE doc_mount_points (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE doc_mount_files (id TEXT PRIMARY KEY, sha256 TEXT);
    CREATE TABLE doc_mount_file_links (
      id TEXT PRIMARY KEY, fileId TEXT, mountPointId TEXT, relativePath TEXT
    );
    CREATE TABLE doc_mount_documents (id TEXT PRIMARY KEY, fileId TEXT, content TEXT);
    CREATE TABLE doc_mount_blobs (id TEXT PRIMARY KEY, fileId TEXT, data BLOB);
    CREATE TABLE doc_mount_folders (id TEXT PRIMARY KEY, mountPointId TEXT, path TEXT);
    CREATE TABLE doc_mount_chunks (id TEXT PRIMARY KEY, mountPointId TEXT, linkId TEXT);
    CREATE TABLE project_doc_mount_links (id TEXT PRIMARY KEY, mountPointId TEXT, projectId TEXT);
    CREATE TABLE group_doc_mount_links (id TEXT PRIMARY KEY, mountPointId TEXT, groupId TEXT);
  `);
}

/**
 * Store A (target of the delete) shares file1 with a healthy store B and owns
 * file2 exclusively, plus a folder, chunks, and both a project and a group
 * link. Store B keeps its own link to the shared file.
 */
function seedTwoStores(database: DatabaseInstance) {
  database.exec(`
    INSERT INTO doc_mount_points (id, name) VALUES ('mpA', 'Store A'), ('mpB', 'Store B');
    INSERT INTO doc_mount_files (id, sha256) VALUES ('file1', 'sha-shared'), ('file2', 'sha-excl');
    INSERT INTO doc_mount_file_links (id, fileId, mountPointId, relativePath) VALUES
      ('lA1', 'file1', 'mpA', 'shared.md'),
      ('lA2', 'file2', 'mpA', 'exclusive.md'),
      ('lB1', 'file1', 'mpB', 'shared.md');
    INSERT INTO doc_mount_documents (id, fileId, content) VALUES
      ('doc1', 'file1', 'shared'), ('doc2', 'file2', 'exclusive');
    INSERT INTO doc_mount_blobs (id, fileId, data) VALUES
      ('blob1', 'file1', x'00'), ('blob2', 'file2', x'01');
    INSERT INTO doc_mount_folders (id, mountPointId, path) VALUES
      ('folA', 'mpA', 'sub'), ('folB', 'mpB', 'sub');
    INSERT INTO doc_mount_chunks (id, mountPointId, linkId) VALUES
      ('chkA', 'mpA', 'lA2'), ('chkB', 'mpB', 'lB1');
    INSERT INTO project_doc_mount_links (id, mountPointId, projectId) VALUES ('plA', 'mpA', 'proj');
    INSERT INTO group_doc_mount_links (id, mountPointId, groupId) VALUES ('glA', 'mpA', 'grp');
  `);
}

const count = (table: string, where = '', ...params: unknown[]): number =>
  (db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get(...params) as { c: number }).c;

beforeEach(() => {
  jest.clearAllMocks();
  db = new Database(':memory:');
  createSchema(db);
  (getRawMountIndexDatabase as jest.Mock).mockReturnValue(db);
});

afterEach(() => db.close());

describe('deleteStoreCascade', () => {
  it('deletes every child of the store, GCs its exclusive content, and keeps shared content + peers', () => {
    seedTwoStores(db);

    const counts = deleteStoreCascade('mpA');

    // Store A and all of its children are gone.
    expect(count('doc_mount_points', "WHERE id = 'mpA'")).toBe(0);
    expect(count('doc_mount_file_links', "WHERE mountPointId = 'mpA'")).toBe(0);
    expect(count('doc_mount_chunks', "WHERE mountPointId = 'mpA'")).toBe(0);
    expect(count('doc_mount_folders', "WHERE mountPointId = 'mpA'")).toBe(0);
    expect(count('project_doc_mount_links', "WHERE mountPointId = 'mpA'")).toBe(0);
    // group_doc_mount_links was NEVER deleted by the v4 route — the core leak.
    expect(count('group_doc_mount_links', "WHERE mountPointId = 'mpA'")).toBe(0);

    // file2 was exclusive to A → its content rows are GC'd (documents leaked pre-fix).
    expect(count('doc_mount_files', "WHERE id = 'file2'")).toBe(0);
    expect(count('doc_mount_documents', "WHERE fileId = 'file2'")).toBe(0);
    expect(count('doc_mount_blobs', "WHERE fileId = 'file2'")).toBe(0);

    // file1 is still linked by store B → shared content survives.
    expect(count('doc_mount_files', "WHERE id = 'file1'")).toBe(1);
    expect(count('doc_mount_documents', "WHERE fileId = 'file1'")).toBe(1);
    expect(count('doc_mount_blobs', "WHERE fileId = 'file1'")).toBe(1);

    // Store B is entirely untouched.
    expect(count('doc_mount_points', "WHERE id = 'mpB'")).toBe(1);
    expect(count('doc_mount_file_links', "WHERE mountPointId = 'mpB'")).toBe(1);
    expect(count('doc_mount_chunks', "WHERE mountPointId = 'mpB'")).toBe(1);
    expect(count('doc_mount_folders', "WHERE mountPointId = 'mpB'")).toBe(1);

    expect(counts).toMatchObject({
      links: 2, chunks: 1, folders: 1, projectLinks: 1, groupLinks: 1,
      files: 1, documents: 1, blobs: 1, mountPoint: 1,
    });
  });

  it('rolls the whole cascade back when a mid-cascade step throws', () => {
    seedTwoStores(db);
    // A trigger that raises when the folders step runs, mid-cascade.
    db.exec(`
      CREATE TRIGGER boom BEFORE DELETE ON doc_mount_folders
      BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `);

    expect(() => deleteStoreCascade('mpA')).toThrow(/boom/);

    // Nothing was deleted — the earlier chunk/link deletes rolled back too.
    expect(count('doc_mount_points', "WHERE id = 'mpA'")).toBe(1);
    expect(count('doc_mount_file_links', "WHERE mountPointId = 'mpA'")).toBe(2);
    expect(count('doc_mount_chunks', "WHERE mountPointId = 'mpA'")).toBe(1);
    expect(count('group_doc_mount_links', "WHERE mountPointId = 'mpA'")).toBe(1);
    expect(count('doc_mount_files')).toBe(2);
  });

  it('skips child tables that do not exist on the instance', () => {
    // A store with no database-backed content never created the payload tables.
    db.exec(`DROP TABLE doc_mount_documents; DROP TABLE doc_mount_blobs;`);
    db.exec(`
      INSERT INTO doc_mount_points (id, name) VALUES ('mpC', 'Store C');
      INSERT INTO doc_mount_files (id, sha256) VALUES ('fileC', 'sha-c');
      INSERT INTO doc_mount_file_links (id, fileId, mountPointId, relativePath)
        VALUES ('lC', 'fileC', 'mpC', 'c.md');
    `);

    expect(() => deleteStoreCascade('mpC')).not.toThrow();
    expect(count('doc_mount_points', "WHERE id = 'mpC'")).toBe(0);
    expect(count('doc_mount_files', "WHERE id = 'fileC'")).toBe(0);
  });
});

describe('reapOrphanedStoreChildren', () => {
  it('removes children whose mount point vanished and keeps healthy rows', () => {
    db.exec(`
      INSERT INTO doc_mount_points (id, name) VALUES ('mpLive', 'Live');
      INSERT INTO doc_mount_files (id, sha256) VALUES ('fLive', 'l'), ('fDead', 'd');
      -- Healthy: mount point exists.
      INSERT INTO doc_mount_file_links (id, fileId, mountPointId, relativePath)
        VALUES ('lLive', 'fLive', 'mpLive', 'live.md');
      INSERT INTO doc_mount_folders (id, mountPointId, path) VALUES ('folLive', 'mpLive', 'x');
      INSERT INTO doc_mount_documents (id, fileId, content) VALUES ('dLive', 'fLive', 'live');
      -- Orphaned: mount point 'mpGone' was deleted non-atomically.
      INSERT INTO doc_mount_file_links (id, fileId, mountPointId, relativePath)
        VALUES ('lDead', 'fDead', 'mpGone', 'dead.md');
      INSERT INTO doc_mount_folders (id, mountPointId, path) VALUES ('folDead', 'mpGone', 'y');
      INSERT INTO doc_mount_documents (id, fileId, content) VALUES ('dDead', 'fDead', 'dead');
    `);

    const swept = reapOrphanedStoreChildren(db);

    expect(swept).toEqual({ links: 1, folders: 1, documents: 1 });
    // Orphans gone.
    expect(count('doc_mount_file_links', "WHERE id = 'lDead'")).toBe(0);
    expect(count('doc_mount_folders', "WHERE id = 'folDead'")).toBe(0);
    expect(count('doc_mount_documents', "WHERE id = 'dDead'")).toBe(0);
    // Healthy rows kept.
    expect(count('doc_mount_file_links', "WHERE id = 'lLive'")).toBe(1);
    expect(count('doc_mount_folders', "WHERE id = 'folLive'")).toBe(1);
    expect(count('doc_mount_documents', "WHERE id = 'dLive'")).toBe(1);
  });

  it('is a no-op when there are no orphans', () => {
    db.exec(`INSERT INTO doc_mount_points (id, name) VALUES ('mp', 'Only');`);
    expect(reapOrphanedStoreChildren(db)).toEqual({ links: 0, folders: 0, documents: 0 });
  });
});
