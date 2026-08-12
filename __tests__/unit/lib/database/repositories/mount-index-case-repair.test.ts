/**
 * @jest-environment node
 *
 * Case-collision repair for database-backed vaults: sibling folders, file
 * links, and mount-point names may never match a peer except for casing.
 * Runs the real repair helpers against a real in-memory SQLite DB (mirrors
 * doc-mount-file-links-policy.integration.test.ts) so the renames, the
 * legacy→NOCASE index swap, and the resulting unique constraint are
 * exercised end-to-end.
 *
 * Guards:
 *   - lib/database/repositories/mount-index-case-repair.ts
 *   - lib/mount-index/unique-mount-point-name.ts (case-insensitive matching)
 */

import path from 'path';

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  ensureFolderNocaseUniqueIndex,
  ensureLinkNocaseUniqueIndex,
  repairMountPointNameCollisions,
  FOLDER_NOCASE_INDEX,
  LINK_NOCASE_INDEX,
} from '@/lib/database/repositories/mount-index-case-repair';
import { nextUniqueMountPointName } from '@/lib/mount-index/unique-mount-point-name';

// Root package.json aliases better-sqlite3-multiple-ciphers as better-sqlite3,
// and the jest moduleNameMapper replaces both bare names with a no-op mock.
// Require the real binding by absolute path (which the mapper's `^name$`
// patterns don't match) so this suite exercises actual SQL. The root alias is
// always installed by `npm ci`, unlike packages/quilltap's nested copy.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const MP = 'mp-1';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE doc_mount_points (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE doc_mount_folders (
      id TEXT PRIMARY KEY,
      mountPointId TEXT NOT NULL,
      parentId TEXT,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE doc_mount_file_links (
      id TEXT PRIMARY KEY,
      mountPointId TEXT NOT NULL,
      relativePath TEXT NOT NULL,
      fileName TEXT NOT NULL,
      folderId TEXT,
      createdAt TEXT NOT NULL
    );
  `);
  // The legacy case-sensitive indexes the repair must replace.
  db.exec(
    `CREATE UNIQUE INDEX "idx_doc_mount_folders_mp_parent_name" ` +
    `ON "doc_mount_folders" ("mountPointId", COALESCE("parentId", ''), "name")`
  );
  db.exec(
    `CREATE UNIQUE INDEX "idx_doc_mount_file_links_mp_path" ` +
    `ON "doc_mount_file_links" ("mountPointId", "relativePath")`
  );
  return db;
}

function insertFolder(db: any, id: string, parentId: string | null, name: string, folderPath: string, createdAt: string) {
  db.prepare(
    `INSERT INTO doc_mount_folders (id, mountPointId, parentId, name, path, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, MP, parentId, name, folderPath, createdAt, createdAt);
}

function insertLink(db: any, id: string, relativePath: string, folderId: string | null, createdAt: string) {
  db.prepare(
    `INSERT INTO doc_mount_file_links (id, mountPointId, relativePath, fileName, folderId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, MP, relativePath, path.posix.basename(relativePath), folderId, createdAt);
}

function indexExists(db: any, name: string): boolean {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`).get(name) !== undefined;
}

