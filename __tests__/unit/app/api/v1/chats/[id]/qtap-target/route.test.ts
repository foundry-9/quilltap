/**
 * Tests for chat-scoped qtap:// target streaming
 * (GET /api/v1/chats/:id/qtap-target).
 *
 * Path resolution and the two byte sources (mount-backed vs. filesystem) are
 * mocked; this covers the route's own work — query validation, the chat access
 * context it builds for the resolver, source dispatch, and error mapping.
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
  createAuthenticatedParamsHandler:
    (handler: (req: any, ctx: any, params: any) => Promise<any>) =>
    async (req: any, ctx: any, params: any) =>
      handler(req, ctx, params),
}));

jest.mock('@/lib/doc-edit', () => ({
  resolveDocEditPath: jest.fn(),
}));

jest.mock('@/lib/mount-index/read-file', () => ({
  readMountFileBytes: jest.fn(),
}));

jest.mock('@/lib/mount-index/path-utils', () => ({
  mimeForExtension: jest.fn(() => 'image/png'),
}));

jest.mock('fs', () => ({
  promises: { readFile: jest.fn() },
}));

import { GET } from '@/app/api/v1/chats/[id]/qtap-target/route';
import { resolveDocEditPath } from '@/lib/doc-edit';
import { readMountFileBytes } from '@/lib/mount-index/read-file';
import { mimeForExtension } from '@/lib/mount-index/path-utils';
import { promises as fs } from 'fs';

const resolvePath = resolveDocEditPath as jest.MockedFunction<typeof resolveDocEditPath>;
const readMountBytes = readMountFileBytes as jest.MockedFunction<typeof readMountFileBytes>;
const mimeFor = mimeForExtension as jest.MockedFunction<typeof mimeForExtension>;
const readFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;

const CHAT = {
  id: 'chat-1',
  projectId: 'project-9',
  participants: [{ characterId: 'char-a' }, { characterId: 'char-a' }, { characterId: null }],
};

function makeCtx(chat: unknown = CHAT) {
  return { user: { id: 'user-1' }, repos: { chats: { findById: jest.fn(async () => chat) } } } as never;
}

function req(query: Record<string, string>) {
  const url = new URL('http://localhost/api/v1/chats/chat-1/qtap-target');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return { nextUrl: url } as never;
}

const PARAMS = { id: 'chat-1' } as never;

/** A resolver result for a database-backed mount. */
function mountResolved(overrides: Record<string, unknown> = {}) {
  return { mountPointId: 'mount-1', relativePath: 'art/plate.png', ...overrides } as never;
}

/** A resolver result for an on-disk file. */
function diskResolved(overrides: Record<string, unknown> = {}) {
  return {
    mountPointId: undefined,
    relativePath: 'art/plate.png',
    absolutePath: '/data/files/art/plate.png',
    ...overrides,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mimeFor.mockReturnValue('image/png');
});

