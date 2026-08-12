import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(function () {
      return this;
    }),
  },
}));

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: {
    deleteFile: jest.fn(),
  },
}));

jest.mock('@/lib/files/get-file-associations', () => ({
  getFileAssociations: jest.fn(),
}));

const mockFindAllRaw = jest.fn();

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(() => ({
    characters: { findAllRaw: mockFindAllRaw },
  })),
}));

describe('files item delete action', () => {
  let handleDeleteFile: typeof import('@/app/api/v1/files/[id]/actions/delete').handleDeleteFile;
  let ctx: any;

  function makeRequest(url = 'https://localhost:3000/api/v1/files/file-1'): NextRequest {
    return { nextUrl: new URL(url) } as unknown as NextRequest;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindAllRaw.mockResolvedValue([] as never);

    ctx = {
      user: { id: 'user-1' },
      repos: {
        files: {
          findById: jest.fn().mockResolvedValue({
            id: 'file-1',
            userId: 'other-user',
            mimeType: 'text/plain',
            linkedTo: [],
            storageKey: null,
          }),
          delete: jest.fn().mockResolvedValue(true),
        },
      },
    };

    jest.isolateModules(() => {
      handleDeleteFile = require('@/app/api/v1/files/[id]/actions/delete').handleDeleteFile;
    });
  });

  it('forbids deletion of files owned by another user', async () => {
    const response = await handleDeleteFile(makeRequest(), ctx, 'file-1');
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  describe('held archive bundles (character-archive spec §4.2a)', () => {
    function setArchiveFile() {
      ctx.repos.files.findById.mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
        mimeType: 'application/octet-stream',
        category: 'ARCHIVE',
        linkedTo: [],
        storageKey: null,
      });
    }

    it('refuses to delete a bundle an archived character still points at', async () => {
      setArchiveFile();
      mockFindAllRaw.mockResolvedValue([
        { id: 'char-1', name: 'Ghost', archivedAt: '2026-08-01T00:00:00Z', archiveFileId: 'file-1' },
      ] as never);

      const response = await handleDeleteFile(makeRequest(), ctx, 'file-1');
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.details.code).toBe('ARCHIVE_BUNDLE_HELD');
      expect(ctx.repos.files.delete).not.toHaveBeenCalled();
    });

    it('deletes a loose bundle no character references', async () => {
      setArchiveFile();
      mockFindAllRaw.mockResolvedValue([
        { id: 'char-1', name: 'Ghost', archiveFileId: 'some-other-file' },
      ] as never);

      const response = await handleDeleteFile(makeRequest(), ctx, 'file-1');

      expect(response.status).toBe(200);
      expect(ctx.repos.files.delete).toHaveBeenCalledWith('file-1');
    });

    it('force=true overrides the hold', async () => {
      setArchiveFile();
      mockFindAllRaw.mockResolvedValue([
        { id: 'char-1', name: 'Ghost', archiveFileId: 'file-1' },
      ] as never);

      const response = await handleDeleteFile(
        makeRequest('https://localhost:3000/api/v1/files/file-1?force=true'),
        ctx,
        'file-1'
      );

      expect(response.status).toBe(200);
      expect(ctx.repos.files.delete).toHaveBeenCalledWith('file-1');
    });
  });
});