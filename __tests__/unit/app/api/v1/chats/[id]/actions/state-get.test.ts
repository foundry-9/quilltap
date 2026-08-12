/**
 * Tests for chat get-state over the four-tier cascade.
 *
 * `handleGetState` fetches the chat via the request context repos, then hands
 * it to `resolveStateCascade` (which reaches the global repository factory for
 * project/group reads and `readGeneralState` for the general tier). Project
 * state is a secondary enrichment: `repos.projects.findById` throwing
 * `ProjectStoreUnavailableError` must NOT take down the chat's own read.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/mount-index/general-state', () => ({
  readGeneralState: jest.fn(),
}));

import { handleGetState } from '@/app/api/v1/chats/[id]/actions/state';
import { ProjectStoreUnavailableError } from '@/lib/projects/project-store/schema';
import { readGeneralState } from '@/lib/mount-index/general-state';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const readGeneralStateMock = readGeneralState as jest.MockedFunction<typeof readGeneralState>;

interface FakeGroup { id: string; name: string; state?: Record<string, unknown>; }

function makeCtx(chat: Record<string, unknown> | null) {
  return {
    user: { id: 'user-1' },
    repos: {
      chats: { findById: jest.fn(async () => chat) },
    },
  } as never;
}

function setupFactory(opts: {
  projectFindById?: () => Promise<unknown>;
  memberships?: Record<string, Array<{ groupId: string }>>;
  groups?: Record<string, FakeGroup>;
} = {}) {
  const memberships = opts.memberships ?? {};
  const groups = opts.groups ?? {};
  getRepositoriesMock.mockReturnValue({
    projects: { findById: jest.fn(opts.projectFindById ?? (async () => null)) },
    groupCharacterMembers: {
      findByCharacterId: jest.fn(async (id: string) =>
        (memberships[id] ?? []).map((m) => ({ ...m, characterId: id })),
      ),
    },
    groups: { findById: jest.fn(async (id: string) => groups[id] ?? null) },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  readGeneralStateMock.mockResolvedValue({});
});

describe('handleGetState — project-store resilience', () => {
  it('returns chat state even when the project store is unavailable', async () => {
    setupFactory({
      projectFindById: async () => {
        throw new ProjectStoreUnavailableError('proj-1', null, 'properties.json missing');
      },
    });
    const ctx = makeCtx({ id: 'chat-1', projectId: 'proj-1', state: { hp: 10 }, participants: [] });

    const res = await handleGetState('chat-1', ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.chatState).toEqual({ hp: 10 });
    expect(body.state).toEqual({ hp: 10 });
    expect(body.projectState).toBeUndefined();
  });

  it('merges project state when the store is healthy (chat wins)', async () => {
    setupFactory({ projectFindById: async () => ({ id: 'proj-1', state: { gold: 5, hp: 1 } }) });
    const ctx = makeCtx({ id: 'chat-1', projectId: 'proj-1', state: { hp: 10 }, participants: [] });

    const res = await handleGetState('chat-1', ctx);
    const body = await res.json();
    expect(body.state).toEqual({ gold: 5, hp: 10 });
    expect(body.projectState).toEqual({ gold: 5, hp: 1 });
  });

  it('returns 404 when the chat itself is missing', async () => {
    setupFactory();
    const res = await handleGetState('chat-1', makeCtx(null));
    expect(res.status).toBe(404);
  });
});

describe('handleGetState — new cascade fields', () => {
  it('exposes generalState and a group tier; general is the weakest layer', async () => {
    readGeneralStateMock.mockResolvedValue({ era: 'roaring', hp: 0 });
    setupFactory({
      memberships: { 'char-1': [{ groupId: 'g1' }] },
      groups: { g1: { id: 'g1', name: 'Alpha', state: { weather: 'foggy' } } },
    });
    const ctx = makeCtx({
      id: 'chat-1',
      state: { hp: 10 },
      participants: [{ type: 'CHARACTER', characterId: 'char-1', status: 'active' }],
    });

    const res = await handleGetState('chat-1', ctx);
    const body = await res.json();
    expect(body.state).toEqual({ era: 'roaring', hp: 10, weather: 'foggy' });
    expect(body.generalState).toEqual({ era: 'roaring', hp: 0 });
    expect(body.groupState).toEqual({ weather: 'foggy' });
    expect(body.groupTier.status).toBe('single');
    expect(body.groupTier.appliedGroupId).toBe('g1');
  });

  it('reports ambiguous and omits groupState when two groups apply', async () => {
    setupFactory({
      memberships: { 'char-1': [{ groupId: 'g1' }, { groupId: 'g2' }] },
      groups: {
        g1: { id: 'g1', name: 'Alpha', state: { weather: 'foggy' } },
        g2: { id: 'g2', name: 'Beta', state: { weather: 'clear' } },
      },
    });
    const ctx = makeCtx({
      id: 'chat-1',
      state: {},
      participants: [{ type: 'CHARACTER', characterId: 'char-1', status: 'active' }],
    });

    const res = await handleGetState('chat-1', ctx);
    const body = await res.json();
    expect(body.groupTier.status).toBe('ambiguous');
    expect(body.groupTier.candidates).toHaveLength(2);
    expect(body.groupState).toBeUndefined();
    expect(body.state).toEqual({});
  });
});
