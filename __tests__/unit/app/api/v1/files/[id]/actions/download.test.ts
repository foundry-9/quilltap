/**
 * Bug 55 — a `files` row that outlived its bytes must answer 404, not 500.
 *
 * A dangling avatar (mount point deleted, blob gone) is permanent: 500 invites
 * a retry that can never succeed and reads as a server fault in the logs.
 */
import { NextRequest } from 'next/server';
import { FileContentMissingError } from '@/lib/file-storage/errors';

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
    downloadFile: jest.fn(),
  },
}));

describe('files item download action', () => {
  let handleDownloadFile: typeof import('@/app/api/v1/files/[id]/actions/download').handleDownloadFile;
  let fileStorageManager: { downloadFile: jest.Mock };
  let ctx: any;

  const fileEntry = {
    id: 'file-1',
    originalFilename: 'librarian-avatar.webp',
    mimeType: 'image/webp',
    storageKey: 'mount-blob:mount-gone:blob-gone',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    ({ handleDownloadFile } = require('@/app/api/v1/files/[id]/actions/download'));
    ({ fileStorageManager } = require('@/lib/file-storage/manager'));
    ctx = {
      repos: { files: { findById: jest.fn().mockResolvedValue(fileEntry) } },
      request: { nextUrl: new URL('https://localhost:3000/api/v1/files/file-1') } as NextRequest,
    };
  });

  it('returns 404 when the row has no stored content', async () => {
    fileStorageManager.downloadFile.mockRejectedValue(
      new FileContentMissingError('mount-blob:mount-gone:blob-gone')
    );

    const response = await handleDownloadFile(ctx, 'file-1');

    expect(response.status).toBe(404);
  });

  it('still returns 500 when the read fails for any other reason', async () => {
    fileStorageManager.downloadFile.mockRejectedValue(new Error('EACCES: permission denied'));

    const response = await handleDownloadFile(ctx, 'file-1');

    expect(response.status).toBe(500);
  });

  it('returns 404 when the file row itself is absent', async () => {
    ctx.repos.files.findById.mockResolvedValue(null);

    const response = await handleDownloadFile(ctx, 'file-1');

    expect(response.status).toBe(404);
    expect(fileStorageManager.downloadFile).not.toHaveBeenCalled();
  });

  it('serves the bytes when the content is there', async () => {
    fileStorageManager.downloadFile.mockResolvedValue(Buffer.from('webp-bytes'));

    const response = await handleDownloadFile(ctx, 'file-1');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
  });
});
