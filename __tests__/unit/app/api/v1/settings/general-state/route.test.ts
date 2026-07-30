/**
 * Tests for the instance-wide general-state settings route
 * (GET / PUT / DELETE /api/v1/settings/general-state).
 *
 * The auth middleware is stubbed to pass a fake context straight through; the
 * general-state accessor is mocked so no real mount is touched.
 */

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler:
    (handler: (req: any, ctx: any) => Promise<any>) =>
    async (req: any) => handler(req, { user: { id: 'user-1' }, repos: {} }),
}));

jest.mock('@/lib/mount-index/general-state', () => ({
  readGeneralState: jest.fn(),
  writeGeneralState: jest.fn(),
}));

import { GET, PUT, DELETE } from '@/app/api/v1/settings/general-state/route';
import { readGeneralState, writeGeneralState } from '@/lib/mount-index/general-state';

const readGeneralStateMock = readGeneralState as jest.MockedFunction<typeof readGeneralState>;
const writeGeneralStateMock = writeGeneralState as jest.MockedFunction<typeof writeGeneralState>;

function req(body?: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  writeGeneralStateMock.mockResolvedValue(undefined);
});

describe('GET', () => {
  it('returns the current general state', async () => {
    readGeneralStateMock.mockResolvedValue({ era: 'roaring' });
    const res = await GET(req());
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.state).toEqual({ era: 'roaring' });
  });
});

describe('PUT', () => {
  it('validates and writes the new state', async () => {
    const res = await PUT(req({ state: { era: 'gilded' } }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(writeGeneralStateMock).toHaveBeenCalledWith({ era: 'gilded' });
  });

  it('rejects a malformed body', async () => {
    const res = await PUT(req({ notState: true }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(writeGeneralStateMock).not.toHaveBeenCalled();
  });
});

describe('DELETE', () => {
  it('resets to {} and returns the previous state', async () => {
    readGeneralStateMock.mockResolvedValue({ era: 'roaring' });
    const res = await DELETE(req());
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.previousState).toEqual({ era: 'roaring' });
    expect(writeGeneralStateMock).toHaveBeenCalledWith({});
  });
});
