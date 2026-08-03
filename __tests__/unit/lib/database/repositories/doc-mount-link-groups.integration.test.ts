/**
 * @jest-environment node
 *
 * Hard-link groups: a write through one member of a deliberate link group must
 * repoint every member (POSIX hard-link semantics), while links that merely
 * share a content-addressed fileId must still fork on write.
 *
 * That second half is the load-bearing one. Content rows are keyed by sha256,
 * so unrelated files with identical bytes (an empty file, a boilerplate header)
 * share a fileId by coincidence — in the wild a single row was shared by 36
 * character vaults. Propagating writes on a shared fileId would rewrite all of
 * them; propagating only within a linkGroupId is what makes the fix safe.
 *
 * Runs the *real* repository against a real in-memory SQLite DB (mirrors
 * doc-mount-file-links-policy.integration.test.ts) so the raw INSERT/UPDATE and
 * the FK cascade are exercised end-to-end.
 *
 * Guards:
 *   - lib/database/repositories/doc-mount-file-links.repository.ts
 *     (fanOutGroupFileId, gcOrphanedFileRow, bindLinkGroup,
 *      findByLinkGroupId, deleteWithGC group teardown)
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

const sha = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');

const V1 = '# Ansible Security Architecture\nFirst revision.';
const V2 = '# Ansible Security Architecture\nSecond revision, materially longer.';

let db: any;
let links: DocMountFileLinksRepository;

/** Write a text document to (mount, path) and return the resulting link. */
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

function linkRow(linkId: string) {
  return db
    .prepare('SELECT id, fileId, linkGroupId, plainTextLength FROM doc_mount_file_links WHERE id = ?')
    .get(linkId) as { id: string; fileId: string; linkGroupId: string | null; plainTextLength: number };
}

function contentOf(linkId: string): string | undefined {
  const row = db.prepare(
    `SELECT d.content AS content FROM doc_mount_file_links l
     JOIN doc_mount_documents d ON d.fileId = l.fileId
     WHERE l.id = ?`
  ).get(linkId) as { content: string } | undefined;
  return row?.content;
}

function fileRowExists(fileId: string): boolean {
  return db.prepare('SELECT 1 AS ok FROM doc_mount_files WHERE id = ?').get(fileId) !== undefined;
}

beforeEach(async () => {
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});

  db = new Database(':memory:');
  // Production opens the mount index with FKs on; the orphan sweep relies on
  // doc_mount_documents cascading off doc_mount_files.
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

describe('links that merely share a deduped fileId still fork on write', () => {
  it('writing one of two coincidentally-identical files leaves the other untouched', async () => {
    // Two unrelated documents in two stores that happen to have identical
    // bytes — the content-addressed store puts them on one file row.
    const a = await writeDoc('mp-1', 'a.md', V1);
    const b = await writeDoc('mp-2', 'b.md', V1);
    expect(linkRow(a.id).fileId).toBe(linkRow(b.id).fileId);
    expect(linkRow(a.id).linkGroupId).toBeNull();

    await writeDoc('mp-1', 'a.md', V2);

    expect(linkRow(a.id).fileId).not.toBe(linkRow(b.id).fileId);
    expect(contentOf(a.id)).toBe(V2);
    expect(contentOf(b.id)).toBe(V1);
  });

  it('the abandoned content row survives while another link still holds it', async () => {
    const a = await writeDoc('mp-1', 'a.md', V1);
    const b = await writeDoc('mp-2', 'b.md', V1);
    const sharedFileId = linkRow(a.id).fileId;

    await writeDoc('mp-1', 'a.md', V2);

    expect(fileRowExists(sharedFileId)).toBe(true);
    expect(linkRow(b.id).fileId).toBe(sharedFileId);
  });

  it('the abandoned content row is collected when nothing references it', async () => {
    const a = await writeDoc('mp-1', 'solo.md', V1);
    const oldFileId = linkRow(a.id).fileId;

    await writeDoc('mp-1', 'solo.md', V2);

    expect(fileRowExists(oldFileId)).toBe(false);
    // The document payload cascades away with its file row.
    const doc = db.prepare('SELECT 1 AS ok FROM doc_mount_documents WHERE fileId = ?').get(oldFileId);
    expect(doc).toBeUndefined();
  });
});

