/**
 * Bugs 108 and 109 — what `doc_str_replace` and `doc_insert_text` say when the
 * call is malformed, and what they do when the file's punctuation is curlier
 * than the caller's find text.
 *
 * Bug 108: the dispatcher hands a handler its RAW input when the Zod parse
 * fails, so a call that omitted `find` used to reach the matcher as `undefined`,
 * match nothing, and be reported as *"Text not found in file… use the exact
 * text from your most recent read"* — advice that cannot work, for a fault that
 * is not in the file. A model reading it re-reads and repeats the same
 * malformed call, which is exactly what happened on the instance this was found
 * on: two identical failures in one agent loop.
 *
 * Bug 109: the matcher is real here (only the filesystem and the announcer are
 * mocked), so these cases exercise the fold end to end and assert the bytes
 * actually written.
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Module mocks — must precede the handler import.
// ---------------------------------------------------------------------------

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('@/lib/logger', () => ({
  logger: { child: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// The real matcher, the mocked everything-else: these tests are about the
// bytes that come out of a match, so stubbing findUniqueMatch would test the
// stub. `diacritics` pulls in nothing but the fold table and a logger.
jest.mock('@/lib/doc-edit', () => {
  const matching = jest.requireActual('@/lib/doc-edit/diacritics');
  class PathResolutionError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'PathResolutionError';
      this.code = code;
    }
  }
  return {
    resolveDocEditPath: jest.fn(),
    readFileWithMtime: jest.fn(),
    writeFileWithMtimeCheck: jest.fn().mockResolvedValue({ mtime: 1700000000000 }),
    getAccessibleMountPoints: jest.fn().mockResolvedValue([]),
    resolveMountPointRef: jest.fn(),
    isTextFile: jest.fn().mockReturnValue(true),
    PathResolutionError,
    findUniqueMatch: matching.findUniqueMatch,
    findAllMatches: matching.findAllMatches,
    reindexSingleFile: jest.fn().mockResolvedValue(undefined),
    parseFrontmatter: jest.fn(),
    updateFrontmatterInContent: jest.fn(),
    findHeadingSection: jest.fn(),
    readHeadingContent: jest.fn(),
    replaceHeadingContent: jest.fn(),
    parseQtapUri: jest.fn(),
    generateUnifiedDiff: jest.fn().mockReturnValue('DIFF-SENTINEL'),
  };
});

jest.mock('@/lib/doc-edit/uri-producers', () => ({
  uriForResolvedPath: jest.fn(async (resolved: { relativePath: string }) => `qtap://test/${resolved.relativePath}`),
  docStoreUriFor: jest.fn(async ({ relativePath }: { relativePath: string }) => `qtap://test/${relativePath}`),
  buildDocStoreUriResolver: jest.fn(),
}));

jest.mock('@/lib/doc-edit/mime-registry', () => ({
  detectMimeFromExtension: jest.fn().mockReturnValue('text/markdown'),
  isJsonFamily: jest.fn().mockReturnValue(false),
  isJsonMime: jest.fn().mockReturnValue(false),
  isJsonlMime: jest.fn().mockReturnValue(false),
  parseContent: jest.fn(),
  serializeContent: jest.fn(),
  validateJson: jest.fn(),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  databaseDocumentExists: jest.fn(),
  databaseFolderExists: jest.fn().mockResolvedValue(false),
  deleteDatabaseDocument: jest.fn(),
  createDatabaseFolder: jest.fn(),
  deleteDatabaseFolder: jest.fn(),
  moveDatabaseDocument: jest.fn().mockResolvedValue(undefined),
  moveDatabaseFolder: jest.fn().mockResolvedValue(undefined),
  listDatabaseFiles: jest.fn(),
}));

jest.mock('@/lib/mount-index/blob-transcode', () => ({
  transcodeToWebP: jest.fn(),
  normaliseBlobRelativePath: jest.fn((p: string) => p),
}));

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/repositories/factory', () => {
  const characters = { findById: jest.fn() };
  const chats = { findById: jest.fn() };
  const docMountBlobs = { create: jest.fn(), deleteByMountPointAndPath: jest.fn(), findByMountPointAndPath: jest.fn() };
  const docMountPoints = { findById: jest.fn(), refreshStats: jest.fn().mockResolvedValue(undefined) };
  const docMountFileLinks = {
    findByMountPointAndPath: jest.fn().mockResolvedValue(null),
    findByMountPointId: jest.fn().mockResolvedValue([]),
  };
  return { getRepositories: () => ({ characters, chats, docMountBlobs, docMountPoints, docMountFileLinks }) };
});

jest.mock('@/lib/services/librarian-notifications/writer', () => ({
  postLibrarianOpenAnnouncement: jest.fn(),
  postLibrarianDeleteAnnouncement: jest.fn(),
  postLibrarianFolderCreatedAnnouncement: jest.fn(),
  postLibrarianFolderDeletedAnnouncement: jest.fn(),
  postLibrarianWriteAnnouncement: jest.fn(),
  postLibrarianMoveAnnouncement: jest.fn(),
  postLibrarianCopyAnnouncement: jest.fn(),
  postLibrarianBlobWriteAnnouncement: jest.fn(),
  contentHiddenFromCharacters: jest.fn(() => false),
  documentHiddenFromCharacters: jest.fn(async () => false),
}));

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
  mkdir: jest.fn(),
  rename: jest.fn(),
  unlink: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
  readdir: jest.fn(),
  rmdir: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { executeDocEditTool } from '@/lib/tools/handlers/doc-edit-handler';
import { resolveDocEditPath, readFileWithMtime, writeFileWithMtimeCheck } from '@/lib/doc-edit';
import { getRepositories } from '@/lib/repositories/factory';

const mockResolve = resolveDocEditPath as jest.Mock;
const mockRead = readFileWithMtime as jest.Mock;
const mockWrite = writeFileWithMtimeCheck as jest.Mock;
const repos = getRepositories();
const charsFindById = repos.characters.findById as jest.Mock;
const chatsFindById = repos.chats.findById as jest.Mock;

const context = { chatId: 'chat-1', userId: 'user-1', projectId: 'project-1', characterId: 'char-1' };

function dbResolved(relativePath: string) {
  return {
    absolutePath: '',
    scope: 'document_store',
    mountPointId: 'mp-1',
    mountPointName: 'The Estate',
    mountType: 'database',
    basePath: '',
    relativePath,
  };
}

/** The passage as the file holds it — curly apostrophe, em dashes and all. */
const CURLY_FILE = [
  '## Open items',
  '',
  '- Sylvain’s first entry (his tempo).',
  '- Family vote — not scheduled.',
  '',
].join('\n');

