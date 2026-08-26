/**
 * Unit tests for the shared WebSocket upgrade authentication.
 *
 * This helper replaced a cookie-presence check that proved nothing, so the
 * cases below are the ones that check it actually refuses something.
 */

import type { IncomingMessage } from 'http';

import { authenticateUpgrade } from '@/lib/realtime/upgrade-auth';
import { getServerSession } from '@/lib/auth/session';
import { startupState } from '@/lib/startup/startup-state';

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('@/lib/auth/session', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/startup/startup-state', () => ({
  startupState: { isLockedMode: jest.fn() },
}));

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockIsLockedMode = startupState.isLockedMode as jest.MockedFunction<
  typeof startupState.isLockedMode
>;

function req(headers: Record<string, string | undefined> = {}): IncomingMessage {
  return { url: '/api/v1/system/realtime/stream', headers } as unknown as IncomingMessage;
}

function session() {
  return {
    user: { id: 'user-1', email: 'someone@example.test' },
    expires: new Date().toISOString(),
  };
}

describe('authenticateUpgrade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsLockedMode.mockReturnValue(false);
    mockGetServerSession.mockResolvedValue(session());
  });

  it('accepts a same-origin upgrade with a live session', async () => {
    const result = await authenticateUpgrade(
      req({ host: 'localhost:3000', origin: 'http://localhost:3000' }),
    );
    expect(result).toEqual({ ok: true, userId: 'user-1' });
  });

  it('accepts a non-browser upgrade that sends no Origin', async () => {
    const result = await authenticateUpgrade(req({ host: 'localhost:3000' }));
    expect(result.ok).toBe(true);
  });

  it('accepts the opaque null origin', async () => {
    const result = await authenticateUpgrade(req({ host: 'localhost:3000', origin: 'null' }));
    expect(result.ok).toBe(true);
  });

  it('refuses a cross-origin upgrade', async () => {
    const result = await authenticateUpgrade(
      req({ host: 'localhost:3000', origin: 'https://evil.example' }),
    );
    expect(result.ok).toBe(false);
    // Never even consults the session — the refusal is on the origin alone.
    expect(mockGetServerSession).not.toHaveBeenCalled();
  });

  it('refuses an unparseable Origin', async () => {
    const result = await authenticateUpgrade(
      req({ host: 'localhost:3000', origin: 'not a url' }),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses while the instance is locked', async () => {
    mockIsLockedMode.mockReturnValue(true);
    const result = await authenticateUpgrade(req({ host: 'localhost:3000' }));
    expect(result).toEqual({ ok: false, reason: 'instance is locked' });
  });

  it('refuses when there is no session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const result = await authenticateUpgrade(req({ host: 'localhost:3000' }));
    expect(result).toEqual({ ok: false, reason: 'no session' });
  });

  it('refuses rather than throwing when the session lookup fails', async () => {
    mockGetServerSession.mockRejectedValue(new Error('database is shut'));
    const result = await authenticateUpgrade(req({ host: 'localhost:3000' }));
    expect(result).toEqual({ ok: false, reason: 'session lookup failed' });
  });
});
