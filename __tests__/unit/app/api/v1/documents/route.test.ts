/**
 * Tests for the standalone (chat-less) Document Mode route
 * (GET/POST /api/v1/documents?action=...).
 *
 * The filesystem/mount-backed halves of `operator-doc-actions` are mocked, but
 * the REAL `computeRenameTarget`, error classes, and access-context constant run
 * — the route's contract is how it maps those outcomes onto status codes, and
 * how it keeps the cross-chat recent-documents history in step under the
 * STANDALONE_CHAT_ID sentinel.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler:
    (handler: (req: any, ctx: any) => Promise<any>) =>
    async (req: any, ctx: any) =>
      handler(req, ctx),
}));

jest.mock('@/lib/api/middleware/actions', () => ({
  withCollectionActionDispatch:
    (handlers: Record<string, (req: any, ctx: any) => Promise<any>>) =>
    async (req: any, ctx: any) => {
      const action = req.nextUrl.searchParams.get('action') ?? '';
      const handler = handlers[action];
      if (!handler) throw new Error(`unregistered action: ${action}`);
      return handler(req, ctx);
    },
}));

jest.mock('@/lib/doc-edit', () => ({
  readFileWithMtime: jest.fn(),
  resolveDocEditPath: jest.fn(),
  writeFileWithMtimeCheck: jest.fn(),
  reindexSingleFile: jest.fn(),
  isTextFile: jest.fn(() => true),
}));

jest.mock('@/lib/mount-index/database-store', () => {
  class DatabaseStoreError extends Error {
    constructor(message: string, public code: string) {
      super(message);
      this.name = 'DatabaseStoreError';
    }
  }
  return {
    DatabaseStoreError,
    moveDatabaseDocument: jest.fn(),
    deleteDatabaseDocument: jest.fn(),
    readDatabaseDocument: jest.fn(),
  };
});

// Keep the real computeRenameTarget, error classes, and STANDALONE_ACCESS_CONTEXT;
// stub only the calls that would touch a disk or a mount.
jest.mock('@/lib/documents/operator-doc-actions', () => ({
  ...jest.requireActual('@/lib/documents/operator-doc-actions'),
  resolveOperatorDocPath: jest.fn(),
  openDocumentFile: jest.fn(),
  writeDocumentFile: jest.fn(),
  renameDocumentFile: jest.fn(),
  deleteDocumentFile: jest.fn(),
  listAllEnabledStores: jest.fn(),
}));

import { GET, POST } from '@/app/api/v1/documents/route';
import { readFileWithMtime } from '@/lib/doc-edit';
import { DatabaseStoreError } from '@/lib/mount-index/database-store';
import {
  resolveOperatorDocPath,
  openDocumentFile,
  writeDocumentFile,
  renameDocumentFile,
  deleteDocumentFile,
  listAllEnabledStores,
  DocumentConflictError,
  DocumentMissingError,
} from '@/lib/documents/operator-doc-actions';
import { MAX_RECENT_DOCUMENTS, STANDALONE_CHAT_ID } from '@/lib/chat-documents/constants';

const listStores = listAllEnabledStores as jest.MockedFunction<typeof listAllEnabledStores>;
const openDoc = openDocumentFile as jest.MockedFunction<typeof openDocumentFile>;
const writeDoc = writeDocumentFile as jest.MockedFunction<typeof writeDocumentFile>;
const renameDoc = renameDocumentFile as jest.MockedFunction<typeof renameDocumentFile>;
const deleteDoc = deleteDocumentFile as jest.MockedFunction<typeof deleteDocumentFile>;
const resolvePath = resolveOperatorDocPath as jest.MockedFunction<typeof resolveOperatorDocPath>;
const readWithMtime = readFileWithMtime as jest.MockedFunction<typeof readFileWithMtime>;

function makeCtx() {
  const chatDocuments = {
    findRecentAcrossChats: jest.fn(async () => [] as unknown[]),
    openDocument: jest.fn(async () => undefined),
    renameFilePathInStore: jest.fn(async () => undefined),
  };
  const ctx = { user: { id: 'user-1' }, repos: { chatDocuments } } as never;
  return { ctx, chatDocuments };
}

function req(action: string, body?: unknown) {
  const url = new URL('http://localhost/api/v1/documents');
  url.searchParams.set('action', action);
  return { nextUrl: url, json: async () => body } as never;
}

function recentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    chatId: STANDALONE_CHAT_ID,
    filePath: 'Notes/a.md',
    scope: 'general',
    mountPoint: null,
    displayTitle: 'a.md',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================================
// accessible-stores
// ============================================================================

describe('GET ?action=accessible-stores', () => {
  it('returns every enabled store with no project shortcut', async () => {
    const stores = [{ id: 'store-1', name: 'Library', kind: 'document-store' }];
    listStores.mockResolvedValue(stores as never);
    const { ctx } = makeCtx();

    const res = await GET(req('accessible-stores'), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ stores, projectLibrary: null });
  });

  it('500s when store enumeration fails', async () => {
    listStores.mockRejectedValue(new Error('mount index unreadable'));
    const { ctx } = makeCtx();

    const res = await GET(req('accessible-stores'), ctx);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Failed to resolve accessible document stores',
    });
  });
});

// ============================================================================
// recent-documents
// ============================================================================

describe('POST ?action=recent-documents', () => {
  it('over-fetches so filtering and de-duplication still fill the list', async () => {
    const { ctx, chatDocuments } = makeCtx();

    await POST(req('recent-documents'), ctx);

    expect(chatDocuments.findRecentAcrossChats).toHaveBeenCalledWith(
      Math.max(MAX_RECENT_DOCUMENTS * 5, 50)
    );
  });

  it('drops project-scoped rows, which have no standalone context to resolve', async () => {
    const { ctx, chatDocuments } = makeCtx();
    chatDocuments.findRecentAcrossChats.mockResolvedValue([
      recentRow({ id: 'keep', scope: 'general' }),
      recentRow({ id: 'drop', scope: 'project', filePath: 'p.md' }),
      recentRow({ id: 'keep2', scope: 'document_store', filePath: 'b.md', mountPoint: 'Library' }),
    ]);

    const res = await POST(req('recent-documents'), ctx);
    const body = await res.json();

    expect(body.documents.map((d: { id: string }) => d.id)).toEqual(['keep', 'keep2']);
  });

  it('de-duplicates on scope + mount + path, keeping the newest', async () => {
    const { ctx, chatDocuments } = makeCtx();
    chatDocuments.findRecentAcrossChats.mockResolvedValue([
      recentRow({ id: 'newest', filePath: 'Notes/a.md', mountPoint: null }),
      recentRow({ id: 'older-duplicate', filePath: 'Notes/a.md', mountPoint: null }),
      // Same path in a different store is a genuinely different document.
      recentRow({ id: 'other-store', filePath: 'Notes/a.md', scope: 'document_store', mountPoint: 'Library' }),
    ]);

    const res = await POST(req('recent-documents'), ctx);
    const body = await res.json();

    expect(body.documents.map((d: { id: string }) => d.id)).toEqual(['newest', 'other-store']);
  });

  it(`caps the list at ${MAX_RECENT_DOCUMENTS}`, async () => {
    const { ctx, chatDocuments } = makeCtx();
    chatDocuments.findRecentAcrossChats.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => recentRow({ id: `doc-${i}`, filePath: `Notes/${i}.md` }))
    );

    const res = await POST(req('recent-documents'), ctx);
    const body = await res.json();

    expect(body.documents).toHaveLength(MAX_RECENT_DOCUMENTS);
  });

  it('projects each row onto the picker shape', async () => {
    const { ctx, chatDocuments } = makeCtx();
    chatDocuments.findRecentAcrossChats.mockResolvedValue([recentRow()]);

    const res = await POST(req('recent-documents'), ctx);
    const body = await res.json();

    expect(body.documents[0]).toEqual({
      id: 'doc-1',
      chatId: STANDALONE_CHAT_ID,
      filePath: 'Notes/a.md',
      scope: 'general',
      mountPoint: null,
      displayTitle: 'a.md',
      isActive: false,
      fromCurrentChat: false,
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
  });

  it('500s when the history read fails', async () => {
    const { ctx, chatDocuments } = makeCtx();
    chatDocuments.findRecentAcrossChats.mockRejectedValue(new Error('db gone'));

    const res = await POST(req('recent-documents'), ctx);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to get recent documents' });
  });
});

// ============================================================================
// open-document
// ============================================================================

describe('POST ?action=open-document', () => {
  const opened = {
    filePath: 'Notes/a.md',
    displayTitle: 'a.md',
    content: '# A',
    mtime: 1234,
    isNew: false,
  };

  it('returns the opened document and its content', async () => {
    openDoc.mockResolvedValue(opened as never);
    const { ctx } = makeCtx();

    const res = await POST(req('open-document', { filePath: 'Notes/a.md' }), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      document: {
        filePath: 'Notes/a.md',
        scope: 'general',
        mountPoint: null,
        displayTitle: 'a.md',
      },
      content: '# A',
      mtime: 1234,
      isNew: false,
    });
  });

  it('records the open under the standalone sentinel chat id', async () => {
    openDoc.mockResolvedValue(opened as never);
    const { ctx, chatDocuments } = makeCtx();

    await POST(
      req('open-document', { filePath: 'Notes/a.md', scope: 'document_store', mountPoint: 'Library' }),
      ctx
    );

    expect(chatDocuments.openDocument).toHaveBeenCalledWith(STANDALONE_CHAT_ID, {
      filePath: 'Notes/a.md',
      scope: 'document_store',
      mountPoint: 'Library',
      displayTitle: 'a.md',
    });
  });

  it('creates a blank document when no filePath is given', async () => {
    openDoc.mockResolvedValue({ ...opened, filePath: 'Untitled Document.md', isNew: true } as never);
    const { ctx } = makeCtx();

    const res = await POST(req('open-document', { title: 'Untitled', targetFolder: 'Drafts' }), ctx);
    const body = await res.json();

    expect(body.isNew).toBe(true);
    expect(openDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ filePath: undefined, title: 'Untitled', targetFolder: 'Drafts' })
    );
  });

  it('still returns the document when recording it in history throws', async () => {
    openDoc.mockResolvedValue(opened as never);
    const { ctx, chatDocuments } = makeCtx();
    chatDocuments.openDocument.mockRejectedValue(new Error('history table locked'));

    const res = await POST(req('open-document', { filePath: 'Notes/a.md' }), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ content: '# A' }));
  });

  it('404s when the document is missing', async () => {
    openDoc.mockRejectedValue(new DocumentMissingError('No such document: Notes/gone.md'));
    const { ctx } = makeCtx();

    const res = await POST(req('open-document', { filePath: 'Notes/gone.md' }), ctx);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'No such document: Notes/gone.md' });
  });

  it('500s on any other open failure', async () => {
    openDoc.mockRejectedValue(new Error('permission denied'));
    const { ctx } = makeCtx();

    const res = await POST(req('open-document', { filePath: 'Notes/a.md' }), ctx);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Failed to open document');
  });

  it('rejects the on-disk project scope, which is unresolvable without a chat', async () => {
    const { ctx } = makeCtx();

    await expect(
      POST(req('open-document', { filePath: 'a.md', scope: 'project' }), ctx)
    ).rejects.toThrow();
    expect(openDoc).not.toHaveBeenCalled();
  });
});

// ============================================================================
// read-document
// ============================================================================

describe('POST ?action=read-document', () => {
  it('returns content and mtime for the editor', async () => {
    resolvePath.mockResolvedValue({ absolutePath: '/data/a.md' } as never);
    readWithMtime.mockResolvedValue({ content: '# A', mtime: 99 } as never);
    const { ctx } = makeCtx();

    const res = await POST(req('read-document', { filePath: 'Notes/a.md' }), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ content: '# A', mtime: 99 });
  });

  it('400s when the path cannot be resolved', async () => {
    resolvePath.mockRejectedValue(new Error('unknown store "Nowhere"'));
    const { ctx } = makeCtx();

    const res = await POST(req('read-document', { filePath: 'Notes/a.md' }), ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Could not resolve Notes/a.md');
    expect(readWithMtime).not.toHaveBeenCalled();
  });

  it('404s when the resolved file is not on disk', async () => {
    resolvePath.mockResolvedValue({ absolutePath: '/data/a.md' } as never);
    readWithMtime.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const { ctx } = makeCtx();

    const res = await POST(req('read-document', { filePath: 'Notes/a.md' }), ctx);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'File not found: Notes/a.md' });
  });

  it('500s on any other read failure', async () => {
    resolvePath.mockResolvedValue({ absolutePath: '/data/a.md' } as never);
    readWithMtime.mockRejectedValue(Object.assign(new Error('io'), { code: 'EIO' }));
    const { ctx } = makeCtx();

    const res = await POST(req('read-document', { filePath: 'Notes/a.md' }), ctx);

    expect(res.status).toBe(500);
  });

  it('500s when the read rejects with a non-Error carrying no code', async () => {
    resolvePath.mockResolvedValue({ absolutePath: '/data/a.md' } as never);
    readWithMtime.mockRejectedValue('io');
    const { ctx } = makeCtx();

    const res = await POST(req('read-document', { filePath: 'Notes/a.md' }), ctx);

    expect(res.status).toBe(500);
  });
});

// ============================================================================
// write-document
// ============================================================================

describe('POST ?action=write-document', () => {
  it('writes and returns the new mtime', async () => {
    writeDoc.mockResolvedValue({ mtime: 4242 } as never);
    const { ctx } = makeCtx();

    const res = await POST(
      req('write-document', { filePath: 'Notes/a.md', content: '# B', mtime: 4241 }),
      ctx
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, mtime: 4242 });
    expect(writeDoc).toHaveBeenCalledWith(
      expect.anything(),
      ctx.repos,
      expect.objectContaining({ filePath: 'Notes/a.md', content: '# B', mtime: 4241 })
    );
  });

  // The core translates the writers' mtime-mismatch errors into a
  // DocumentConflictError (see writeDocumentFile); the route maps the type.
  it.each([
    ['mtime mismatch', 'mtime mismatch: expected 1, found 2'],
    ['an outside edit', 'file was modified by another process'],
  ])('409s on %s', async (_label, message) => {
    writeDoc.mockRejectedValue(new DocumentConflictError(message));
    const { ctx } = makeCtx();

    const res = await POST(req('write-document', { filePath: 'Notes/a.md', content: 'x' }), ctx);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Document changed elsewhere. Reload it and try again.',
    });
  });

  it('500s on any other write failure', async () => {
    writeDoc.mockRejectedValue(new Error('disk full'));
    const { ctx } = makeCtx();

    const res = await POST(req('write-document', { filePath: 'Notes/a.md', content: 'x' }), ctx);

    expect(res.status).toBe(500);
  });
});

// ============================================================================
// rename-document
// ============================================================================

describe('POST ?action=rename-document', () => {
  it('renames the file, keeping its directory and extension', async () => {
    const { ctx } = makeCtx();

    const res = await POST(
      req('rename-document', { filePath: 'Notes/a.md', newTitle: 'Better Name' }),
      ctx
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      document: {
        filePath: 'Notes/Better Name.md',
        scope: 'general',
        mountPoint: null,
        displayTitle: 'Better Name.md',
      },
    });
    expect(renameDoc).toHaveBeenCalledWith(
      expect.anything(),
      ctx.repos,
      expect.objectContaining({ oldFilePath: 'Notes/a.md', newFilePath: 'Notes/Better Name.md' })
    );
  });

  it('keeps an explicitly typed extension', async () => {
    const { ctx } = makeCtx();

    const res = await POST(
      req('rename-document', { filePath: 'Notes/a.md', newTitle: 'notes.txt' }),
      ctx
    );
    const body = await res.json();

    expect(body.document.filePath).toBe('Notes/notes.txt');
  });

  it('repoints the recent-documents history at the new name', async () => {
    const { ctx, chatDocuments } = makeCtx();

    await POST(
      req('rename-document', {
        filePath: 'Notes/a.md',
        newTitle: 'Better Name',
        scope: 'document_store',
        mountPoint: 'Library',
      }),
      ctx
    );

    expect(chatDocuments.renameFilePathInStore).toHaveBeenCalledWith(
      'document_store',
      'Library',
      'Notes/a.md',
      'Notes/Better Name.md',
      'Better Name.md'
    );
  });

  it('succeeds even when history tracking fails after the rename landed', async () => {
    const { ctx, chatDocuments } = makeCtx();
    chatDocuments.renameFilePathInStore.mockRejectedValue(new Error('tracking table locked'));

    const res = await POST(
      req('rename-document', { filePath: 'Notes/a.md', newTitle: 'Better Name' }),
      ctx
    );

    expect(res.status).toBe(200);
  });

  it('short-circuits a rename that resolves to the same path', async () => {
    const { ctx, chatDocuments } = makeCtx();

    const res = await POST(req('rename-document', { filePath: 'Notes/a.md', newTitle: 'a' }), ctx);

    expect(res.status).toBe(200);
    expect(renameDoc).not.toHaveBeenCalled();
    expect(chatDocuments.renameFilePathInStore).not.toHaveBeenCalled();
  });

  it.each([
    ['a path separator', 'Sub/Name'],
    ['a backslash', 'Sub\\Name'],
    ['a parent traversal', '..'],
    ['whitespace only', '   '],
  ])('400s on a new title containing %s', async (_label, newTitle) => {
    const { ctx } = makeCtx();

    const res = await POST(req('rename-document', { filePath: 'Notes/a.md', newTitle }), ctx);

    expect(res.status).toBe(400);
    expect(renameDoc).not.toHaveBeenCalled();
  });

  it('409s when a file already sits at the new name', async () => {
    renameDoc.mockRejectedValue(new DocumentConflictError('exists'));
    const { ctx } = makeCtx();

    const res = await POST(req('rename-document', { filePath: 'Notes/a.md', newTitle: 'B' }), ctx);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'A file already exists at that name.' });
  });

  it('400s when the backing store cannot rename', async () => {
    renameDoc.mockRejectedValue(
      new DatabaseStoreError('This store does not support renames', 'UNSUPPORTED')
    );
    const { ctx } = makeCtx();

    const res = await POST(req('rename-document', { filePath: 'Notes/a.md', newTitle: 'B' }), ctx);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'This store does not support renames' });
  });

  it('500s on any other rename failure', async () => {
    renameDoc.mockRejectedValue(new DatabaseStoreError('gone', 'NOT_FOUND'));
    const { ctx } = makeCtx();

    const res = await POST(req('rename-document', { filePath: 'Notes/a.md', newTitle: 'B' }), ctx);

    expect(res.status).toBe(500);
  });
});

// ============================================================================
// delete-document
// ============================================================================

describe('POST ?action=delete-document', () => {
  it('deletes the underlying file', async () => {
    deleteDoc.mockResolvedValue('deleted' as never);
    const { ctx } = makeCtx();

    const res = await POST(req('delete-document', { filePath: 'Notes/a.md' }), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(deleteDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ filePath: 'Notes/a.md', scope: 'general' })
    );
  });

  it('404s when the file is already gone', async () => {
    deleteDoc.mockResolvedValue('not-found' as never);
    const { ctx } = makeCtx();

    const res = await POST(req('delete-document', { filePath: 'Notes/gone.md' }), ctx);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'File not found' });
  });

  it('400s when the target is a directory rather than a file', async () => {
    deleteDoc.mockResolvedValue('not-a-file' as never);
    const { ctx } = makeCtx();

    const res = await POST(req('delete-document', { filePath: 'Notes' }), ctx);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Path is not a file: Notes' });
  });

  it('500s when the delete throws', async () => {
    deleteDoc.mockRejectedValue(new Error('read-only mount'));
    const { ctx } = makeCtx();

    const res = await POST(req('delete-document', { filePath: 'Notes/a.md' }), ctx);

    expect(res.status).toBe(500);
  });
});
