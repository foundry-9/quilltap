/**
 * Regression tests for the SHA-256 image deduplication flow in lib/images-v2.ts.
 *
 * The hash itself comes from `sha256OfBuffer` (`lib/utils/sha256`); this file covers
 * the *dedup decision* that consumes the hash inside createFile() — the part the
 * earlier post-4.5.1 sha256 work hardened but that had no functional coverage:
 *
 *   - identical bytes → same hash → existing entry returned (no new file)
 *   - existing entry + new linkedTo → entry's linkedTo merged via update()
 *   - existing entry but bytes missing from storage → orphan metadata deleted,
 *     fresh file created
 *   - no existing entry → fresh file created
 *
 * Exercised through ingestImageBuffer(), the thinnest public entry into
 * createFile() (raw Buffer in, no File/fetch needed).
 *
 * getRepositories, fileStorageManager, writeUserUploadToMountStore, and the tag
 * helpers are already globally mocked in jest.setup.ts; we configure them per
 * test via jest.mocked() rather than redefining them (a per-file jest.mock for
 * those modules would lose to the setup mock).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// --- sharp: dimension probing is incidental here; return fixed metadata. ----
// (Not mocked in jest.setup, so a per-file mock is required.)
const mockMetadata = jest.fn(async () => ({ width: 64, height: 64 }));
const mockSharp = jest.fn(() => ({ metadata: mockMetadata }));
(mockSharp as any).default = mockSharp;
jest.mock('sharp', () => mockSharp);

// --- webp conversion: pass through unchanged so the test buffer's hash is stable.
// (Not mocked in jest.setup.)
jest.mock('@/lib/files/webp-conversion', () => ({
  convertToWebP: jest.fn(async (buffer: Buffer, mimeType: string, filename: string) => ({
    wasConverted: false,
    buffer,
    mimeType,
    filename,
  })),
}));

import { ingestImageBuffer } from '@/lib/images-v2';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';

const USER = '22222222-2222-4222-8222-222222222222';

// Per-test file repository spies.
const findBySha256 = jest.fn();
const update = jest.fn();
const del = jest.fn();
const create = jest.fn();

const fileExists = fileStorageManager.fileExists as jest.Mock;

function makeExisting(overrides: Record<string, unknown> = {}) {
  return {
    id: 'existing-file-id',
    originalFilename: 'existing.webp',
    mimeType: 'image/webp',
    size: 1234,
    sha256: 'placeholder', // replaced per-test with the real hash
    linkedTo: [] as string[],
    width: 64,
    height: 64,
    storageKey: 'uploads/images/existing.webp',
    ...overrides,
  };
}

function makeCreated(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fresh-file-id',
    originalFilename: 'fresh.webp',
    mimeType: 'image/webp',
    size: 1234,
    sha256: 'fresh-sha',
    linkedTo: [] as string[],
    width: 64,
    height: 64,
    storageKey: 'uploads/images/new.webp',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findBySha256.mockReset();
  update.mockReset();
  del.mockReset();
  create.mockReset();
  (getRepositories as jest.Mock).mockReturnValue({
    files: { findBySha256, update, delete: del, create },
  } as any);
  fileExists.mockResolvedValue(true);
});

describe('images-v2 dedup flow (ingestImageBuffer → createFile)', () => {
  it('returns the existing entry when an identical hash is already stored and bytes exist', async () => {
    const buffer = Buffer.from('the same image bytes');
    const sha = sha256OfBuffer(buffer);
    const existing = makeExisting({ sha256: sha, linkedTo: ['char-a'] });

    findBySha256.mockResolvedValue([existing]);
    fileExists.mockResolvedValue(true);

    const result = await ingestImageBuffer({
      buffer,
      originalFilename: 'dup.png',
      mimeType: 'image/png',
      userId: USER,
      linkedTo: ['char-a'], // no NEW link
    });

    // Dedup keyed on the content hash.
    expect(findBySha256).toHaveBeenCalledWith(sha);
    expect(result).toBe(existing);
    // No fresh file written, no metadata changed.
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('merges linkedTo onto the existing entry when a new link is supplied', async () => {
    const buffer = Buffer.from('shared portrait');
    const sha = sha256OfBuffer(buffer);
    const existing = makeExisting({ sha256: sha, linkedTo: ['char-a'] });
    const updated = makeExisting({ sha256: sha, linkedTo: ['char-a', 'char-b'] });

    findBySha256.mockResolvedValue([existing]);
    fileExists.mockResolvedValue(true);
    update.mockResolvedValue(updated);

    const result = await ingestImageBuffer({
      buffer,
      originalFilename: 'shared.png',
      mimeType: 'image/png',
      userId: USER,
      linkedTo: ['char-b'], // a NEW link
    });

    expect(update).toHaveBeenCalledTimes(1);
    const [calledId, patch] = update.mock.calls[0] as [string, { linkedTo: string[] }];
    expect(calledId).toBe('existing-file-id');
    expect([...patch.linkedTo].sort()).toEqual(['char-a', 'char-b']);
    expect(result).toBe(updated);
    expect(create).not.toHaveBeenCalled();
  });

  it('deletes orphaned metadata and creates a fresh file when the stored bytes are missing', async () => {
    const buffer = Buffer.from('orphan recovery bytes');
    const sha = sha256OfBuffer(buffer);
    const existing = makeExisting({ sha256: sha });
    const created = makeCreated({ sha256: sha });

    findBySha256.mockResolvedValue([existing]);
    fileExists.mockResolvedValue(false); // bytes gone
    create.mockResolvedValue(created);

    const result = await ingestImageBuffer({
      buffer,
      originalFilename: 'orphan.png',
      mimeType: 'image/png',
      userId: USER,
    });

    expect(del).toHaveBeenCalledWith('existing-file-id');
    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toBe(created);
  });

  it('creates a fresh file when no duplicate hash is found', async () => {
    const buffer = Buffer.from('brand new image');
    const sha = sha256OfBuffer(buffer);
    const created = makeCreated({ sha256: sha });

    findBySha256.mockResolvedValue([]);
    create.mockResolvedValue(created);

    const result = await ingestImageBuffer({
      buffer,
      originalFilename: 'new.png',
      mimeType: 'image/png',
      userId: USER,
    });

    expect(findBySha256).toHaveBeenCalledWith(sha);
    expect(del).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    // The hash persisted to metadata is the content hash.
    const createArg = create.mock.calls[0][0] as { sha256: string };
    expect(createArg.sha256).toBe(sha);
    expect(result).toBe(created);
  });

  it('keys dedup on content: different bytes probe a different hash', async () => {
    findBySha256.mockResolvedValue([]);
    create.mockResolvedValue(makeCreated());

    await ingestImageBuffer({
      buffer: Buffer.from('image one'),
      originalFilename: 'a.png',
      mimeType: 'image/png',
      userId: USER,
    });
    await ingestImageBuffer({
      buffer: Buffer.from('image two'),
      originalFilename: 'b.png',
      mimeType: 'image/png',
      userId: USER,
    });

    const firstSha = findBySha256.mock.calls[0][0];
    const secondSha = findBySha256.mock.calls[1][0];
    expect(firstSha).not.toBe(secondSha);
  });
});
