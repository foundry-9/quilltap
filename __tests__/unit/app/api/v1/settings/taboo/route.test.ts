/**
 * Tests for the instance-wide Taboo settings route
 * (GET / PUT /api/v1/settings/taboo).
 *
 * The accessors are mocked so no instance_settings row is touched, but the REAL
 * `TabooSettingsSchema` runs — PUT's contract is that it merges the body over
 * the current settings and validates the result, so the schema is the part
 * worth exercising. The normalization contract (what the response echoes) is
 * covered in the accessor suite; here the setter is a stub and the route is
 * only asked to hand its return value back.
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
  getTabooSettings: jest.fn(),
  setTabooSettings: jest.fn(),
  TabooSettingsSchema:
    jest.requireActual('@/lib/schemas/settings.types').TabooSettingsSchema,
}));

import { GET, PUT } from '@/app/api/v1/settings/taboo/route';
import { getTabooSettings, setTabooSettings } from '@/lib/instance-settings';

const getSettings = getTabooSettings as jest.MockedFunction<typeof getTabooSettings>;
const setSettings = setTabooSettings as jest.MockedFunction<typeof setTabooSettings>;

function req(body?: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  getSettings.mockResolvedValue({ phrases: [] });
  // Stand in for the real setter, which stores and returns the normalized list.
  setSettings.mockImplementation(async (value) => value);
});

describe('GET', () => {
  it('returns an empty list when nothing is forbidden', async () => {
    const res = await GET({} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ phrases: [] });
  });

  it('returns the stored list', async () => {
    getSettings.mockResolvedValue({ phrases: ["that's not nothing"] });

    const res = await GET({} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ phrases: ["that's not nothing"] });
  });

  it('500s when the accessor throws', async () => {
    getSettings.mockRejectedValue(new Error('settings db unreadable'));

    const res = await GET({} as never);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to fetch taboo settings' });
  });

  it('500s when the accessor rejects with a non-Error', async () => {
    getSettings.mockRejectedValue('unreadable');

    const res = await GET({} as never);

    expect(res.status).toBe(500);
  });
});

describe('PUT', () => {
  it('persists a valid list and echoes back what was stored', async () => {
    const phrases = ["that's not nothing", 'weight-bearing'];

    const res = await PUT(req({ phrases }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ phrases });
    expect(setSettings).toHaveBeenCalledWith({ phrases });
  });

  it('echoes the NORMALIZED list the setter stored, not the submitted one', async () => {
    setSettings.mockResolvedValue({ phrases: ['weight-bearing'] });

    const res = await PUT(req({ phrases: ['weight-bearing', 'WEIGHT-BEARING'] }));

    await expect(res.json()).resolves.toEqual({ phrases: ['weight-bearing'] });
  });

  it('merges the body over the current settings rather than replacing them', async () => {
    // An empty body must not wipe the stored list.
    getSettings.mockResolvedValue({ phrases: ['weight-bearing'] });

    const res = await PUT(req({}));

    await expect(res.json()).resolves.toEqual({ phrases: ['weight-bearing'] });
    expect(setSettings).toHaveBeenCalledWith({ phrases: ['weight-bearing'] });
  });

  it('clears the list when handed an explicit empty array', async () => {
    getSettings.mockResolvedValue({ phrases: ['weight-bearing'] });

    const res = await PUT(req({ phrases: [] }));

    await expect(res.json()).resolves.toEqual({ phrases: [] });
    expect(setSettings).toHaveBeenCalledWith({ phrases: [] });
  });

  it('trims phrases through the schema before they reach the setter', async () => {
    await PUT(req({ phrases: ['  weight-bearing  '] }));

    expect(setSettings).toHaveBeenCalledWith({ phrases: ['weight-bearing'] });
  });

  it.each([
    ['not an array', 'weight-bearing'],
    ['a non-string entry', [42]],
    ['a whitespace-only entry', ['   ']],
    ['an over-long entry', ['x'.repeat(201)]],
    ['more than 500 entries', Array.from({ length: 501 }, (_, i) => `phrase ${i}`)],
  ])('rejects %s without writing', async (_label, phrases) => {
    const res = await PUT(req({ phrases }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation error');
    expect(setSettings).not.toHaveBeenCalled();
  });

  it('accepts the boundary sizes', async () => {
    await PUT(req({ phrases: ['x'.repeat(200)] }));
    await PUT(req({ phrases: Array.from({ length: 500 }, (_, i) => `phrase ${i}`) }));

    expect(setSettings).toHaveBeenNthCalledWith(1, { phrases: ['x'.repeat(200)] });
    expect(setSettings.mock.calls[1][0].phrases).toHaveLength(500);
  });

  it('500s when the write throws', async () => {
    setSettings.mockRejectedValue(new Error('locked'));

    const res = await PUT(req({ phrases: ['weight-bearing'] }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to update taboo settings' });
  });

  it('500s when the write rejects with a non-Error', async () => {
    setSettings.mockRejectedValue('locked');

    const res = await PUT(req({ phrases: ['weight-bearing'] }));

    expect(res.status).toBe(500);
  });

  it('500s on a malformed request body', async () => {
    const res = await PUT({ json: async () => { throw new SyntaxError('bad json'); } } as never);

    expect(res.status).toBe(500);
    expect(setSettings).not.toHaveBeenCalled();
  });
});
