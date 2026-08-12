/**
 * Unit tests for the shared four-tier state cascade resolver.
 *
 * Strategy: mock getRepositories and readGeneralState. No real database.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/mount-index/general-state', () => ({
  readGeneralState: jest.fn(),
}));

import {
  resolveStateCascade,
  resolveGroupForContext,
  resolveGroupCandidates,
  StateGroupResolutionError,
  type GroupScope,
} from '@/lib/state/state-cascade';
import { readGeneralState } from '@/lib/mount-index/general-state';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const readGeneralStateMock = readGeneralState as jest.MockedFunction<typeof readGeneralState>;

interface Membership { groupId: string; characterId: string; }
interface FakeGroup { id: string; name: string; state?: Record<string, unknown>; }

function setupRepos(opts: {
  project?: { id: string; state?: Record<string, unknown> } | null;
  projectThrows?: boolean;
  memberships?: Record<string, Membership[]>; // by characterId
  groups?: Record<string, FakeGroup>;         // by id
  groupThrowsFor?: string[];
} = {}) {
  const memberships = opts.memberships ?? {};
  const groups = opts.groups ?? {};
  const groupThrowsFor = new Set(opts.groupThrowsFor ?? []);

  getRepositoriesMock.mockReturnValue({
    projects: {
      findById: jest.fn(async (id: string) => {
        if (opts.projectThrows) throw new Error('store unavailable');
        return opts.project && opts.project.id === id ? opts.project : null;
      }),
    },
    groupCharacterMembers: {
      findByCharacterId: jest.fn(async (characterId: string) => memberships[characterId] ?? []),
    },
    groups: {
      findById: jest.fn(async (id: string) => {
        if (groupThrowsFor.has(id)) throw new Error('group store unavailable');
        return groups[id] ?? null;
      }),
    },
  });
}

function chat(overrides: Partial<{ id: string; state: Record<string, unknown>; projectId: string; participants: unknown[] }> = {}) {
  return {
    id: 'chat-1',
    state: {},
    participants: [],
    ...overrides,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  readGeneralStateMock.mockResolvedValue({});
});

describe('resolveStateCascade — precedence', () => {
  it('merges general < group < project < chat on colliding keys', async () => {
    readGeneralStateMock.mockResolvedValue({ k: 'general', g: 1 });
    setupRepos({
      project: { id: 'p1', state: { k: 'project', p: 1 } },
      memberships: { 'char-1': [{ groupId: 'grp-1', characterId: 'char-1' }] },
      groups: { 'grp-1': { id: 'grp-1', name: 'Alpha', state: { k: 'group', gr: 1 } } },
    });

    const result = await resolveStateCascade({
      chat: chat({ projectId: 'p1', state: { k: 'chat', c: 1 } }),
      groupScope: { kind: 'character', characterId: 'char-1' },
    });

    expect(result.merged.k).toBe('chat');
    expect(result.merged).toEqual({ k: 'chat', g: 1, gr: 1, p: 1, c: 1 });
    expect(result.groupTier.status).toBe('single');
    expect(result.groupTier.appliedGroupId).toBe('grp-1');
  });
});

describe('resolveStateCascade — group tier exactly-one rule', () => {
  it('status none with zero groups', async () => {
    setupRepos({ memberships: { 'char-1': [] } });
    const result = await resolveStateCascade({
      chat: chat(),
      groupScope: { kind: 'character', characterId: 'char-1' },
    });
    expect(result.groupTier.status).toBe('none');
    expect(result.groupState).toEqual({});
  });

  it('skips the tier and reports ambiguous with two groups', async () => {
    setupRepos({
      memberships: { 'char-1': [
        { groupId: 'grp-1', characterId: 'char-1' },
        { groupId: 'grp-2', characterId: 'char-1' },
      ] },
      groups: {
        'grp-1': { id: 'grp-1', name: 'Alpha', state: { a: 1 } },
        'grp-2': { id: 'grp-2', name: 'Beta', state: { b: 2 } },
      },
    });
    const result = await resolveStateCascade({
      chat: chat(),
      groupScope: { kind: 'character', characterId: 'char-1' },
    });
    expect(result.groupTier.status).toBe('ambiguous');
    expect(result.groupTier.candidates).toHaveLength(2);
    expect(result.groupState).toEqual({});
    expect(result.merged).toEqual({});
  });
});

describe('resolveStateCascade — participants-union scope', () => {
  it('unions active character participants, skips removed / non-character, dedups', async () => {
    setupRepos({
      memberships: {
        'char-1': [{ groupId: 'grp-1', characterId: 'char-1' }],
        'char-2': [{ groupId: 'grp-1', characterId: 'char-2' }], // same group → dedup
      },
      groups: { 'grp-1': { id: 'grp-1', name: 'Alpha', state: { a: 1 } } },
    });
    const participants = [
      { type: 'CHARACTER', characterId: 'char-1', status: 'active' },
      { type: 'CHARACTER', characterId: 'char-2', status: 'active' },
      { type: 'CHARACTER', characterId: 'char-3', status: 'removed' },
      { type: 'USER', characterId: 'user-1', status: 'active' },
    ];
    const result = await resolveStateCascade({
      chat: chat({ participants }),
      groupScope: { kind: 'participants-union' },
    });
    expect(result.groupTier.status).toBe('single');
    expect(result.groupState).toEqual({ a: 1 });
  });
});

describe('resolveStateCascade — degradation', () => {
  it('degrades project tier to {} when the project read throws', async () => {
    setupRepos({ projectThrows: true });
    const result = await resolveStateCascade({
      chat: chat({ projectId: 'p1', state: { c: 1 } }),
      groupScope: { kind: 'none' },
    });
    expect(result.projectState).toEqual({});
    expect(result.merged).toEqual({ c: 1 });
  });

  it('drops a group whose store is unavailable', async () => {
    setupRepos({
      memberships: { 'char-1': [
        { groupId: 'grp-1', characterId: 'char-1' },
        { groupId: 'grp-2', characterId: 'char-1' },
      ] },
      groups: { 'grp-2': { id: 'grp-2', name: 'Beta', state: { b: 2 } } },
      groupThrowsFor: ['grp-1'],
    });
    const result = await resolveStateCascade({
      chat: chat(),
      groupScope: { kind: 'character', characterId: 'char-1' },
    });
    // grp-1 dropped → only grp-2 survives → single
    expect(result.groupTier.status).toBe('single');
    expect(result.groupState).toEqual({ b: 2 });
  });
});

describe('resolveGroupForContext', () => {
  const groups = [
    { id: 'grp-1', name: 'Alpha', state: { a: 1 } },
    { id: 'grp-2', name: 'Beta', state: { b: 2 } },
  ] as never[];

  it('NO_GROUPS when there are no candidates', () => {
    try {
      resolveGroupForContext({ candidates: [] });
      fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StateGroupResolutionError);
      expect((e as StateGroupResolutionError).code).toBe('NO_GROUPS');
    }
  });

  it('returns the sole candidate when ref omitted', () => {
    const g = resolveGroupForContext({ candidates: [groups[0]] });
    expect((g as { id: string }).id).toBe('grp-1');
  });

  it('GROUP_REF_REQUIRED when omitted with 2+ candidates', () => {
    expect(() => resolveGroupForContext({ candidates: groups }))
      .toThrow(StateGroupResolutionError);
    try {
      resolveGroupForContext({ candidates: groups });
    } catch (e) {
      expect((e as StateGroupResolutionError).code).toBe('GROUP_REF_REQUIRED');
    }
  });

  it('matches by id', () => {
    const g = resolveGroupForContext({ groupRef: 'grp-2', candidates: groups });
    expect((g as { id: string }).id).toBe('grp-2');
  });

  it('matches by case-insensitive name', () => {
    const g = resolveGroupForContext({ groupRef: 'alpha', candidates: groups });
    expect((g as { id: string }).id).toBe('grp-1');
  });

  it('GROUP_NOT_FOUND when nothing matches', () => {
    try {
      resolveGroupForContext({ groupRef: 'Zed', candidates: groups });
    } catch (e) {
      expect((e as StateGroupResolutionError).code).toBe('GROUP_NOT_FOUND');
    }
  });

  it('GROUP_AMBIGUOUS when a name matches multiple candidates', () => {
    const dup = [
      { id: 'grp-1', name: 'Alpha', state: {} },
      { id: 'grp-3', name: 'alpha', state: {} },
    ] as never[];
    try {
      resolveGroupForContext({ groupRef: 'Alpha', candidates: dup });
    } catch (e) {
      expect((e as StateGroupResolutionError).code).toBe('GROUP_AMBIGUOUS');
    }
  });
});

describe('resolveGroupCandidates', () => {
  it('returns [] for scope none', async () => {
    setupRepos({});
    const scope: GroupScope = { kind: 'none' };
    expect(await resolveGroupCandidates(chat(), scope)).toEqual([]);
  });
});
