/**
 * Unit tests for the state tool handler over the four-tier cascade.
 *
 * Strategy: mock the repository factory and the general-state accessor; let the
 * real cascade resolver run so precedence and group resolution are exercised
 * end-to-end. No real database.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/mount-index/general-state', () => ({
  readGeneralState: jest.fn(),
  writeGeneralState: jest.fn(),
}));

import { executeStateTool } from '@/lib/tools/handlers/state-handler';
import { readGeneralState, writeGeneralState } from '@/lib/mount-index/general-state';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const readGeneralStateMock = readGeneralState as jest.MockedFunction<typeof readGeneralState>;
const writeGeneralStateMock = writeGeneralState as jest.MockedFunction<typeof writeGeneralState>;

const USER = 'user-1';
const CHAT = 'chat-1';
const CHAR = 'char-1';

interface FakeGroup { id: string; name: string; state?: Record<string, unknown>; }

function setup(opts: {
  chatState?: Record<string, unknown>;
  projectId?: string;
  projectState?: Record<string, unknown>;
  memberships?: Array<{ groupId: string }>; // for CHAR
  groups?: Record<string, FakeGroup>;
} = {}) {
  const chat = {
    id: CHAT,
    userId: USER,
    state: opts.chatState ?? {},
    projectId: opts.projectId,
    participants: [{ type: 'CHARACTER', characterId: CHAR, status: 'active' }],
  };
  const groups: Record<string, FakeGroup> = opts.groups ?? {};
  const groupUpdate = jest.fn(async (id: string, data: { state: Record<string, unknown> }) => {
    if (groups[id]) groups[id].state = data.state;
    return groups[id];
  });
  const chatUpdate = jest.fn(async (_id: string, data: { state: Record<string, unknown> }) => {
    chat.state = data.state;
    return chat;
  });

  getRepositoriesMock.mockReturnValue({
    chats: { findById: jest.fn(async () => chat), update: chatUpdate },
    projects: {
      findById: jest.fn(async (id: string) =>
        opts.projectId && id === opts.projectId ? { id, state: opts.projectState ?? {} } : null,
      ),
      update: jest.fn(),
    },
    groupCharacterMembers: {
      findByCharacterId: jest.fn(async (characterId: string) =>
        characterId === CHAR ? (opts.memberships ?? []).map((m) => ({ ...m, characterId })) : [],
      ),
    },
    groups: {
      findById: jest.fn(async (id: string) => groups[id] ?? null),
      update: groupUpdate,
    },
  });

  return { chat, groups, groupUpdate, chatUpdate };
}

beforeEach(() => {
  jest.clearAllMocks();
  readGeneralStateMock.mockResolvedValue({});
  writeGeneralStateMock.mockResolvedValue(undefined);
});

describe('merged fetch (no context)', () => {
  it('0 groups — merges chat over project over general', async () => {
    readGeneralStateMock.mockResolvedValue({ k: 'general' });
    setup({ chatState: { k: 'chat' }, projectId: 'p1', projectState: { k: 'project', p: 1 } });
    const out = await executeStateTool(
      { operation: 'fetch', path: 'k' },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(out.success).toBe(true);
    expect(out.value).toBe('chat');
  });

  it('1 group — group tier participates', async () => {
    setup({
      chatState: {},
      memberships: [{ groupId: 'g1' }],
      groups: { g1: { id: 'g1', name: 'Alpha', state: { weather: 'foggy' } } },
    });
    const out = await executeStateTool(
      { operation: 'fetch', path: 'weather' },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(out.value).toBe('foggy');
  });

  it('2 groups — group tier skipped in merged view', async () => {
    setup({
      memberships: [{ groupId: 'g1' }, { groupId: 'g2' }],
      groups: {
        g1: { id: 'g1', name: 'Alpha', state: { weather: 'foggy' } },
        g2: { id: 'g2', name: 'Beta', state: { weather: 'clear' } },
      },
    });
    const out = await executeStateTool(
      { operation: 'fetch', path: 'weather' },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(out.value).toBeUndefined();
  });
});

describe('explicit group context', () => {
  it('reads the sole group when ref omitted', async () => {
    setup({
      memberships: [{ groupId: 'g1' }],
      groups: { g1: { id: 'g1', name: 'Alpha', state: { hp: 5 } } },
    });
    const out = await executeStateTool(
      { operation: 'fetch', context: 'group', path: 'hp' },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(out.value).toBe(5);
  });

  it('reads by group id', async () => {
    setup({
      memberships: [{ groupId: 'g1' }, { groupId: 'g2' }],
      groups: {
        g1: { id: 'g1', name: 'Alpha', state: { hp: 1 } },
        g2: { id: 'g2', name: 'Beta', state: { hp: 2 } },
      },
    });
    const out = await executeStateTool(
      { operation: 'fetch', context: 'group', group: 'g2', path: 'hp' },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(out.value).toBe(2);
  });

  it('reads by group name (case-insensitive)', async () => {
    setup({
      memberships: [{ groupId: 'g1' }, { groupId: 'g2' }],
      groups: {
        g1: { id: 'g1', name: 'Alpha', state: { hp: 1 } },
        g2: { id: 'g2', name: 'Beta', state: { hp: 2 } },
      },
    });
    const out = await executeStateTool(
      { operation: 'fetch', context: 'group', group: 'beta', path: 'hp' },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(out.value).toBe(2);
  });

  it('returns a helpful error when ambiguous (ref omitted, 2 groups)', async () => {
    setup({
      memberships: [{ groupId: 'g1' }, { groupId: 'g2' }],
      groups: {
        g1: { id: 'g1', name: 'Alpha', state: {} },
        g2: { id: 'g2', name: 'Beta', state: {} },
      },
    });
    const out = await executeStateTool(
      { operation: 'fetch', context: 'group', path: 'hp' },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(out.success).toBe(false);
    expect(out.error).toContain('Alpha');
    expect(out.error).toContain('Beta');
  });

  it('sets group state via repos.groups.update', async () => {
    const { groupUpdate } = setup({
      memberships: [{ groupId: 'g1' }],
      groups: { g1: { id: 'g1', name: 'Alpha', state: {} } },
    });
    const out = await executeStateTool(
      { operation: 'set', context: 'group', path: 'score', value: 10 },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(out.success).toBe(true);
    expect(groupUpdate).toHaveBeenCalledWith('g1', { state: { score: 10 } });
  });
});

describe('general context', () => {
  it('round-trips general state', async () => {
    readGeneralStateMock.mockResolvedValue({ era: 'roaring' });
    setup({});
    const fetchOut = await executeStateTool(
      { operation: 'fetch', context: 'general', path: 'era' },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(fetchOut.value).toBe('roaring');

    const setOut = await executeStateTool(
      { operation: 'set', context: 'general', path: 'era', value: 'gilded' },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(setOut.success).toBe(true);
    expect(writeGeneralStateMock).toHaveBeenCalledWith({ era: 'gilded' });
  });
});

describe('underscore refusal on new tiers', () => {
  it('refuses set on a group underscore key', async () => {
    setup({
      memberships: [{ groupId: 'g1' }],
      groups: { g1: { id: 'g1', name: 'Alpha', state: {} } },
    });
    const out = await executeStateTool(
      { operation: 'set', context: 'group', path: '_secret', value: 1 },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(out.success).toBe(false);
    expect(out.error).toContain('user-only');
  });

  it('refuses delete on a general underscore key', async () => {
    setup({});
    const out = await executeStateTool(
      { operation: 'delete', context: 'general', path: '_secret' },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(out.success).toBe(false);
    expect(out.error).toContain('user-only');
    expect(writeGeneralStateMock).not.toHaveBeenCalled();
  });
});

describe('backwards compatibility', () => {
  it('project fetch still errors when the chat has no project', async () => {
    setup({});
    const out = await executeStateTool(
      { operation: 'fetch', context: 'project', path: 'x' },
      { userId: USER, chatId: CHAT, characterId: CHAR },
    );
    expect(out.success).toBe(false);
    expect(out.error).toBe('Chat is not part of a project');
  });
});
