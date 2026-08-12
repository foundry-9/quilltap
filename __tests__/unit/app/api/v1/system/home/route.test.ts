/**
 * Tests for the home dashboard payload route (GET /api/v1/system/home).
 *
 * The route is a thin wrapper: it hands the request context's repos and user
 * to the shared home-data service and wraps the result. Auth middleware is
 * stubbed; the service is mocked so no repositories are touched.
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

jest.mock('@/lib/services/home-data.service', () => ({
  getHomeData: jest.fn(),
}));

import { GET } from '@/app/api/v1/system/home/route';
import { getHomeData } from '@/lib/services/home-data.service';

const getHomeDataMock = getHomeData as jest.MockedFunction<typeof getHomeData>;

const REPOS = { chats: {}, projects: {} } as never;

function ctx(user: { id: string; name?: string | null }) {
  return { user, repos: REPOS } as never;
}

const PAYLOAD = {
  greetingName: 'Bertie',
  continueChatId: 'chat-1',
  recentChats: [],
  activeProjects: [],
  characters: [],
} as never;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/system/home', () => {
  it('returns the service payload as-is', async () => {
    getHomeDataMock.mockResolvedValue(PAYLOAD);

    const res = await GET({} as never, ctx({ id: 'user-1', name: 'Bertie' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(PAYLOAD);
  });

  it('passes the context user id and name through as the fallback name', async () => {
    getHomeDataMock.mockResolvedValue(PAYLOAD);

    await GET({} as never, ctx({ id: 'user-7', name: 'Jeeves' }));

    expect(getHomeDataMock).toHaveBeenCalledWith(REPOS, {
      userId: 'user-7',
      fallbackName: 'Jeeves',
    });
  });

  it('normalises an absent user name to null rather than undefined', async () => {
    getHomeDataMock.mockResolvedValue(PAYLOAD);

    await GET({} as never, ctx({ id: 'user-7' }));

    expect(getHomeDataMock).toHaveBeenCalledWith(REPOS, {
      userId: 'user-7',
      fallbackName: null,
    });
  });

  it('500s when the home-data service throws', async () => {
    getHomeDataMock.mockRejectedValue(new Error('repository down'));

    const res = await GET({} as never, ctx({ id: 'user-1' }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to load the home dashboard');
  });
});
