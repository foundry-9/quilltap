/**
 * @jest-environment node
 *
 * F4 — `preserveIds` must reach vault internals: the explicit-id fields on
 * `linkDocumentContent` / `linkBlobContent` (`fileId` / `documentId` /
 * `blobId` / `linkId`) are honored when the row in question is actually
 * created, and ignored when an existing row already owns the identity —
 * content-addressed dedup and the (mountPointId, relativePath) upsert always
 * win over a caller-claimed id.
 *
 * Runs the *real* repository against a real in-memory SQLite DB (mirrors
 * doc-mount-link-groups.integration.test.ts) so the raw INSERTs are exercised
 * end-to-end. This is the row-level half of the archive/rehydrate identity
 * guarantee; the importer-level threading is covered in
 * lib/import/quilltap-import/__tests__/import-document-stores.test.ts.
 *
 * Guards:
 *   - lib/database/repositories/doc-mount-file-links.repository.ts
 *     (LinkDocumentInput / LinkBlobInput explicit ids)
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';
import { createHash } from 'crypto';

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
import { DocMountDocumentsRepository } from '@/lib/database/repositories/doc-mount-documents.repository';
import { DocMountBlobsRepository } from '@/lib/database/repositories/doc-mount-blobs.repository';

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

let db: any;
let links: DocMountFileLinksRepository;

beforeEach(async () => {
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});

  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = db;
  (globalThis as Record<string, unknown>).__quilltapMountIndexDegraded = false;

  links = new DocMountFileLinksRepository();
  await new DocMountFilesRepository().findBySha256('seed');
  await new DocMountFoldersRepository().findByMountPointId('seed');
  await new DocMountDocumentsRepository().findByFileId('seed');
  await new DocMountBlobsRepository().findByFileId('seed');
});

afterEach(() => {
  jest.restoreAllMocks();
  try { db.close(); } catch { /* ignore */ }
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = undefined;
});

const DOC = '# Identity\nAda of the Archives.';

function writeDoc(overrides: Record<string, unknown> = {}) {
  return links.linkDocumentContent({
    mountPointId: 'mount-1',
    relativePath: 'identity.md',
    fileName: 'identity.md',
    folderId: null,
    fileType: 'markdown',
    content: DOC,
    contentSha256: sha(DOC),
    plainTextLength: DOC.length,
    fileSizeBytes: Buffer.byteLength(DOC, 'utf-8'),
    ...overrides,
  } as never);
}

const BYTES = Buffer.from('not-really-a-webp');

function writeBlob(overrides: Record<string, unknown> = {}) {
  return links.linkBlobContent({
    mountPointId: 'mount-1',
    relativePath: 'photos/portrait.webp',
    fileName: 'portrait.webp',
    folderId: null,
    originalFileName: 'portrait.webp',
    originalMimeType: 'image/webp',
    storedMimeType: 'image/webp',
    sha256: sha(BYTES),
    data: BYTES,
    ...overrides,
  } as never);
}

describe('linkDocumentContent honors explicit ids on create', () => {
  it('creates file, document and link rows at exactly the claimed ids', async () => {
    const { link, file, documentId } = await writeDoc({
      fileId: 'claimed-file-id',
      documentId: 'claimed-document-id',
      linkId: 'claimed-link-id',
    });

    expect(file.id).toBe('claimed-file-id');
    expect(documentId).toBe('claimed-document-id');
    expect(link.id).toBe('claimed-link-id');

    // The claims reached the actual rows, not just the return values.
    expect(db.prepare('SELECT id FROM doc_mount_files WHERE id = ?').get('claimed-file-id')).toBeDefined();
    expect(db.prepare('SELECT id FROM doc_mount_documents WHERE id = ?').get('claimed-document-id')).toBeDefined();
    expect(db.prepare('SELECT id FROM doc_mount_file_links WHERE id = ?').get('claimed-link-id')).toBeDefined();
  });

  it('mints random ids when no explicit ids are passed (unchanged default)', async () => {
    const { link, file, documentId } = await writeDoc();
    expect(file.id).not.toBe('');
    expect(link.id).not.toBe(file.id);
    expect(documentId).not.toBe('');
  });

  it('existing rows keep their ids: dedup and path-upsert win over a claimed id', async () => {
    const first = await writeDoc({
      fileId: 'original-file-id',
      documentId: 'original-document-id',
      linkId: 'original-link-id',
    });
    expect(first.link.id).toBe('original-link-id');

    // Re-write the same path with the same bytes but different claimed ids —
    // the skip-if-present re-run shape. Every existing row keeps its identity.
    const second = await writeDoc({
      fileId: 'imposter-file-id',
      documentId: 'imposter-document-id',
      linkId: 'imposter-link-id',
    });
    expect(second.file.id).toBe('original-file-id');
    expect(second.documentId).toBe('original-document-id');
    expect(second.link.id).toBe('original-link-id');
    expect(db.prepare('SELECT id FROM doc_mount_file_links WHERE id = ?').get('imposter-link-id')).toBeUndefined();
  });

  it('a second link to identical content claims its own link id but shares the deduped file row', async () => {
    await writeDoc({ fileId: 'file-a', documentId: 'doc-a', linkId: 'link-a' });
    const second = await writeDoc({
      relativePath: 'copies/identity.md',
      fileId: 'file-b',
      documentId: 'doc-b',
      linkId: 'link-b',
    });

    // New path → new link at its claimed id; same bytes → the original
    // content row (the content-addressed store is authoritative).
    expect(second.link.id).toBe('link-b');
    expect(second.file.id).toBe('file-a');
    expect(second.documentId).toBe('doc-a');
  });
});

describe('linkBlobContent honors explicit ids on create', () => {
  it('creates file, blob and link rows at exactly the claimed ids', async () => {
    const { link, file, blobId } = await writeBlob({
      fileId: 'claimed-blob-file-id',
      blobId: 'claimed-blob-id',
      linkId: 'claimed-blob-link-id',
    });

    expect(file.id).toBe('claimed-blob-file-id');
    expect(blobId).toBe('claimed-blob-id');
    expect(link.id).toBe('claimed-blob-link-id');
    expect(db.prepare('SELECT id FROM doc_mount_blobs WHERE id = ?').get('claimed-blob-id')).toBeDefined();
  });

  it('existing rows keep their ids on a re-write with different claims', async () => {
    await writeBlob({ fileId: 'blob-file-1', blobId: 'blob-1', linkId: 'blob-link-1' });
    const second = await writeBlob({
      fileId: 'imposter-file',
      blobId: 'imposter-blob',
      linkId: 'imposter-link',
    });

    expect(second.file.id).toBe('blob-file-1');
    expect(second.blobId).toBe('blob-1');
    expect(second.link.id).toBe('blob-link-1');
  });
});
