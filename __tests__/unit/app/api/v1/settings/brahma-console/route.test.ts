/**
 * Tests for the instance-wide Brahma Console settings route
 * (GET / PUT /api/v1/settings/brahma-console).
 *
 * The accessors are mocked so no instance_settings row is touched, but the REAL
 * `BrahmaConsoleSettingsSchema` runs — PUT's contract is that it merges the body
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
  getBrahmaConsoleSettings: jest.fn(),
  setBrahmaConsoleSettings: jest.fn(),
  BrahmaConsoleSettingsSchema:
    jest.requireActual('@/lib/schemas/settings.types').BrahmaConsoleSettingsSchema,
}));

import { GET, PUT } from '@/app/api/v1/settings/brahma-console/route';
import { getBrahmaConsoleSettings, setBrahmaConsoleSettings } from '@/lib/instance-settings';

const getSettings = getBrahmaConsoleSettings as jest.MockedFunction<typeof getBrahmaConsoleSettings>;
const setSettings = setBrahmaConsoleSettings as jest.MockedFunction<typeof setBrahmaConsoleSettings>;

function req(body?: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  getSettings.mockResolvedValue({ maxAgentTurns: 50 });
  setSettings.mockResolvedValue(undefined);
});

describe('GET', () => {
  it('returns the current turn budget', async () => {
    const res = await GET({} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ maxAgentTurns: 50 });
  });

  it('500s when the accessor throws', async () => {
    getSettings.mockRejectedValue(new Error('settings db unreadable'));

    const res = await GET({} as never);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Failed to fetch brahma-console settings',
    });
  });
});

describe('PUT', () => {
  it('persists a valid budget and echoes it back', async () => {
    const res = await PUT(req({ maxAgentTurns: 80 }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ maxAgentTurns: 80 });
    expect(setSettings).toHaveBeenCalledWith({ maxAgentTurns: 80 });
  });

  it('merges the body over the current settings rather than replacing them', async () => {
    // An empty body must not wipe the stored value back to the schema default.
    getSettings.mockResolvedValue({ maxAgentTurns: 120 });

    const res = await PUT(req({}));

    await expect(res.json()).resolves.toEqual({ maxAgentTurns: 120 });
    expect(setSettings).toHaveBeenCalledWith({ maxAgentTurns: 120 });
  });

  it.each([
    ['below the minimum', 4],
    ['above the maximum', 201],
    ['not an integer', 12.5],
    ['not a number', 'fifty'],
  ])('rejects a budget %s without writing', async (_label, maxAgentTurns) => {
    const res = await PUT(req({ maxAgentTurns }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation error');
    expect(setSettings).not.toHaveBeenCalled();
  });

  it('accepts the boundary values', async () => {
    await PUT(req({ maxAgentTurns: 5 }));
    await PUT(req({ maxAgentTurns: 200 }));

    expect(setSettings).toHaveBeenNthCalledWith(1, { maxAgentTurns: 5 });
    expect(setSettings).toHaveBeenNthCalledWith(2, { maxAgentTurns: 200 });
  });

  it('500s when the write throws', async () => {
    setSettings.mockRejectedValue(new Error('locked'));

    const res = await PUT(req({ maxAgentTurns: 60 }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Failed to update brahma-console settings',
    });
  });

  it('500s on a malformed request body', async () => {
    const res = await PUT({ json: async () => { throw new SyntaxError('bad json'); } } as never);

    expect(res.status).toBe(500);
    expect(setSettings).not.toHaveBeenCalled();
  });
});
