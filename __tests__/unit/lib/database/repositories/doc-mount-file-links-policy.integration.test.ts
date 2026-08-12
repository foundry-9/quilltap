/**
 * @jest-environment node
 *
 * Per-document policy round-trip: the three `allow*` columns on
 * doc_mount_file_links are written and read as booleans, derived from markdown
 * frontmatter at write time. Runs the *real* repository against a real
 * in-memory SQLite DB (mirrors content-hash-chokepoint.test.ts) so the raw
 * INSERT/UPDATE/SELECT exercise the columns end-to-end.
 *
 * Guards:
 *   - lib/database/repositories/doc-mount-file-links.repository.ts
 *     (linkDocumentContent frontmatter derivation, linkFilesystemFile flags,
 *      updatePolicyFlags, queryJoined 0/1 → boolean mapping)
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

const PROTECTED_MD = [
  '---',
  'embed: "false"',
  'character_read: "false"',
  'character_write: "false"',
  '---',
  '',
  '# ad-Daiat Recurring Scenarios',
  'Secret body.',
].join('\n');

const OPEN_MD = '# Just a note\nNo frontmatter here.';

let db: any;
let links: DocMountFileLinksRepository;

function allowRow(linkId: string) {
  return db
    .prepare('SELECT allowEmbed, allowCharacterRead, allowCharacterWrite FROM doc_mount_file_links WHERE id = ?')
    .get(linkId) as { allowEmbed: number; allowCharacterRead: number; allowCharacterWrite: number };
}

beforeEach(async () => {
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});

  db = new Database(':memory:');
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = db;
  (globalThis as Record<string, unknown>).__quilltapMountIndexDegraded = false;

  links = new DocMountFileLinksRepository();
  // Trigger lazy CREATE TABLE for the tables the raw-SQL writers touch.
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

describe('linkDocumentContent derives policy from markdown frontmatter', () => {
  it('quoted "false" frontmatter → allow* columns all 0', async () => {
    const { link } = await links.linkDocumentContent({
      mountPointId: 'mp-1',
      relativePath: 'ad-Daiat.md',
      fileName: 'ad-Daiat.md',
      folderId: null,
      fileType: 'markdown',
      content: PROTECTED_MD,
      contentSha256: sha(PROTECTED_MD),
      plainTextLength: PROTECTED_MD.length,
      fileSizeBytes: Buffer.byteLength(PROTECTED_MD, 'utf-8'),
    });

    expect(allowRow(link.id)).toEqual({
      allowEmbed: 0,
      allowCharacterRead: 0,
      allowCharacterWrite: 0,
    });
    // Joined read returns booleans, not 0/1.
    expect(link.allowEmbed).toBe(false);
    expect(link.allowCharacterRead).toBe(false);
    expect(link.allowCharacterWrite).toBe(false);
  });

  it('no frontmatter → all permissive (columns 1, booleans true)', async () => {
    const { link } = await links.linkDocumentContent({
      mountPointId: 'mp-1',
      relativePath: 'open.md',
      fileName: 'open.md',
      folderId: null,
      fileType: 'markdown',
      content: OPEN_MD,
      contentSha256: sha(OPEN_MD),
      plainTextLength: OPEN_MD.length,
      fileSizeBytes: Buffer.byteLength(OPEN_MD, 'utf-8'),
    });

    expect(allowRow(link.id)).toEqual({
      allowEmbed: 1,
      allowCharacterRead: 1,
      allowCharacterWrite: 1,
    });
    expect(link.allowEmbed).toBe(true);
    expect(link.allowCharacterRead).toBe(true);
    expect(link.allowCharacterWrite).toBe(true);
  });

  it('non-markdown native text (json) → permissive even without frontmatter', async () => {
    const json = '{"a":1}';
    const { link } = await links.linkDocumentContent({
      mountPointId: 'mp-1',
      relativePath: 'data.json',
      fileName: 'data.json',
      folderId: null,
      fileType: 'json',
      content: json,
      contentSha256: sha(json),
      plainTextLength: json.length,
      fileSizeBytes: Buffer.byteLength(json, 'utf-8'),
    });
    expect(allowRow(link.id)).toEqual({ allowEmbed: 1, allowCharacterRead: 1, allowCharacterWrite: 1 });
  });

  it('character_read:false cascades — embed and character_write columns also 0', async () => {
    const readOnlyHidden = [
      '---',
      'character_read: false',
      '---',
      '',
      '# Hidden but otherwise unmarked',
    ].join('\n');
    const { link } = await links.linkDocumentContent({
      mountPointId: 'mp-1', relativePath: 'hidden.md', fileName: 'hidden.md', folderId: null,
      fileType: 'markdown', content: readOnlyHidden, contentSha256: sha(readOnlyHidden),
      plainTextLength: readOnlyHidden.length, fileSizeBytes: Buffer.byteLength(readOnlyHidden, 'utf-8'),
    });
    expect(allowRow(link.id)).toEqual({ allowEmbed: 0, allowCharacterRead: 0, allowCharacterWrite: 0 });
  });

  it('re-write with open frontmatter clears a prior protection', async () => {
    await links.linkDocumentContent({
      mountPointId: 'mp-1', relativePath: 'toggle.md', fileName: 'toggle.md', folderId: null,
      fileType: 'markdown', content: PROTECTED_MD, contentSha256: sha(PROTECTED_MD),
      plainTextLength: PROTECTED_MD.length, fileSizeBytes: Buffer.byteLength(PROTECTED_MD, 'utf-8'),
    });
    const { link } = await links.linkDocumentContent({
      mountPointId: 'mp-1', relativePath: 'toggle.md', fileName: 'toggle.md', folderId: null,
      fileType: 'markdown', content: OPEN_MD, contentSha256: sha(OPEN_MD),
      plainTextLength: OPEN_MD.length, fileSizeBytes: Buffer.byteLength(OPEN_MD, 'utf-8'),
    });
    expect(allowRow(link.id)).toEqual({ allowEmbed: 1, allowCharacterRead: 1, allowCharacterWrite: 1 });
  });
});

describe('linkFilesystemFile honors explicit policy flags', () => {
  it('writes the flags it is given; defaults to permissive', async () => {
    const blocked = await links.linkFilesystemFile({
      mountPointId: 'mp-1',
      relativePath: 'notes/secret.md',
      fileName: 'secret.md',
      fileType: 'markdown',
      sha256: sha('secret'),
      fileSizeBytes: 6,
      lastModified: new Date().toISOString(),
      allowEmbed: false,
      allowCharacterRead: false,
      allowCharacterWrite: false,
    });
    expect(allowRow(blocked.id)).toEqual({ allowEmbed: 0, allowCharacterRead: 0, allowCharacterWrite: 0 });

    const open = await links.linkFilesystemFile({
      mountPointId: 'mp-1',
      relativePath: 'notes/open.md',
      fileName: 'open.md',
      fileType: 'markdown',
      sha256: sha('open'),
      fileSizeBytes: 4,
      lastModified: new Date().toISOString(),
    });
    expect(allowRow(open.id)).toEqual({ allowEmbed: 1, allowCharacterRead: 1, allowCharacterWrite: 1 });
  });
});

describe('updatePolicyFlags', () => {
  it('overwrites the three columns and a later read reflects it', async () => {
    const link = await links.linkFilesystemFile({
      mountPointId: 'mp-1',
      relativePath: 'flip.md',
      fileName: 'flip.md',
      fileType: 'markdown',
      sha256: sha('flip'),
      fileSizeBytes: 4,
      lastModified: new Date().toISOString(),
    });
    await links.updatePolicyFlags(link.id, {
      allowEmbed: false,
      allowCharacterRead: true,
      allowCharacterWrite: false,
    });
    expect(allowRow(link.id)).toEqual({ allowEmbed: 0, allowCharacterRead: 1, allowCharacterWrite: 0 });

    const refetched = await links.findByMountPointAndPath('mp-1', 'flip.md');
    expect(refetched?.allowEmbed).toBe(false);
    expect(refetched?.allowCharacterRead).toBe(true);
    expect(refetched?.allowCharacterWrite).toBe(false);
  });
});
