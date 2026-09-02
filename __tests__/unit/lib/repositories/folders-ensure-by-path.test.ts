/**
 * Regression tests for `FoldersRepository.ensureByPath` — the find-or-create
 * chokepoint that closed bug 114.
 *
 * Every folder writer used to hand-roll `findByPath` -> `create`. That guard is
 * not atomic, so two concurrent background-job image generations into the same
 * project both read "absent" and both inserted, and the legacy `folders` table
 * grew a row per generated image. `ensureByPath` plus the
 * (userId, COALESCE(projectId, ''), path) unique index makes the loser of that
 * race resolve to the winning row instead of adding to the pile.
 *
 * Verified without a real database by spying on `findByPath` and `create` on a
 * real repository instance (DB access is intercepted before it is reached).
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock the logger to suppress output in tests
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the database manager — prevents any real DB access
jest.mock('@/lib/database/manager', () => ({
  getDatabaseAsync: jest.fn().mockResolvedValue({
    getCollection: jest.fn().mockReturnValue({
      findMany: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockResolvedValue(null),
      deleteOne: jest.fn().mockResolvedValue(false),
      count: jest.fn().mockResolvedValue(0),
    }),
  }),
  ensureCollection: jest.fn().mockResolvedValue(undefined),
}));

import { FoldersRepository } from '@/lib/database/repositories/folders.repository';
import type { Folder } from '@/lib/schemas/types';

const USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const PROJECT_ID = 'f29e2112-e609-48c1-977c-8843c0f1be0f';

function makeFolder(id: string, overrides: Partial<Folder> = {}): Folder {
  return {
    id,
    userId: USER_ID,
    path: '/story-backgrounds/',
    name: 'story-backgrounds',
    parentFolderId: null,
    projectId: PROJECT_ID,
    createdAt: '2026-02-11T21:38:02.655Z',
    updatedAt: '2026-02-11T21:38:02.655Z',
    ...overrides,
  } as Folder;
}

const INPUT = {
  userId: USER_ID,
  path: '/story-backgrounds/',
  name: 'story-backgrounds',
  parentFolderId: null,
  projectId: PROJECT_ID,
};

function uniqueConstraintError(): Error {
  return Object.assign(
    new Error('UNIQUE constraint failed: folders.userId, folders.path'),
    { code: 'SQLITE_CONSTRAINT_UNIQUE' }
  );
}

describe('FoldersRepository.ensureByPath', () => {
  let repo: FoldersRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new FoldersRepository();
  });

  it('returns the existing folder without inserting a second row', async () => {
    const existing = makeFolder('existing-id');
    const findByPath = jest.spyOn(repo, 'findByPath').mockResolvedValue(existing);
    const create = jest.spyOn(repo, 'create');

    const result = await repo.ensureByPath(INPUT);

    expect(result).toBe(existing);
    expect(create).not.toHaveBeenCalled();
    expect(findByPath).toHaveBeenCalledWith(USER_ID, '/story-backgrounds/', PROJECT_ID);
  });

  it('creates the folder when the path is genuinely absent', async () => {
    const created = makeFolder('new-id');
    jest.spyOn(repo, 'findByPath').mockResolvedValue(null);
    const create = jest.spyOn(repo, 'create').mockResolvedValue(created);

    const result = await repo.ensureByPath(INPUT);

    expect(result).toBe(created);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ path: '/story-backgrounds/' }));
  });

  it('normalizes an undefined projectId to null on both the read and the write', async () => {
    const created = makeFolder('general-id', { projectId: null });
    const findByPath = jest.spyOn(repo, 'findByPath').mockResolvedValue(null);
    const create = jest.spyOn(repo, 'create').mockResolvedValue(created);

    await repo.ensureByPath({ userId: USER_ID, path: '/reports/', name: 'reports' });

    expect(findByPath).toHaveBeenCalledWith(USER_ID, '/reports/', null);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }));
  });

  it('resolves to the winning row when a concurrent create won the race', async () => {
    const winner = makeFolder('winner-id');
    const findByPath = jest
      .spyOn(repo, 'findByPath')
      .mockResolvedValueOnce(null) // pre-insert check: not there yet
      .mockResolvedValueOnce(winner); // post-conflict: the other writer committed
    jest.spyOn(repo, 'create').mockRejectedValue(uniqueConstraintError());

    const result = await repo.ensureByPath(INPUT);

    expect(result).toBe(winner);
    expect(findByPath).toHaveBeenCalledTimes(2);
  });

  it('rethrows a unique conflict that cannot be reconciled to a row', async () => {
    jest.spyOn(repo, 'findByPath').mockResolvedValue(null);
    jest.spyOn(repo, 'create').mockRejectedValue(uniqueConstraintError());

    await expect(repo.ensureByPath(INPUT)).rejects.toThrow('UNIQUE constraint failed');
  });

  it('rethrows a non-constraint create failure instead of swallowing it', async () => {
    jest.spyOn(repo, 'findByPath').mockResolvedValue(null);
    jest.spyOn(repo, 'create').mockRejectedValue(new Error('disk full'));

    await expect(repo.ensureByPath(INPUT)).rejects.toThrow('disk full');
    expect(repo.findByPath).toHaveBeenCalledTimes(1);
  });
});
