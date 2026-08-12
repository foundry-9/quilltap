/**
 * Tests for the instance-wide data-retention settings route
 * (GET / PUT /api/v1/settings/data-retention).
 *
 * The accessors are mocked so no instance_settings row is touched, but the REAL
 * `DataRetentionSettingsSchema` runs — PUT's contract is that it merges the body
 * over the current settings and validates the result, so the schema is the part
 * worth exercising.
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
    async (req: any) =>
      handler(req, { user: { id: 'user-1' }, repos: {} }),
}));

jest.mock('@/lib/instance-settings', () => ({
  getDataRetentionSettings: jest.fn(),
  setDataRetentionSettings: jest.fn(),
  DataRetentionSettingsSchema:
    jest.requireActual('@/lib/schemas/settings.types').DataRetentionSettingsSchema,
}));

import { GET, PUT } from '@/app/api/v1/settings/data-retention/route';
import { getDataRetentionSettings, setDataRetentionSettings } from '@/lib/instance-settings';

const getSettings = getDataRetentionSettings as jest.MockedFunction<typeof getDataRetentionSettings>;
const setSettings = setDataRetentionSettings as jest.MockedFunction<typeof setDataRetentionSettings>;

function req(body?: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  getSettings.mockResolvedValue({ staleChatDays: 30 });
  setSettings.mockResolvedValue(undefined);
});

describe('GET', () => {
  it('returns the current retention window', async () => {
    const res = await GET({} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ staleChatDays: 30 });
  });

  it('500s when the accessor throws', async () => {
    getSettings.mockRejectedValue(new Error('settings db unreadable'));

    const res = await GET({} as never);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Failed to fetch data-retention settings',
    });
  });

  it('500s when the accessor rejects with a non-Error', async () => {
    getSettings.mockRejectedValue('unreadable');

    const res = await GET({} as never);

    expect(res.status).toBe(500);
  });
});

describe('PUT', () => {
  it('persists a valid window and echoes it back', async () => {
    const res = await PUT(req({ staleChatDays: 90 }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ staleChatDays: 90 });
    expect(setSettings).toHaveBeenCalledWith({ staleChatDays: 90 });
  });

  it('merges the body over the current settings rather than replacing them', async () => {
    // An empty body must not wipe the stored value back to the schema default.
    getSettings.mockResolvedValue({ staleChatDays: 120 });

    const res = await PUT(req({}));

    await expect(res.json()).resolves.toEqual({ staleChatDays: 120 });
    expect(setSettings).toHaveBeenCalledWith({ staleChatDays: 120 });
  });

  it.each([
    ['below the minimum', 0],
    ['above the maximum', 3651],
    ['not an integer', 12.5],
    ['not a number', 'thirty'],
  ])('rejects a window %s without writing', async (_label, staleChatDays) => {
    const res = await PUT(req({ staleChatDays }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation error');
    expect(setSettings).not.toHaveBeenCalled();
  });

  it('accepts the boundary values', async () => {
    await PUT(req({ staleChatDays: 1 }));
    await PUT(req({ staleChatDays: 3650 }));

    expect(setSettings).toHaveBeenNthCalledWith(1, { staleChatDays: 1 });
    expect(setSettings).toHaveBeenNthCalledWith(2, { staleChatDays: 3650 });
  });

  it('500s when the write throws', async () => {
    setSettings.mockRejectedValue(new Error('locked'));

    const res = await PUT(req({ staleChatDays: 45 }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Failed to update data-retention settings',
    });
  });

  it('500s when the write rejects with a non-Error', async () => {
    setSettings.mockRejectedValue('locked');

    const res = await PUT(req({ staleChatDays: 45 }));

    expect(res.status).toBe(500);
  });

  it('500s on a malformed request body', async () => {
    const res = await PUT({ json: async () => { throw new SyntaxError('bad json'); } } as never);

    expect(res.status).toBe(500);
    expect(setSettings).not.toHaveBeenCalled();
  });
});
