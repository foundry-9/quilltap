/**
 * @jest-environment node
 *
 * End-to-end exercise of the `collapse-duplicate-folders-v1` migration against
 * a real in-memory SQLite database (bug 114). The migration collapses each
 * (userId, COALESCE(projectId, ''), path) group down to its oldest row,
 * repoints any `parentFolderId` that named a discarded row, and then creates
 * the unique index that makes the duplication impossible to repeat.
 *
 * Guards:
 *   - migrations/scripts/collapse-duplicate-folders.ts
 *   - the matching index in migrations/scripts/sqlite-initial-schema.ts
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

jest.mock('../../../migrations/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../migrations/lib/progress', () => ({
  reportProgress: jest.fn(),
}));

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: jest.fn(() => true),
  sqliteTableExists: jest.fn(() => true),
  getSQLiteDatabase: jest.fn(() => (global as Record<string, unknown>).__testDb),
}));

import { collapseDuplicateFoldersMigration } from '../../../migrations/scripts/collapse-duplicate-folders';
import { reportProgress } from '../../../migrations/lib/progress';

// Root package.json aliases better-sqlite3-multiple-ciphers as better-sqlite3,
// and the jest moduleNameMapper replaces both bare names with a no-op mock.
// Require the real binding by absolute path (which the mapper's `^name$`
// patterns don't match) so this suite exercises actual SQL.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const USER = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const PROJECT_A = 'project-a';
const PROJECT_B = 'project-b';

interface SeedFolder {
  id: string;
  projectId: string | null;
  path: string;
  parentFolderId?: string | null;
  createdAt: string;
}

let db: any;

function freshDb(seed: SeedFolder[]) {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "folders" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "path" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "parentFolderId" TEXT,
      "projectId" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
  `);

  const insert = db.prepare(
    'INSERT INTO folders (id, userId, path, name, parentFolderId, projectId, createdAt, updatedAt) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const row of seed) {
    const name = row.path.replace(/\/$/, '').split('/').pop() || 'Root';
    insert.run(
      row.id,
      USER,
      row.path,
      name,
      row.parentFolderId ?? null,
      row.projectId,
      row.createdAt,
      row.createdAt
    );
  }

  (global as Record<string, unknown>).__testDb = db;
}

function allFolders(): Array<{ id: string; path: string; projectId: string | null; parentFolderId: string | null }> {
  return db.prepare('SELECT id, path, projectId, parentFolderId FROM folders ORDER BY id').all();
}

afterEach(() => {
  db?.close();
  delete (global as Record<string, unknown>).__testDb;
  jest.clearAllMocks();
});

describe('collapse-duplicate-folders-v1', () => {
  it('keeps the oldest row of each (user, project, path) group and drops the rest', async () => {
    freshDb([
      // The shape the image pipelines produced: one row per generated image.
      { id: 'bg-1', projectId: PROJECT_A, path: '/story-backgrounds/', createdAt: '2026-02-11T21:38:02.655Z' },
      { id: 'bg-2', projectId: PROJECT_A, path: '/story-backgrounds/', createdAt: '2026-02-15T21:29:07.421Z' },
      { id: 'bg-3', projectId: PROJECT_A, path: '/story-backgrounds/', createdAt: '2026-02-16T19:08:12.458Z' },
      // Same path, different project — a distinct folder, must survive.
      { id: 'bg-b', projectId: PROJECT_B, path: '/story-backgrounds/', createdAt: '2026-02-13T16:15:44.574Z' },
      // Hand-created folder, only ever written once.
      { id: 'gary', projectId: PROJECT_A, path: '/Gary/', createdAt: '2026-03-02T10:00:00.000Z' },
    ]);

    const result = await collapseDuplicateFoldersMigration.run();

    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(2);
    expect(allFolders().map((f) => f.id)).toEqual(['bg-1', 'bg-b', 'gary']);
  });

  it('treats a null projectId as a single group rather than all-distinct', async () => {
    freshDb([
      { id: 'gen-1', projectId: null, path: '/reports/', createdAt: '2026-02-11T00:00:00.000Z' },
      { id: 'gen-2', projectId: null, path: '/reports/', createdAt: '2026-02-12T00:00:00.000Z' },
      { id: 'gen-3', projectId: null, path: '/reports/', createdAt: '2026-02-13T00:00:00.000Z' },
    ]);

    const result = await collapseDuplicateFoldersMigration.run();

    expect(result.success).toBe(true);
    expect(allFolders().map((f) => f.id)).toEqual(['gen-1']);
  });

  it('repoints a child whose parent was discarded before deleting it', async () => {
    freshDb([
      { id: 'parent-keep', projectId: PROJECT_A, path: '/docs/', createdAt: '2026-02-11T00:00:00.000Z' },
      { id: 'parent-dupe', projectId: PROJECT_A, path: '/docs/', createdAt: '2026-02-12T00:00:00.000Z' },
      {
        id: 'child',
        projectId: PROJECT_A,
        path: '/docs/reports/',
        parentFolderId: 'parent-dupe',
        createdAt: '2026-02-13T00:00:00.000Z',
      },
    ]);

    const result = await collapseDuplicateFoldersMigration.run();

    expect(result.success).toBe(true);
    const child = allFolders().find((f) => f.id === 'child');
    expect(child?.parentFolderId).toBe('parent-keep');
    expect(allFolders().map((f) => f.id)).toEqual(['child', 'parent-keep']);
  });

  it('creates the unique index, which then rejects a duplicate insert', async () => {
    freshDb([
      { id: 'bg-1', projectId: PROJECT_A, path: '/story-backgrounds/', createdAt: '2026-02-11T00:00:00.000Z' },
      { id: 'bg-2', projectId: PROJECT_A, path: '/story-backgrounds/', createdAt: '2026-02-12T00:00:00.000Z' },
      { id: 'gen-1', projectId: null, path: '/reports/', createdAt: '2026-02-11T00:00:00.000Z' },
    ]);

    await collapseDuplicateFoldersMigration.run();

    expect(await collapseDuplicateFoldersMigration.shouldRun()).toBe(false);

    const insert = db.prepare(
      'INSERT INTO folders (id, userId, path, name, parentFolderId, projectId, createdAt, updatedAt) ' +
        "VALUES (?, ?, ?, ?, NULL, ?, '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')"
    );

    expect(() =>
      insert.run('bg-3', USER, '/story-backgrounds/', 'story-backgrounds', PROJECT_A)
    ).toThrow(/UNIQUE constraint failed/);

    // NULL projectId is coalesced, so "no project" is one value, not many.
    expect(() => insert.run('gen-2', USER, '/reports/', 'reports', null)).toThrow(
      /UNIQUE constraint failed/
    );

    // A different project keeps its own row for the same path.
    expect(() =>
      insert.run('bg-b', USER, '/story-backgrounds/', 'story-backgrounds', PROJECT_B)
    ).not.toThrow();
  });

  it('reports progress while scanning so the loading screen can move', async () => {
    freshDb([
      { id: 'bg-1', projectId: PROJECT_A, path: '/story-backgrounds/', createdAt: '2026-02-11T00:00:00.000Z' },
      { id: 'bg-2', projectId: PROJECT_A, path: '/story-backgrounds/', createdAt: '2026-02-12T00:00:00.000Z' },
    ]);

    await collapseDuplicateFoldersMigration.run();

    expect(reportProgress).toHaveBeenCalledWith(1, 2, 'folders');
    expect(reportProgress).toHaveBeenCalledWith(1, 1, 'duplicate folders');
  });

  it('is a no-op on a second run', async () => {
    freshDb([
      { id: 'bg-1', projectId: PROJECT_A, path: '/story-backgrounds/', createdAt: '2026-02-11T00:00:00.000Z' },
      { id: 'bg-2', projectId: PROJECT_A, path: '/story-backgrounds/', createdAt: '2026-02-12T00:00:00.000Z' },
    ]);

    await collapseDuplicateFoldersMigration.run();
    const second = await collapseDuplicateFoldersMigration.run();

    expect(second.success).toBe(true);
    expect(second.itemsAffected).toBe(0);
    expect(allFolders().map((f) => f.id)).toEqual(['bg-1']);
  });
});
