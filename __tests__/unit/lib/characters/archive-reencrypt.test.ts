/**
 * @jest-environment node
 *
 * Passphrase-change re-encryption of archive bundles (§4.2c). Uses the real
 * crypto module so the sweep is proven against actual bundles, with mocked
 * repositories and file storage.
 */

import { describe, expect, it, beforeEach } from '@jest/globals';

const mockFindByCategory = jest.fn();
const mockFilesUpdate = jest.fn();
const mockDownloadFile = jest.fn();
const mockUploadRaw = jest.fn();

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    files: { findByCategory: mockFindByCategory, update: mockFilesUpdate },
  }),
}));

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: {
    // Deferred through arrows so the hoisted factory doesn't hit the consts
    // before initialization.
    downloadFile: (...args: unknown[]) => mockDownloadFile(...(args as [never])),
    uploadRaw: (...args: unknown[]) => mockUploadRaw(...(args as [never])),
  },
}));

jest.mock('@/lib/startup/dbkey', () => ({
  INTERNAL_PASSPHRASE: '__quilltap_no_passphrase__',
  getHasUserPassphrase: jest.fn(() => false),
}));

import { reencryptArchiveBundles } from '@/lib/characters/archive-reencrypt';
import { encryptArchive, decryptArchive } from '@/lib/characters/archive-crypto';

const OLD = 'old-passphrase';
const NEW = 'new-passphrase';

interface FixtureFile {
  id: string;
  originalFilename: string;
  storageKey: string | null;
  mimeType: string;
  bytes: Buffer;
}

let store: Map<string, Buffer>;

function installFixtures(files: FixtureFile[]) {
  store = new Map(files.filter((f) => f.storageKey).map((f) => [f.storageKey!, f.bytes]));
  mockFindByCategory.mockResolvedValue(
    files.map(({ bytes: _bytes, ...row }) => row) as never
  );
  mockDownloadFile.mockImplementation((file: { storageKey: string }) => {
    const bytes = store.get(file.storageKey);
    if (!bytes) return Promise.reject(new Error('no bytes at storageKey'));
    return Promise.resolve(bytes);
  });
  mockUploadRaw.mockImplementation(({ storageKey, content }: { storageKey: string; content: Buffer }) => {
    store.set(storageKey, content);
    return Promise.resolve();
  });
  mockFilesUpdate.mockResolvedValue({} as never);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reencryptArchiveBundles', () => {
  it('rewrites every bundle — including pre-encryption plaintext ones — under the new passphrase', async () => {
    const contentA = Buffer.from('bundle A ndjson');
    const contentB = Buffer.from('bundle B ndjson');
    const contentLegacy = Buffer.from('{"kind":"manifest"}\n');
    installFixtures([
      { id: 'f-a', originalFilename: 'a.qtap', storageKey: 'f-a/a.qtap', mimeType: 'application/octet-stream', bytes: encryptArchive(contentA, OLD) },
      { id: 'f-b', originalFilename: 'b.qtap', storageKey: 'f-b/b.qtap', mimeType: 'application/octet-stream', bytes: encryptArchive(contentB, OLD) },
      // A bundle written before archive encryption existed: plaintext NDJSON.
      { id: 'f-legacy', originalFilename: 'legacy.qtap', storageKey: 'f-legacy/legacy.qtap', mimeType: 'application/octet-stream', bytes: contentLegacy },
    ]);

    const result = await reencryptArchiveBundles(OLD, NEW);

    expect(result).toMatchObject({ total: 3, reencrypted: 3, failures: [] });
    expect(decryptArchive(store.get('f-a/a.qtap')!, NEW).equals(contentA)).toBe(true);
    expect(decryptArchive(store.get('f-b/b.qtap')!, NEW).equals(contentB)).toBe(true);
    expect(decryptArchive(store.get('f-legacy/legacy.qtap')!, NEW).equals(contentLegacy)).toBe(true);
    // The old passphrase no longer opens anything.
    expect(() => decryptArchive(store.get('f-a/a.qtap')!, OLD)).toThrow(/predates/);
    // Row sizes track the rewritten bytes.
    expect(mockFilesUpdate).toHaveBeenCalledWith('f-a', { size: store.get('f-a/a.qtap')!.length });
  });

  it('names the bundles left behind and keeps sweeping past them', async () => {
    const good = Buffer.from('good bundle');
    installFixtures([
      // Sealed under some third passphrase — an earlier change that failed
      // partway. It must be *named*, not silently skipped.
      { id: 'f-stale', originalFilename: 'stale.qtap', storageKey: 'f-stale/stale.qtap', mimeType: 'application/octet-stream', bytes: encryptArchive(Buffer.from('stale'), 'even-older-passphrase') },
      { id: 'f-nokey', originalFilename: 'nokey.qtap', storageKey: null, mimeType: 'application/octet-stream', bytes: Buffer.alloc(0) },
      { id: 'f-good', originalFilename: 'good.qtap', storageKey: 'f-good/good.qtap', mimeType: 'application/octet-stream', bytes: encryptArchive(good, OLD) },
    ]);

    const result = await reencryptArchiveBundles(OLD, NEW);

    expect(result.total).toBe(3);
    expect(result.reencrypted).toBe(1);
    expect(result.failures).toHaveLength(2);
    const staleFailure = result.failures.find((f) => f.fileId === 'f-stale')!;
    expect(staleFailure.filename).toBe('stale.qtap');
    expect(staleFailure.reason).toMatch(/does not open with the old passphrase/);
    // The failure did not abort the sweep: the good bundle was still rewritten.
    expect(decryptArchive(store.get('f-good/good.qtap')!, NEW).equals(good)).toBe(true);
    // The stale bundle is untouched, still under its original passphrase.
    expect(decryptArchive(store.get('f-stale/stale.qtap')!, 'even-older-passphrase').toString()).toBe('stale');
  });

  it('is a quiet no-op on an empty archive library', async () => {
    installFixtures([]);

    const result = await reencryptArchiveBundles(OLD, NEW);

    expect(result).toEqual({ total: 0, reencrypted: 0, failures: [] });
    expect(mockDownloadFile).not.toHaveBeenCalled();
    expect(mockUploadRaw).not.toHaveBeenCalled();
  });
});
