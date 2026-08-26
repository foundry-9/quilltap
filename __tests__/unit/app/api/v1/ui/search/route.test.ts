/**
 * Tests for the global search route (GET /api/v1/ui/search).
 *
 * Covers the new `documents` branch end to end — result shape, the standalone
 * deep link it hands out, counts, and the skip-when-unrequested rule — plus
 * the response contract the search UI has always depended on (types filter,
 * ranking, pagination, the 2-character floor), which had no coverage before.
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

jest.mock('@/lib/mount-index/document-text-search', () => ({
  searchDocumentText: jest.fn(),
}));

import { GET } from '@/app/api/v1/ui/search/route';
import { searchDocumentText } from '@/lib/mount-index/document-text-search';
import type { SearchResponse } from '@/components/search/types';

const documentSearch = searchDocumentText as jest.MockedFunction<typeof searchDocumentText>;

function documentMatch(overrides: Record<string, unknown> = {}) {
  return {
    linkId: 'link-1',
    mountPointId: 'mp-1',
    mountPointName: 'Library',
    mountPointRef: 'Library',
    storeType: 'documents' as const,
    relativePath: 'Notes/manifesto.md',
    fileName: 'manifesto.md',
    matchedField: 'fileName' as const,
    matchedValue: 'manifesto.md',
    snippet: 'Notes/manifesto.md',
    matchPriority: 1 as const,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  const repos = {
    characters: { findByUserId: jest.fn(async () => [] as unknown[]) },
    chats: {
      findByUserId: jest.fn(async () => [] as unknown[]),
      searchMessagesGlobal: jest.fn(async () => [] as unknown[]),
    },
    memories: { searchByContent: jest.fn(async () => [] as unknown[]) },
    tags: { findByUserId: jest.fn(async () => [] as unknown[]) },
    ...overrides,
  };
  return { ctx: { user: { id: 'user-1' }, repos } as never, repos };
}

function req(params: Record<string, string>) {
  const url = new URL('http://localhost/api/v1/ui/search');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { nextUrl: url } as never;
}

async function body(res: { json: () => Promise<unknown> }): Promise<SearchResponse> {
  return (await res.json()) as SearchResponse;
}

beforeEach(() => {
  jest.clearAllMocks();
  documentSearch.mockResolvedValue({ results: [], totalCount: 0 });
});

// ============================================================================
// Request validation
// ============================================================================

describe('query validation', () => {
  it('400s without a query', async () => {
    const { ctx } = makeCtx();
    const res = await GET(req({}), ctx);
    expect(res.status).toBe(400);
  });

  it('400s on a one-character query', async () => {
    const { ctx } = makeCtx();
    const res = await GET(req({ q: 'a' }), ctx);
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// The documents branch
// ============================================================================

describe('documents branch', () => {
  it('returns a document result with a chat-free standalone deep link', async () => {
    documentSearch.mockResolvedValue({ results: [documentMatch()], totalCount: 1 });
    const { ctx } = makeCtx();

    const res = await GET(req({ q: 'manifesto', types: 'documents' }), ctx);
    const data = await body(res);

    expect(res.status).toBe(200);
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      id: 'link-1',
      type: 'documents',
      name: 'manifesto.md',
      matchedField: 'fileName',
      mountPointId: 'mp-1',
      mountPointName: 'Library',
      mountPointRef: 'Library',
      storeType: 'documents',
      relativePath: 'Notes/manifesto.md',
      matchPriority: 1,
    });
    expect(data.results[0].url).toBe(
      '/workspace?open=document-standalone&scope=document_store' +
        '&mountPoint=Library&filePath=Notes%2Fmanifesto.md'
    );
    expect(data.types).toEqual(['documents']);
    expect(data.countsByType).toEqual({ documents: 1 });
  });

  it('percent-encodes a store reference and path that need it', async () => {
    documentSearch.mockResolvedValue({
      results: [
        documentMatch({ mountPointRef: 'Ada & Co', relativePath: 'Notes/a b?.md' }),
      ],
      totalCount: 1,
    });
    const { ctx } = makeCtx();

    const data = await body(await GET(req({ q: 'manifesto', types: 'documents' }), ctx));

    expect(data.results[0].url).toContain('mountPoint=Ada%20%26%20Co');
    expect(data.results[0].url).toContain('filePath=Notes%2Fa%20b%3F.md');
  });

  it('skips the branch entirely when documents are not requested', async () => {
    const { ctx } = makeCtx();

    await GET(req({ q: 'manifesto', types: 'chats,characters' }), ctx);

    expect(documentSearch).not.toHaveBeenCalled();
  });

  it('searches documents when no types filter is given', async () => {
    const { ctx } = makeCtx();

    await GET(req({ q: 'manifesto' }), ctx);

    expect(documentSearch).toHaveBeenCalledWith('manifesto', { limit: 100 });
  });

  it('ignores unknown type names and falls back to every type', async () => {
    const { ctx } = makeCtx();

    await GET(req({ q: 'manifesto', types: 'sausages' }), ctx);

    expect(documentSearch).toHaveBeenCalled();
  });

  it('reports no documents type when nothing matched', async () => {
    const { ctx } = makeCtx();

    const data = await body(await GET(req({ q: 'manifesto', types: 'documents' }), ctx));

    expect(data.results).toEqual([]);
    expect(data.types).toEqual([]);
    expect(data.countsByType).toEqual({});
    expect(data.hasMore).toBe(false);
  });

  it('500s when the document search blows up', async () => {
    documentSearch.mockRejectedValue(new Error('mount index unreadable'));
    const { ctx } = makeCtx();

    const res = await GET(req({ q: 'manifesto', types: 'documents' }), ctx);

    expect(res.status).toBe(500);
  });
});

// ============================================================================
// Cross-type ranking and pagination
// ============================================================================

describe('ranking and pagination', () => {
  it('sorts by match priority, then recency, across types', async () => {
    documentSearch.mockResolvedValue({
      results: [
        documentMatch({ linkId: 'doc-exact', matchPriority: 0 }),
        documentMatch({ linkId: 'doc-substring', matchPriority: 1 }),
      ],
      totalCount: 2,
    });
    const { ctx } = makeCtx({
      chats: {
        findByUserId: jest.fn(async () => [
          {
            id: 'chat-1',
            title: 'A manifesto of sorts',
            updatedAt: '2026-08-24T00:00:00.000Z',
            participants: [],
          },
        ]),
        searchMessagesGlobal: jest.fn(async () => []),
      },
    });

    const data = await body(await GET(req({ q: 'manifesto', types: 'documents,chats' }), ctx));

    expect(data.results.map((r) => r.id)).toEqual(['doc-exact', 'chat-1', 'doc-substring']);
    expect(data.countsByType).toEqual({ documents: 2, chats: 1 });
  });

  it('paginates the merged result set and reports hasMore', async () => {
    documentSearch.mockResolvedValue({
      results: [
        documentMatch({ linkId: 'a', updatedAt: '2026-08-03T00:00:00.000Z' }),
        documentMatch({ linkId: 'b', updatedAt: '2026-08-02T00:00:00.000Z' }),
        documentMatch({ linkId: 'c', updatedAt: '2026-08-01T00:00:00.000Z' }),
      ],
      totalCount: 3,
    });
    const { ctx } = makeCtx();

    const first = await body(
      await GET(req({ q: 'manifesto', types: 'documents', limit: '2', offset: '0' }), ctx)
    );
    expect(first.results.map((r) => r.id)).toEqual(['a', 'b']);
    expect(first.totalCount).toBe(3);
    expect(first.hasMore).toBe(true);
    // Counts are computed before the slice, so the chip still shows the total.
    expect(first.countsByType).toEqual({ documents: 3 });

    const second = await body(
      await GET(req({ q: 'manifesto', types: 'documents', limit: '2', offset: '2' }), ctx)
    );
    expect(second.results.map((r) => r.id)).toEqual(['c']);
    expect(second.hasMore).toBe(false);
  });
});
