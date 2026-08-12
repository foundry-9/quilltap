/**
 * @jest-environment node
 *
 * Chokepoint invariant: the content-addressed mount store is authoritative
 * about its own hashes. `linkBlobContent` and `upsertByFileId` recompute
 * sha256 from the actual bytes, ignore a wrong caller-supplied sha (warning
 * about it), and dedup on the real content hash.
 *
 * Guards the fix for the vault blob sha256 mismatch:
 *   - lib/database/repositories/doc-mount-file-links.repository.ts (linkBlobContent)
 *   - lib/database/repositories/doc-mount-blobs.repository.ts (upsertByFileId)
 *
 * Runs the *real* repositories against a real in-memory SQLite DB wired in via
 * the mount-index global handle (getRawMountIndexDatabase reads it), so the
 * INSERTs and the stored bytes are exercised end-to-end — no mocking of the
 * thing under test.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';
import { createHash, randomUUID } from 'crypto';

// Load the real native SQLite driver (not the jest mock alias). Mirrors the
// loadDriver() pattern used by the mount-index migration tests.
function loadDriver(): any {
  try {
    return require(path.join(
      __dirname, '..', '..', '..', '..', '..',
      'packages', 'quilltap', 'node_modules', 'better-sqlite3-multiple-ciphers'
    ));
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers');
    } catch {
      return require(path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}
const Database = loadDriver();

import { logger } from '@/lib/logger';
import { DocMountFileLinksRepository } from '@/lib/database/repositories/doc-mount-file-links.repository';
import { DocMountFilesRepository } from '@/lib/database/repositories/doc-mount-files.repository';
import { DocMountFoldersRepository } from '@/lib/database/repositories/doc-mount-folders.repository';
import { DocMountBlobsRepository } from '@/lib/database/repositories/doc-mount-blobs.repository';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const WRONG_SHA = 'f'.repeat(64);
const OTHER_WRONG_SHA = 'a'.repeat(64);

let db: any;
let links: DocMountFileLinksRepository;
let blobs: DocMountBlobsRepository;

function baseLinkInput(relativePath: string, data: Buffer, sha256: string) {
  return {
    mountPointId: 'mp-1',
    relativePath,
    fileName: relativePath,
    folderId: null,
    originalFileName: relativePath,
    originalMimeType: 'image/webp',
    storedMimeType: 'image/webp',
    sha256,
    data,
  };
}

let warnSpy: ReturnType<typeof jest.spyOn>;

function warnedAboutMismatch(): boolean {
  return warnSpy.mock.calls.some(
    (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('disagrees with stored bytes')
  );
}

beforeEach(async () => {
  // Capture (and silence) the mismatch warning on the real logger singleton.
  warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});

  db = new Database(':memory:');
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = db;
  (globalThis as Record<string, unknown>).__quilltapMountIndexDegraded = false;

  links = new DocMountFileLinksRepository();
  blobs = new DocMountBlobsRepository();
  // Trigger lazy CREATE TABLE for the tables linkBlobContent writes with raw
  // SQL (it only creates doc_mount_file_links itself via getCollection).
  await new DocMountFilesRepository().findBySha256('seed');
  await new DocMountFoldersRepository().findByMountPointId('seed');
  await blobs.findByFileId('seed');

  warnSpy.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  try { db.close(); } catch { /* ignore */ }
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = undefined;
});

describe('linkBlobContent sha256 chokepoint', () => {
  it('stores sha256(data) — not the caller sha — in both tables and warns on mismatch', async () => {
    const data = Buffer.from('the real stored bytes');
    const { file, blobId } = await links.linkBlobContent(baseLinkInput('photo.webp', data, WRONG_SHA));

    const expected = sha(data);
    const fileRow = db.prepare('SELECT sha256 FROM doc_mount_files WHERE id = ?').get(file.id) as { sha256: string };
    const blobRow = db.prepare('SELECT sha256 FROM doc_mount_blobs WHERE id = ?').get(blobId) as { sha256: string };

    expect(fileRow.sha256).toBe(expected);
    expect(blobRow.sha256).toBe(expected);
    expect(expected).not.toBe(WRONG_SHA);
    expect(warnedAboutMismatch()).toBe(true);
  });

  it('does not warn when the caller sha already matches the stored bytes', async () => {
    const data = Buffer.from('correctly-hashed bytes');
    await links.linkBlobContent(baseLinkInput('ok.webp', data, sha(data)));
    expect(warnedAboutMismatch()).toBe(false);
  });

  it('dedups on the computed content hash even when callers pass different wrong shas', async () => {
    const data = Buffer.from('shared identical bytes');
    const a = await links.linkBlobContent(baseLinkInput('a.webp', data, WRONG_SHA));
    const b = await links.linkBlobContent(baseLinkInput('b.webp', data, OTHER_WRONG_SHA));

    // Same content row + blob reused; only one doc_mount_files row for these bytes.
    expect(b.file.id).toBe(a.file.id);
    const count = db.prepare('SELECT COUNT(*) AS n FROM doc_mount_files WHERE sha256 = ?').get(sha(data)) as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('upsertByFileId sha256 chokepoint', () => {
  // upsertByFileId assumes the content row already exists (doc_mount_blobs has
  // a FK to doc_mount_files); seed it so the blob INSERT satisfies the FK.
  function seedFileRow(fileId: string, sizeBytes: number) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO doc_mount_files (id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt)
       VALUES (?, ?, ?, 'blob', 'database', ?, ?)`
    ).run(fileId, 'placeholder-sha-' + '0'.repeat(48), sizeBytes, now, now);
  }

  it('stores sha256(data) — not the caller sha — and warns on mismatch', async () => {
    const data = Buffer.from('blob bytes for upsert');
    const fileId = randomUUID();
    seedFileRow(fileId, data.length);
    await blobs.upsertByFileId({ fileId, sha256: WRONG_SHA, storedMimeType: 'image/webp', data });

    const row = db.prepare('SELECT sha256 FROM doc_mount_blobs WHERE fileId = ?').get(fileId) as { sha256: string };
    expect(row.sha256).toBe(sha(data));
    expect(warnedAboutMismatch()).toBe(true);
  });

  it('does not warn when the caller sha already matches the stored bytes', async () => {
    const data = Buffer.from('already-correct upsert bytes');
    const fileId = randomUUID();
    seedFileRow(fileId, data.length);
    await blobs.upsertByFileId({ fileId, sha256: sha(data), storedMimeType: 'image/webp', data });
    expect(warnedAboutMismatch()).toBe(false);
  });
});