describe('doc_str_replace / doc_insert_text — malformed calls and typographic tolerance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    charsFindById.mockResolvedValue({ id: 'char-1', name: 'Friday', systemTransparency: true });
    chatsFindById.mockResolvedValue({ id: 'chat-1', allowCrossCharacterVaultReads: false, participants: [] });
    mockResolve.mockResolvedValue(dbResolved('Protocol.md'));
    mockRead.mockResolvedValue({ content: CURLY_FILE, mtime: 1, size: CURLY_FILE.length });
    mockWrite.mockResolvedValue({ mtime: 1700000000000 });
  });

  // -- Bug 108: the call, not the file ------------------------------------

  it('names the missing `find` argument instead of blaming the file', async () => {
    const res = await executeDocEditTool(
      'doc_str_replace',
      { mount_point: 'The Estate', path: 'Protocol.md', scope: 'document_store', replace: 'new text' },
      context
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('`find`');
    expect(res.error).toContain('missing');
    // The sentence that sent the model back to re-read must not appear.
    expect(res.error).not.toContain('Text not found');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('rejects an empty `find` for the same reason', async () => {
    const res = await executeDocEditTool(
      'doc_str_replace',
      { mount_point: 'The Estate', path: 'Protocol.md', find: '', replace: 'new text' },
      context
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('empty');
    expect(res.error).not.toContain('Text not found');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('names a missing `replace` rather than writing the string "undefined" into the file', async () => {
    const res = await executeDocEditTool(
      'doc_str_replace',
      { mount_point: 'The Estate', path: 'Protocol.md', find: '## Open items' },
      context
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('`replace`');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('accepts an empty `replace`, which means deletion', async () => {
    const res = await executeDocEditTool(
      'doc_str_replace',
      { mount_point: 'The Estate', path: 'Protocol.md', find: '- Family vote — not scheduled.\n', replace: '' },
      context
    );

    expect(res.success).toBe(true);
    expect(mockWrite.mock.calls[0][1]).not.toContain('Family vote');
  });

  it('names a missing `position` on doc_insert_text instead of throwing a TypeError', async () => {
    const res = await executeDocEditTool(
      'doc_insert_text',
      { mount_point: 'The Estate', path: 'Protocol.md', content: 'a new line\n' },
      context
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('`position`');
    expect(res.error).not.toContain('Cannot read properties');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  // -- Bug 109: the file is curlier than the find text --------------------

  it('edits a passage whose apostrophe the file spells curly and the call spells straight', async () => {
    const res = await executeDocEditTool(
      'doc_str_replace',
      {
        mount_point: 'The Estate',
        path: 'Protocol.md',
        find: "- Sylvain's first entry (his tempo).",
        replace: '- Sylvain has filed his first entry.',
      },
      context
    );

    expect(res.success).toBe(true);
    const written = mockWrite.mock.calls[0][1] as string;
    expect(written).toContain('- Sylvain has filed his first entry.');
    expect(written).not.toContain('first entry (his tempo)');
    // Only the named passage moved; the rest of the file keeps its own punctuation.
    expect(written).toContain('- Family vote — not scheduled.');
    // And the model is told why its find text matched, so it can stop guessing.
    expect(res.formattedText).toContain('punctuation');
  });

  it('matches an em dash by the hyphen a model retyped it as', async () => {
    const res = await executeDocEditTool(
      'doc_str_replace',
      {
        mount_point: 'The Estate',
        path: 'Protocol.md',
        find: '- Family vote - not scheduled.',
        replace: '- Family vote scheduled for Tuesday.',
      },
      context
    );

    expect(res.success).toBe(true);
    expect(mockWrite.mock.calls[0][1]).toContain('- Family vote scheduled for Tuesday.');
  });

  it('says nothing about punctuation when the find text matched exactly', async () => {
    const res = await executeDocEditTool(
      'doc_str_replace',
      { mount_point: 'The Estate', path: 'Protocol.md', find: '## Open items', replace: '## Outstanding' },
      context
    );

    expect(res.success).toBe(true);
    expect(res.formattedText).not.toContain('punctuation');
  });

  it('still reports a genuine miss as a miss', async () => {
    const res = await executeDocEditTool(
      'doc_str_replace',
      { mount_point: 'The Estate', path: 'Protocol.md', find: 'a sentence never written', replace: 'x' },
      context
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('Text not found');
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