describe('ensureFolderNocaseUniqueIndex', () => {
  let db: any;
  afterEach(() => db.close());

  it('renames the newer of two case-colliding siblings and repairs its subtree and links', () => {
    db = freshDb();
    insertFolder(db, 'keep', null, 'Lore', 'Lore', '2024-01-01T00:00:00.000Z');
    insertFolder(db, 'lose', null, 'lore', 'lore', '2024-06-01T00:00:00.000Z');
    insertFolder(db, 'lose-child', 'lose', 'maps', 'lore/maps', '2024-06-02T00:00:00.000Z');
    insertLink(db, 'l1', 'lore/notes.md', 'lose', '2024-06-03T00:00:00.000Z');
    insertLink(db, 'l2', 'lore/maps/atlas.md', 'lose-child', '2024-06-03T00:00:00.000Z');
    insertLink(db, 'l3', 'Lore/canon.md', 'keep', '2024-01-02T00:00:00.000Z');

    ensureFolderNocaseUniqueIndex(db);

    const kept = db.prepare(`SELECT name, path FROM doc_mount_folders WHERE id = 'keep'`).get();
    expect(kept).toEqual({ name: 'Lore', path: 'Lore' });
    const renamed = db.prepare(`SELECT name, path FROM doc_mount_folders WHERE id = 'lose'`).get();
    expect(renamed).toEqual({ name: 'lore (2)', path: 'lore (2)' });
    const child = db.prepare(`SELECT path FROM doc_mount_folders WHERE id = 'lose-child'`).get();
    expect(child).toEqual({ path: 'lore (2)/maps' });

    const rels = db.prepare(`SELECT id, relativePath FROM doc_mount_file_links ORDER BY id`).all();
    expect(rels).toEqual([
      { id: 'l1', relativePath: 'lore (2)/notes.md' },
      { id: 'l2', relativePath: 'lore (2)/maps/atlas.md' },
      { id: 'l3', relativePath: 'Lore/canon.md' },
    ]);

    expect(indexExists(db, FOLDER_NOCASE_INDEX)).toBe(true);
    expect(indexExists(db, 'idx_doc_mount_folders_mp_parent_name')).toBe(false);
  });

  it('enforces case-insensitive sibling uniqueness afterwards, scoped to the parent', () => {
    db = freshDb();
    insertFolder(db, 'a', null, 'Lore', 'Lore', '2024-01-01T00:00:00.000Z');
    ensureFolderNocaseUniqueIndex(db);

    expect(() =>
      insertFolder(db, 'b', null, 'LORE', 'LORE', '2024-02-01T00:00:00.000Z')
    ).toThrow(/UNIQUE/i);
    // Same name under a different parent stays legal.
    insertFolder(db, 'c', 'a', 'lore', 'Lore/lore', '2024-02-01T00:00:00.000Z');
  });

  it('is idempotent once the NOCASE index exists', () => {
    db = freshDb();
    insertFolder(db, 'a', null, 'Lore', 'Lore', '2024-01-01T00:00:00.000Z');
    ensureFolderNocaseUniqueIndex(db);
    ensureFolderNocaseUniqueIndex(db);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM doc_mount_folders`).get().n).toBe(1);
  });

  it('repairs non-ASCII case-collisions the ASCII-only NOCASE index tolerates', () => {
    db = freshDb();
    ensureFolderNocaseUniqueIndex(db);
    // NOCASE folds ASCII only, so these two insert cleanly past the index —
    // the startup double-check (JS toLowerCase grouping) must catch them.
    insertFolder(db, 'keep', null, 'Ärger', 'Ärger', '2024-01-01T00:00:00.000Z');
    insertFolder(db, 'lose', null, 'ärger', 'ärger', '2024-06-01T00:00:00.000Z');

    ensureFolderNocaseUniqueIndex(db);

    const renamed = db.prepare(`SELECT name, path FROM doc_mount_folders WHERE id = 'lose'`).get();
    expect(renamed).toEqual({ name: 'ärger (2)', path: 'ärger (2)' });
  });

  it('replaces a tampered index that has the right name but the wrong definition', () => {
    db = freshDb();
    // Simulate manual tampering: drop both real indexes, plant a non-unique
    // stand-in under the NOCASE index's name, and insert case-colliding rows.
    db.exec(`DROP INDEX IF EXISTS "idx_doc_mount_folders_mp_parent_name"`);
    db.exec(`CREATE INDEX "${FOLDER_NOCASE_INDEX}" ON "doc_mount_folders" ("mountPointId")`);
    insertFolder(db, 'keep', null, 'Lore', 'Lore', '2024-01-01T00:00:00.000Z');
    insertFolder(db, 'lose', null, 'lore', 'lore', '2024-06-01T00:00:00.000Z');

    ensureFolderNocaseUniqueIndex(db);

    const renamed = db.prepare(`SELECT name FROM doc_mount_folders WHERE id = 'lose'`).get();
    expect(renamed).toEqual({ name: 'lore (2)' });
    // The stand-in was replaced by the genuine unique NOCASE constraint.
    expect(() =>
      insertFolder(db, 'again', null, 'LORE', 'LORE', '2024-07-01T00:00:00.000Z')
    ).toThrow(/UNIQUE/i);
  });
});

describe('ensureLinkNocaseUniqueIndex', () => {
  let db: any;
  afterEach(() => db.close());

  it('renames the newer of two case-colliding links, suffix before the extension', () => {
    db = freshDb();
    insertLink(db, 'old', 'notes/Plan.md', null, '2024-01-01T00:00:00.000Z');
    insertLink(db, 'new', 'notes/plan.md', null, '2024-06-01T00:00:00.000Z');

    ensureLinkNocaseUniqueIndex(db);

    const rows = db.prepare(`SELECT id, relativePath, fileName FROM doc_mount_file_links ORDER BY id DESC`).all();
    expect(rows).toEqual([
      { id: 'old', relativePath: 'notes/Plan.md', fileName: 'Plan.md' },
      { id: 'new', relativePath: 'notes/plan (2).md', fileName: 'plan (2).md' },
    ]);

    expect(indexExists(db, LINK_NOCASE_INDEX)).toBe(true);
    expect(indexExists(db, 'idx_doc_mount_file_links_mp_path')).toBe(false);

    expect(() =>
      insertLink(db, 'again', 'NOTES/PLAN.MD', null, '2024-07-01T00:00:00.000Z')
    ).toThrow(/UNIQUE/i);
  });

  it('repairs non-ASCII case-collisions the ASCII-only NOCASE index tolerates', () => {
    db = freshDb();
    ensureLinkNocaseUniqueIndex(db);
    insertLink(db, 'keep', 'Ärger.md', null, '2024-01-01T00:00:00.000Z');
    insertLink(db, 'lose', 'ärger.md', null, '2024-06-01T00:00:00.000Z');

    ensureLinkNocaseUniqueIndex(db);

    const renamed = db.prepare(`SELECT relativePath, fileName FROM doc_mount_file_links WHERE id = 'lose'`).get();
    expect(renamed).toEqual({ relativePath: 'ärger (2).md', fileName: 'ärger (2).md' });
  });
});

describe('repairMountPointNameCollisions', () => {
  let db: any;
  afterEach(() => db.close());

  it('keeps the oldest name and suffixes the rest, matching case-insensitively and trimmed', () => {
    db = freshDb();
    const ins = db.prepare(`INSERT INTO doc_mount_points (id, name, createdAt) VALUES (?, ?, ?)`);
    ins.run('a', 'My Vault', '2024-01-01T00:00:00.000Z');
    ins.run('b', 'my vault', '2024-02-01T00:00:00.000Z');
    ins.run('c', 'MY VAULT ', '2024-03-01T00:00:00.000Z');
    ins.run('d', 'Other', '2024-01-01T00:00:00.000Z');

    const renamed = repairMountPointNameCollisions(db);
    expect(renamed).toBe(2);

    const names = db.prepare(`SELECT id, name FROM doc_mount_points ORDER BY id`).all();
    expect(names).toEqual([
      { id: 'a', name: 'My Vault' },
      { id: 'b', name: 'my vault (2)' },
      { id: 'c', name: 'MY VAULT (3)' },
      { id: 'd', name: 'Other' },
    ]);

    // Second pass is a no-op.
    expect(repairMountPointNameCollisions(db)).toBe(0);
  });
});

describe('nextUniqueMountPointName (case-insensitive)', () => {
  it('treats a case-variant of a taken name as taken', () => {
    expect(nextUniqueMountPointName(new Set(['Lore']), 'lore')).toBe('lore (2)');
    expect(nextUniqueMountPointName(new Set(['Lore', 'LORE (2)']), 'lore')).toBe('lore (3)');
    expect(nextUniqueMountPointName(new Set(['Other']), 'Lore')).toBe('Lore');
  });
});
