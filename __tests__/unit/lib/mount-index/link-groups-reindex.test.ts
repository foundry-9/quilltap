/**
 * @jest-environment node
 *
 * Bug 15 — `reindexLinkGroupSiblings` must actually fan a write out to the rest
 * of a hard-link group.
 *
 * The content fan-out (raw SQL inside the write transaction) always worked, but
 * the *chunk* reindex was dead: `queryJoined` never selected `l.linkGroupId`, so
 * every joined read reported `linkGroupId: undefined` and the early-out
 * (`if (!link?.linkGroupId) return 0`) fired before any sibling was re-indexed.
 * Siblings served the previous revision's chunks to search and character
 * context.
 *
 * This runs the *real* repository against a real in-memory SQLite DB (so the
 * projection is genuinely exercised) and mocks only `reindexSingleFile` — the
 * expensive chunk/embedding pass — to assert the fan-out reaches the sibling.
 * Pre-fix the read yields no group id, `reindexSingleFile` is never called, and
 * this fails.
 */

import path from 'path';
import { createHash } from 'crypto';

jest.mock('@/lib/doc-edit/reindex-file', () => ({
  reindexSingleFile: jest.fn(async () => {}),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

function loadDriver(): any {
  try {
    return require(path.join(
      __dirname, '..', '..', '..', '..',
      'packages', 'quilltap', 'node_modules', 'better-sqlite3-multiple-ciphers'
    ));
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers');
    } catch {
      return require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}
const Database = loadDriver();

import { logger } from '@/lib/logger';
import { reindexLinkGroupSiblings } from '@/lib/mount-index/link-groups';
import { DocMountFileLinksRepository } from '@/lib/database/repositories/doc-mount-file-links.repository';
import { DocMountFilesRepository } from '@/lib/database/repositories/doc-mount-files.repository';
import { DocMountFoldersRepository } from '@/lib/database/repositories/doc-mount-folders.repository';
import { DocMountDocumentsRepository } from '@/lib/database/repositories/doc-mount-documents.repository';
import { DocMountBlobsRepository } from '@/lib/database/repositories/doc-mount-blobs.repository';

const { reindexSingleFile } = jest.requireMock('@/lib/doc-edit/reindex-file') as {
  reindexSingleFile: jest.Mock;
};
const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock;
};

const sha = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');
const V1 = '# Charter\nFirst revision.';
const V2 = '# Charter\nSecond revision, materially longer.';

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

beforeEach(async () => {
  jest.clearAllMocks();
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

  // reindexLinkGroupSiblings reads through getRepositories(); give it the real
  // link repo (so queryJoined runs for real) plus a database-mount stub so
  // sibling resolution takes the empty-absolute-path branch.
  getRepositories.mockReturnValue({
    docMountFileLinks: links,
    docMountPoints: { findById: async () => ({ mountType: 'database', basePath: null }) },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  try { db.close(); } catch { /* ignore */ }
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = undefined;
});

describe('Bug 15 — reindexLinkGroupSiblings fans out to hard-link siblings', () => {
  it('re-indexes the sibling of an edited hard-linked file', async () => {
    const a = await writeDoc('mp-1', 'doc.md', V1);
    const b = await writeDoc('mp-2', 'doc.md', V1);
    await links.bindLinkGroup(a.id, b.id);

    // Edit through mp-1; the content fan-out already moved mp-2 onto V2, but the
    // sibling's CHUNKS need re-rendering — that is what this call must trigger.
    await writeDoc('mp-1', 'doc.md', V2);
    const reindexed = await reindexLinkGroupSiblings('mp-1', 'doc.md');

    expect(reindexed).toBe(1);
    expect(reindexSingleFile).toHaveBeenCalledTimes(1);
    expect(reindexSingleFile).toHaveBeenCalledWith('mp-2', 'doc.md', '');
  });

  it('is a no-op for an ungrouped file (no siblings to re-index)', async () => {
    await writeDoc('mp-1', 'solo.md', V1);

    const reindexed = await reindexLinkGroupSiblings('mp-1', 'solo.md');

    expect(reindexed).toBe(0);
    expect(reindexSingleFile).not.toHaveBeenCalled();
  });

  it('exposes linkGroupId on the joined read (the projection the fix restores)', async () => {
    const a = await writeDoc('mp-1', 'doc.md', V1);
    const b = await writeDoc('mp-2', 'doc.md', V1);
    const groupId = await links.bindLinkGroup(a.id, b.id);

    const joined = await links.findByMountPointAndPath('mp-1', 'doc.md');
    expect(joined?.linkGroupId).toBe(groupId);
  });
});
