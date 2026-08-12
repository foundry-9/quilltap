/**
 * @jest-environment node
 *
 * Bug 43 — orphaned-thumbnail sweep.
 *
 * `_thumbnails/{fileId}_{size}.webp` is a derived cache that only ever grew:
 * nothing reaped a thumbnail whose source file left by a route other than an
 * in-app delete (restore, delete-all, out-of-app edit). The sweep deletes every
 * cache entry whose source `files` row is gone, skips (never deletes) names that
 * don't match the canonical shape, and leaves live thumbnails alone.
 */

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: {
    listRaw: jest.fn(),
    deleteRaw: jest.fn(async () => {}),
  },
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/logger', () => {
  const l = { child: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  l.child.mockReturnValue(l);
  return { logger: l };
});

import { sweepOrphanedThumbnails } from '@/lib/background-jobs/maintenance/sweep-orphaned-thumbnails';

const { fileStorageManager } = jest.requireMock('@/lib/file-storage/manager') as {
  fileStorageManager: { listRaw: jest.Mock; deleteRaw: jest.Mock };
};
const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock;
};

const LIVE = '11111111-1111-4111-8111-111111111111';
const ORPHAN = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sweepOrphanedThumbnails', () => {
  it('deletes only the orphan, keeps live thumbnails, and skips garbage names', async () => {
    fileStorageManager.listRaw.mockResolvedValue([
      `_thumbnails/${LIVE}_150.webp`,
      `_thumbnails/${LIVE}_300.webp`,
      `_thumbnails/${ORPHAN}_150.webp`,
      `_thumbnails/not-a-uuid.webp`,
    ]);
    // Only the LIVE file row still exists.
    getRepositories.mockReturnValue({
      files: { findByIds: jest.fn(async () => [{ id: LIVE }]) },
    });

    const result = await sweepOrphanedThumbnails();

    expect(result).toEqual({ scanned: 4, deleted: 1, unparseable: 1 });
    expect(fileStorageManager.deleteRaw).toHaveBeenCalledTimes(1);
    expect(fileStorageManager.deleteRaw).toHaveBeenCalledWith(`_thumbnails/${ORPHAN}_150.webp`);
  });

  it('does nothing on an empty cache', async () => {
    fileStorageManager.listRaw.mockResolvedValue([]);
    getRepositories.mockReturnValue({ files: { findByIds: jest.fn() } });

    const result = await sweepOrphanedThumbnails();

    expect(result).toEqual({ scanned: 0, deleted: 0, unparseable: 0 });
    expect(fileStorageManager.deleteRaw).not.toHaveBeenCalled();
  });

  it('queries the DB once for the batch of unique fileIds', async () => {
    fileStorageManager.listRaw.mockResolvedValue([
      `_thumbnails/${LIVE}_150.webp`,
      `_thumbnails/${LIVE}_300.webp`,
      `_thumbnails/${ORPHAN}_150.webp`,
    ]);
    const findByIds = jest.fn(async () => [{ id: LIVE }]);
    getRepositories.mockReturnValue({ files: { findByIds } });

    await sweepOrphanedThumbnails();

    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(findByIds).toHaveBeenCalledWith(expect.arrayContaining([LIVE, ORPHAN]));
    expect((findByIds.mock.calls[0][0] as string[]).length).toBe(2);
  });

  it('keeps sweeping when one delete throws', async () => {
    const ORPHAN2 = '33333333-3333-4333-8333-333333333333';
    fileStorageManager.listRaw.mockResolvedValue([
      `_thumbnails/${ORPHAN}_150.webp`,
      `_thumbnails/${ORPHAN2}_150.webp`,
    ]);
    getRepositories.mockReturnValue({ files: { findByIds: jest.fn(async () => []) } });
    fileStorageManager.deleteRaw
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValueOnce(undefined);

    const result = await sweepOrphanedThumbnails();

    expect(fileStorageManager.deleteRaw).toHaveBeenCalledTimes(2);
    expect(result.deleted).toBe(1); // the one that didn't throw
  });
});