describe('deliberate hard-link groups move together', () => {
  it('a write through one member repoints every member', async () => {
    const a = await writeDoc('mp-1', 'Knowledge/doc.md', V1);
    const b = await writeDoc('mp-2', 'doc.md', V1);
    const groupId = await links.bindLinkGroup(a.id, b.id);
    expect(groupId).toBeTruthy();

    await writeDoc('mp-1', 'Knowledge/doc.md', V2);

    expect(linkRow(a.id).fileId).toBe(linkRow(b.id).fileId);
    expect(contentOf(a.id)).toBe(V2);
    expect(contentOf(b.id)).toBe(V2);
    // Text-shaped columns follow the content.
    expect(linkRow(b.id).plainTextLength).toBe(V2.length);
  });

  it('propagates in either direction', async () => {
    const a = await writeDoc('mp-1', 'doc.md', V1);
    const b = await writeDoc('mp-2', 'doc.md', V1);
    await links.bindLinkGroup(a.id, b.id);

    // Write through the *other* member this time.
    await writeDoc('mp-2', 'doc.md', V2);

    expect(contentOf(a.id)).toBe(V2);
    expect(contentOf(b.id)).toBe(V2);
  });

  it('reports the repointed siblings back to the caller for re-chunking', async () => {
    const a = await writeDoc('mp-1', 'doc.md', V1);
    const b = await writeDoc('mp-2', 'doc.md', V1);
    await links.bindLinkGroup(a.id, b.id);

    const { groupSiblings } = await links.linkDocumentContent({
      mountPointId: 'mp-1',
      relativePath: 'doc.md',
      fileName: 'doc.md',
      folderId: null,
      fileType: 'markdown',
      content: V2,
      contentSha256: sha(V2),
      plainTextLength: V2.length,
      fileSizeBytes: Buffer.byteLength(V2, 'utf-8'),
    });

    expect(groupSiblings).toHaveLength(1);
    expect(groupSiblings[0]).toMatchObject({ id: b.id, mountPointId: 'mp-2', relativePath: 'doc.md' });
  });

  it('linking a third location extends the existing group rather than splitting it', async () => {
    const a = await writeDoc('mp-1', 'doc.md', V1);
    const b = await writeDoc('mp-2', 'doc.md', V1);
    const c = await writeDoc('mp-3', 'doc.md', V1);

    const first = await links.bindLinkGroup(a.id, b.id);
    const second = await links.bindLinkGroup(a.id, c.id);
    expect(second).toBe(first);

    await writeDoc('mp-3', 'doc.md', V2);

    expect(contentOf(a.id)).toBe(V2);
    expect(contentOf(b.id)).toBe(V2);
    expect(contentOf(c.id)).toBe(V2);
    expect(await links.findByLinkGroupId(first!)).toHaveLength(3);
  });

  it('collects the content row the whole group abandoned', async () => {
    const a = await writeDoc('mp-1', 'doc.md', V1);
    const b = await writeDoc('mp-2', 'doc.md', V1);
    await links.bindLinkGroup(a.id, b.id);
    const oldFileId = linkRow(a.id).fileId;

    await writeDoc('mp-1', 'doc.md', V2);

    expect(fileRowExists(oldFileId)).toBe(false);
  });
});

describe('group teardown on unlink', () => {
  it('clears the group id once a single member is left', async () => {
    const a = await writeDoc('mp-1', 'doc.md', V1);
    const b = await writeDoc('mp-2', 'doc.md', V1);
    await links.bindLinkGroup(a.id, b.id);

    await links.deleteWithGC(b.id);

    expect(linkRow(a.id).linkGroupId).toBeNull();
  });

  it('keeps the group intact while two or more members remain', async () => {
    const a = await writeDoc('mp-1', 'doc.md', V1);
    const b = await writeDoc('mp-2', 'doc.md', V1);
    const c = await writeDoc('mp-3', 'doc.md', V1);
    const groupId = await links.bindLinkGroup(a.id, b.id);
    await links.bindLinkGroup(a.id, c.id);

    await links.deleteWithGC(c.id);

    expect(linkRow(a.id).linkGroupId).toBe(groupId);
    expect(linkRow(b.id).linkGroupId).toBe(groupId);
  });
});

describe('a pre-migration table is aligned rather than read as empty', () => {
  it('finds documents on a links table that has no linkGroupId column yet', async () => {
    // Reproduces the live failure: code that names linkGroupId reached a
    // database whose migration had not run. safeQuery swallowed "no such
    // column" into a null result, so every document read as not-found and
    // `docs link` reported a file that plainly existed as missing.
    const a = await writeDoc('mp-1', 'doc.md', V1);

    // Drop the column the way an un-migrated database would have it, and clear
    // the repositories' one-shot init flags so the next call re-runs alignment.
    db.exec('DROP INDEX IF EXISTS idx_doc_mount_file_links_linkGroupId');
    db.exec('ALTER TABLE doc_mount_file_links DROP COLUMN linkGroupId');
    const cols = db.pragma('table_info(doc_mount_file_links)') as Array<{ name: string }>;
    expect(cols.some(c => c.name === 'linkGroupId')).toBe(false);

    const freshLinks = new DocMountFileLinksRepository();
    const found = await freshLinks.findByMountPointAndPath('mp-1', 'doc.md');

    expect(found).not.toBeNull();
    expect(found!.id).toBe(a.id);
    // …and the column is back, so group writes work from here on.
    const after = db.pragma('table_info(doc_mount_file_links)') as Array<{ name: string }>;
    expect(after.some(c => c.name === 'linkGroupId')).toBe(true);
  });
});

describe('blob groups share bytes but keep per-link metadata', () => {
  const bytesV1 = Buffer.from('binary-one');
  const bytesV2 = Buffer.from('binary-two-and-longer');

  async function writeBlob(mountPointId: string, relativePath: string, data: Buffer, description: string) {
    const { link } = await links.linkBlobContent({
      mountPointId,
      relativePath,
      fileName: path.posix.basename(relativePath),
      folderId: null,
      originalFileName: path.posix.basename(relativePath),
      originalMimeType: 'image/webp',
      storedMimeType: 'image/webp',
      sha256: createHash('sha256').update(data).digest('hex'),
      data,
      description,
    });
    return link;
  }

  it('repoints the group but does not overwrite a sibling description', async () => {
    const a = await writeBlob('mp-1', 'img.webp', bytesV1, 'the Lantern’s backdrop');
    const b = await writeBlob('mp-2', 'img.webp', bytesV1, 'Friday’s keepsake');
    await links.bindLinkGroup(a.id, b.id);

    await writeBlob('mp-1', 'img.webp', bytesV2, 'the Lantern’s backdrop, revised');

    // Bytes are shared…
    expect(linkRow(a.id).fileId).toBe(linkRow(b.id).fileId);
    // …but each consumer keeps its own caption.
    const bDesc = db.prepare('SELECT description FROM doc_mount_file_links WHERE id = ?').get(b.id) as
      { description: string };
    expect(bDesc.description).toBe('Friday’s keepsake');
  });
});
