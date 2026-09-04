/**
 * `readDatabaseDocumentIfExists` / `deleteDatabaseDocumentIfExists` — the
 * null/throw split.
 *
 * Only a genuinely absent document (`NOT_FOUND`) collapses to `null` / `false`;
 * every other failure must surface untouched, so callers that seed defaults on
 * "absent" can never mistake a failed read for an empty store.
 *
 * Strategy: mock getRepositories() to control document/link state; no real
 * database.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/mount-index/db-store-events', () => ({
  emitDocumentWritten: jest.fn(),
  emitDocumentDeleted: jest.fn(),
  emitDocumentMoved: jest.fn(),
}));

jest.mock('@/lib/doc-edit/reindex-file', () => ({
  reindexSingleFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/repositories/factory');
const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

import {
  readDatabaseDocumentIfExists,
  deleteDatabaseDocumentIfExists,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';

const MOUNT = 'mp-1';
const PATH = 'Notes/ledger.md';

const findDocument = jest.fn();
const findLink = jest.fn();
const deleteWithGC = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  getRepositoriesMock.mockReturnValue({
    docMountDocuments: { findByMountPointAndPath: findDocument },
    docMountFileLinks: { findByMountPointAndPath: findLink, deleteWithGC },
  });
});

describe('readDatabaseDocumentIfExists', () => {
  it('returns the content when the document exists', async () => {
    findDocument.mockResolvedValue({ content: '# Ledger', lastModified: '2026-01-01T00:00:00.000Z' });
    await expect(readDatabaseDocumentIfExists(MOUNT, PATH)).resolves.toBe('# Ledger');
    expect(findDocument).toHaveBeenCalledWith(MOUNT, PATH);
  });

  it('returns null only when the document is absent (NOT_FOUND)', async () => {
    findDocument.mockResolvedValue(null);
    await expect(readDatabaseDocumentIfExists(MOUNT, PATH)).resolves.toBeNull();
  });

  it('rethrows every other failure untouched', async () => {
    const failure = new Error('index locked');
    findDocument.mockRejectedValue(failure);
    await expect(readDatabaseDocumentIfExists(MOUNT, PATH)).rejects.toBe(failure);
  });

  it('rethrows a DatabaseStoreError with a non-NOT_FOUND code', async () => {
    findDocument.mockRejectedValue(new DatabaseStoreError('bad path', 'INVALID'));
    await expect(readDatabaseDocumentIfExists(MOUNT, PATH)).rejects.toMatchObject({ code: 'INVALID' });
  });
});

describe('deleteDatabaseDocumentIfExists', () => {
  it('returns true when a document was removed', async () => {
    findLink.mockResolvedValue({ id: 'link-1' });
    deleteWithGC.mockResolvedValue({ fileId: 'file-1', fileGC: true });
    await expect(deleteDatabaseDocumentIfExists(MOUNT, PATH)).resolves.toBe(true);
    expect(deleteWithGC).toHaveBeenCalledWith('link-1');
  });

  it('returns false when there is nothing at the path', async () => {
    findLink.mockResolvedValue(null);
    await expect(deleteDatabaseDocumentIfExists(MOUNT, PATH)).resolves.toBe(false);
    expect(deleteWithGC).not.toHaveBeenCalled();
  });

  it('treats a NOT_FOUND thrown mid-delete as absent', async () => {
    findLink.mockResolvedValue({ id: 'link-1' });
    deleteWithGC.mockRejectedValue(new DatabaseStoreError('gone', 'NOT_FOUND'));
    await expect(deleteDatabaseDocumentIfExists(MOUNT, PATH)).resolves.toBe(false);
  });

  it('rethrows every other failure untouched', async () => {
    const failure = new Error('index locked');
    findLink.mockResolvedValue({ id: 'link-1' });
    deleteWithGC.mockRejectedValue(failure);
    await expect(deleteDatabaseDocumentIfExists(MOUNT, PATH)).rejects.toBe(failure);
  });
});
