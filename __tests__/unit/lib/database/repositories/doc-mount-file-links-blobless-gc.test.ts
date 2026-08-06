/**
 * @jest-environment node
 *
 * Bug 13 — `gcOrphanedFileRow` must not throw on a mount index that has never
 * held a blob.
 *
 * `doc_mount_blobs` has no Zod schema, so `generateDDL` never mints it; the
 * blobs repository creates it lazily on first access. On an index built only
 * from documents (a restore from an old backup, a hand-built index), the second
 * write to a path orphans a content row and reaches the GC, whose unconditional
 * `DELETE FROM doc_mount_blobs` died with `no such table: doc_mount_blobs`. The
 * fix guards each payload delete behind a table-existence check.
 *
 * Strategy mirrors doc-mount-link-groups.integration.test.ts: the *real*
 * repository against a real in-memory SQLite DB — but the blobs table is
 * deliberately never seeded, so the index genuinely lacks it.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';
import { createHash } from 'crypto';

// Root package.json aliases better-sqlite3-multiple-ciphers as better-sqlite3,
// so the real binding lives at the root alias. Load it by ABSOLUTE root path:
// jest.config's moduleNameMapper maps the bare module names to the no-op mock
// (get()→undefined, all()→[]), and the ^name$ patterns don't match an absolute
// path. A bare or nested (packages/quilltap/node_modules) require would fall
// through to the mock in CI and every query would come back empty. See
// project_jest_real_sqlite_driver_load.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

import { logger } from '@/lib/logger';
import { DocMountFileLinksRepository } from '@/lib/database/repositories/doc-mount-file-links.repository';
import { DocMountFilesRepository } from '@/lib/database/repositories/doc-mount-files.repository';
import { DocMountFoldersRepository } from '@/lib/database/repositories/doc-mount-folders.repository';
import { DocMountDocumentsRepository } from '@/lib/database/repositories/doc-mount-documents.repository';

const sha = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');

const V1 = '# Ledger\nFirst revision.';
const V2 = '# Ledger\nSecond revision, materially longer.';

let db: any;
let links: DocMountFileLinksRepository;

async function writeDoc(mountPointId: string, relativePath: string, content: string) {
  const { link } = await links.linkDocumentContent({
    mountPointId,
    relativePath,
    fileName: path.posix.basename(relativePath),
    folderId: null,
    fileType: 'markdown',
    content,
    contentSha256: sha(content),
    plainTextLength: content.length,
    fileSizeBytes: Buffer.byteLength(content, 'utf-8'),
  });
  return link;
}

function tableExists(name: string): boolean {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name) !== undefined;
}

function contentOf(linkId: string): string | undefined {
  const row = db.prepare(
    `SELECT d.content AS content FROM doc_mount_file_links l
     JOIN doc_mount_documents d ON d.fileId = l.fileId
     WHERE l.id = ?`
  ).get(linkId) as { content: string } | undefined;
  return row?.content;
}

beforeEach(async () => {
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});

  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = db;
  (globalThis as Record<string, unknown>).__quilltapMountIndexDegraded = false;

  links = new DocMountFileLinksRepository();
  // Seed every table the document write path touches — files, folders,
  // documents, links — but DELIBERATELY NOT doc_mount_blobs. This is the
  // restored/hand-built index that never held a blob.
  await new DocMountFilesRepository().findBySha256('seed');
  await new DocMountFoldersRepository().findByMountPointId('seed');
  await new DocMountDocumentsRepository().findByFileId('seed');
  await links.findByMountPointId('seed');
});

afterEach(() => {
  jest.restoreAllMocks();
  try { db.close(); } catch { /* ignore */ }
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = undefined;
});

describe('Bug 13 — GC tolerates a mount index without doc_mount_blobs', () => {
  it('never created the blobs table (the precondition the bug needs)', () => {
    expect(tableExists('doc_mount_blobs')).toBe(false);
    expect(tableExists('doc_mount_documents')).toBe(true);
  });

  it('a second write to the same path succeeds and collects the orphaned row', async () => {
    const a = await writeDoc('mp-1', 'solo.md', V1);
    const firstFileId = db
      .prepare('SELECT fileId FROM doc_mount_file_links WHERE id = ?')
      .get(a.id) as { fileId: string };

    // The second write orphans the first content row → gcOrphanedFileRow runs.
    // Pre-fix this threw `no such table: doc_mount_blobs`.
    await expect(writeDoc('mp-1', 'solo.md', V2)).resolves.toBeDefined();

    expect(contentOf(a.id)).toBe(V2);
    // The abandoned content row (and its document payload) was collected…
    expect(
      db.prepare('SELECT 1 FROM doc_mount_files WHERE id = ?').get(firstFileId.fileId),
    ).toBeUndefined();
    expect(
      db.prepare('SELECT 1 FROM doc_mount_documents WHERE fileId = ?').get(firstFileId.fileId),
    ).toBeUndefined();
    // …and the blobs table is still absent — the guard skipped it, not created it.
    expect(tableExists('doc_mount_blobs')).toBe(false);
  });

  it('deleteWithGC also survives the missing blobs table', async () => {
    const a = await writeDoc('mp-1', 'gone.md', V1);
    const result = await links.deleteWithGC(a.id);
    expect(result.fileGC).toBe(true);
    expect(tableExists('doc_mount_blobs')).toBe(false);
  });
});