describe('GET qtap-target', () => {
  describe('query validation', () => {
    it('400s without a filePath', async () => {
      const res = await GET(req({}), makeCtx(), PARAMS);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid query');
      expect(resolvePath).not.toHaveBeenCalled();
    });

    it('400s on an empty filePath', async () => {
      const res = await GET(req({ filePath: '' }), makeCtx(), PARAMS);

      expect(res.status).toBe(400);
      expect(resolvePath).not.toHaveBeenCalled();
    });

    it('400s on a scope outside the allowed set', async () => {
      const res = await GET(req({ filePath: 'a.png', scope: 'wherever' }), makeCtx(), PARAMS);

      expect(res.status).toBe(400);
      expect(resolvePath).not.toHaveBeenCalled();
    });

    it('defaults the scope to project', async () => {
      resolvePath.mockResolvedValue(mountResolved());
      readMountBytes.mockResolvedValue({ bytes: Buffer.from('x'), mimeType: 'image/png' } as never);

      await GET(req({ filePath: 'art/plate.png' }), makeCtx(), PARAMS);

      expect(resolvePath).toHaveBeenCalledWith('project', 'art/plate.png', expect.anything());
    });

    it.each(['project', 'document_store', 'general'])('accepts the %s scope', async (scope) => {
      resolvePath.mockResolvedValue(mountResolved());
      readMountBytes.mockResolvedValue({ bytes: Buffer.from('x'), mimeType: 'image/png' } as never);

      const res = await GET(req({ filePath: 'a.png', scope }), makeCtx(), PARAMS);

      expect(res.status).toBe(200);
      expect(resolvePath).toHaveBeenCalledWith(scope, 'a.png', expect.anything());
    });
  });

  it('400s when the chat does not exist', async () => {
    const res = await GET(req({ filePath: 'a.png' }), makeCtx(null), PARAMS);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Chat not found' });
    expect(resolvePath).not.toHaveBeenCalled();
  });

  it("builds the resolver context from the chat's project and deduped participants", async () => {
    resolvePath.mockResolvedValue(mountResolved());
    readMountBytes.mockResolvedValue({ bytes: Buffer.from('x'), mimeType: 'image/png' } as never);

    await GET(req({ filePath: 'a.png', mountPoint: 'Library' }), makeCtx(), PARAMS);

    expect(resolvePath).toHaveBeenCalledWith('project', 'a.png', {
      projectId: 'project-9',
      characterIds: ['char-a'],
      mountPoint: 'Library',
      operatorOverride: true,
    });
  });

  it('tolerates a chat with no participants array', async () => {
    resolvePath.mockResolvedValue(mountResolved());
    readMountBytes.mockResolvedValue({ bytes: Buffer.from('x'), mimeType: 'image/png' } as never);

    await GET(req({ filePath: 'a.png' }), makeCtx({ id: 'chat-1' }), PARAMS);

    expect(resolvePath).toHaveBeenCalledWith(
      'project',
      'a.png',
      expect.objectContaining({ projectId: undefined, characterIds: [] })
    );
  });

  it('streams mount-backed bytes with the mount-reported mime type', async () => {
    resolvePath.mockResolvedValue(mountResolved());
    readMountBytes.mockResolvedValue({
      bytes: Buffer.from([1, 2, 3, 4]),
      mimeType: 'image/webp',
    } as never);

    const res = await GET(req({ filePath: 'art/plate.png' }), makeCtx(), PARAMS);

    expect(res.status).toBe(200);
    expect(readMountBytes).toHaveBeenCalledWith('mount-1', 'art/plate.png');
    expect(readFile).not.toHaveBeenCalled();
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(res.headers.get('Content-Length')).toBe('4');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(Array.from(res.body as Uint8Array)).toEqual([1, 2, 3, 4]);
  });

  it('streams on-disk bytes with a mime type derived from the extension', async () => {
    resolvePath.mockResolvedValue(diskResolved());
    readFile.mockResolvedValue(Buffer.from([9, 9]) as never);
    mimeFor.mockReturnValue('image/jpeg');

    const res = await GET(req({ filePath: 'art/plate.png' }), makeCtx(), PARAMS);

    expect(res.status).toBe(200);
    expect(readFile).toHaveBeenCalledWith('/data/files/art/plate.png');
    expect(readMountBytes).not.toHaveBeenCalled();
    expect(mimeFor).toHaveBeenCalledWith('art/plate.png');
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Content-Length')).toBe('2');
  });

  describe('error mapping', () => {
    it('404s when the on-disk file is absent (ENOENT)', async () => {
      resolvePath.mockResolvedValue(diskResolved());
      const err = Object.assign(new Error('no such file'), { code: 'ENOENT' });
      readFile.mockRejectedValue(err);

      const res = await GET(req({ filePath: 'gone.png' }), makeCtx(), PARAMS);

      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: 'File not found' });
    });

    it('404s when the resolver reports SOURCE_NOT_FOUND', async () => {
      const err = Object.assign(new Error('source missing'), { code: 'SOURCE_NOT_FOUND' });
      resolvePath.mockRejectedValue(err);

      const res = await GET(req({ filePath: 'gone.png' }), makeCtx(), PARAMS);

      expect(res.status).toBe(404);
    });

    it('500s on any other failure', async () => {
      resolvePath.mockRejectedValue(new Error('mount index unreadable'));

      const res = await GET(req({ filePath: 'a.png' }), makeCtx(), PARAMS);

      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toEqual({ error: 'Failed to stream qtap target' });
    });

    it('500s when the resolver rejects with a non-Error', async () => {
      resolvePath.mockRejectedValue('mount index unreadable');

      const res = await GET(req({ filePath: 'a.png' }), makeCtx(), PARAMS);

      expect(res.status).toBe(500);
    });

    it('500s when the mount read fails for a non-missing-file reason', async () => {
      resolvePath.mockResolvedValue(mountResolved());
      readMountBytes.mockRejectedValue(new Error('blob decode failed'));

      const res = await GET(req({ filePath: 'a.png' }), makeCtx(), PARAMS);

      expect(res.status).toBe(500);
    });
  });
});
