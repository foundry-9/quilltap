/**
 * Whose sheet a composer-run custom tool is dealt against.
 *
 * A tool every character resolves to the same file still has to be listed as
 * *somebody*, because POST reads that character's fact sheet for `when.metadata`
 * and their groups for `$state`. The roster used to record whoever the
 * participants array led with, so an operator playing Charlie in a room created
 * leading with Friday had their runs tested against Friday's sheet.
 *
 * These cover the preference (own character, active-typing first), the label
 * that admits when no character of theirs was a candidate, and the two paths
 * that must NOT start preferring the operator: a per-variant listing, and a
 * character's own mid-turn roll.
 */

import { GET, POST } from '@/app/api/v1/chats/[id]/custom-tools/route';
import { resolveCustomToolRoster, executeCustomTool } from '@/lib/pascal/custom-tools';
import { postPascalResult } from '@/lib/services/pascal/writer';
import { resolveStateCascade } from '@/lib/state/state-cascade';

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
  createContextParamsHandler: (handler: unknown) => handler,
}));

jest.mock('@/lib/api/middleware/actions', () => ({
  withActionDispatch:
    (map: Record<string, unknown>, fallback?: unknown) =>
    async (req: { url: string }, ctx: unknown, params: unknown) => {
      const action = new URL(req.url).searchParams.get('action') ?? '';
      const handler = (map[action] ?? fallback) as (
        r: unknown,
        c: unknown,
        p: unknown,
      ) => Promise<unknown>;
      return handler(req, ctx, params);
    },
}));

jest.mock('@/lib/pascal/custom-tools', () => ({
  resolveCustomToolRoster: jest.fn(),
  executeCustomTool: jest.fn(),
  CustomToolRunError: class CustomToolRunError extends Error {},
}));

jest.mock('@/lib/state/state-cascade', () => ({
  resolveStateCascade: jest.fn(),
}));

jest.mock('@/lib/pascal/llm-consult', () => ({
  buildCustomToolLlmInvoker: jest.fn(),
}));

jest.mock('@/lib/services/pascal/writer', () => ({
  buildPascalResultContent: jest.fn(() => ({ content: 'c', opaqueContent: null })),
  postPascalResult: jest.fn(),
}));

jest.mock('@/lib/services/prospero-notifications/writer', () => ({
  postProsperoCustomToolError: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHARACTERS: Record<string, { id: string; name: string; metadata: Record<string, unknown> }> = {
  'char-friday': {
    id: 'char-friday',
    name: 'Friday',
    metadata: { toolAbilities: 'analyze, display, architect' },
  },
  'char-charlie': {
    id: 'char-charlie',
    name: 'Charlie',
    metadata: { toolAbilities: 'programmable' },
  },
  'char-ariel': { id: 'char-ariel', name: 'Ariel', metadata: { toolAbilities: 'sing' } },
};

/** One definition file, reachable by every character — the global-store case. */
const SHARED = {
  definition: {
    name: 'lambda',
    description: 'Consult the API Listening Agent',
    outcomes: [{ when: true, message: 'done', state: 'success' }],
  },
  tier: 'global' as const,
  definitionPath: 'tools/lambda.tool.json',
  mountPointId: 'mount-global',
  mountName: 'Quilltap Tools',
};

/** The same NAME, resolved to a different file — the shadowed case. */
function shadowed(characterId: string) {
  return {
    ...SHARED,
    tier: 'character' as const,
    definitionPath: `vault/${characterId}.tool.json`,
    mountPointId: `mount-${characterId}`,
  };
}

interface Participant {
  id: string;
  type: string;
  characterId: string;
  controlledBy: string;
  status?: string;
}

function participant(
  id: string,
  characterId: string,
  controlledBy: 'llm' | 'user',
  status = 'active',
): Participant {
  return { id, type: 'CHARACTER', characterId, controlledBy, status };
}

function makeCtx(chat: Record<string, unknown>) {
  return {
    user: { id: 'user-1' },
    repos: {
      chats: { findById: jest.fn(async () => chat) },
      characters: { findById: jest.fn(async (id: string) => CHARACTERS[id] ?? null) },
    },
  } as never;
}

/** Every named character sees `entriesByCharacter[id]`; absent means no tool. */
function rosterPerCharacter(entriesByCharacter: Record<string, unknown | undefined>) {
  jest.mocked(resolveCustomToolRoster).mockImplementation((async (opts: { characterId: string }) => {
    const entry = entriesByCharacter[opts.characterId];
    return {
      tools: new Map(entry ? [['lambda', entry]] : []),
      errors: [],
      droppedForCap: [],
    };
  }) as never);
}

function req(action = '', body?: unknown) {
  return {
    url: `http://localhost/api/v1/chats/chat-1/custom-tools${action ? `?action=${action}` : ''}`,
    json: async () => body,
  } as never;
}

async function listTools(chat: Record<string, unknown>) {
  const res = await (GET as unknown as (r: unknown, c: unknown, p: unknown) => Promise<Response>)(
    req(),
    makeCtx(chat),
    { id: 'chat-1' },
  );
  const body = await res.json();
  return body.tools as Array<{
    name: string;
    asCharacterId: string;
    characterLabel?: string;
    definitionPath: string;
  }>;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(resolveStateCascade).mockResolvedValue({ merged: {} } as never);
  jest.mocked(postPascalResult).mockResolvedValue({ id: 'msg-1' } as never);
});

// ---------------------------------------------------------------------------
// GET — the roster
// ---------------------------------------------------------------------------

describe('GET custom-tools — whose perspective an unlabelled row records', () => {
  it("names the operator's own character, not the first participant", async () => {
    rosterPerCharacter({ 'char-friday': SHARED, 'char-charlie': SHARED });

    const tools = await listTools({
      id: 'chat-1',
      participants: [
        participant('p-friday', 'char-friday', 'llm'),
        participant('p-charlie', 'char-charlie', 'user'),
      ],
    });

    expect(tools).toHaveLength(1);
    expect(tools[0].asCharacterId).toBe('char-charlie');
    expect(tools[0].characterLabel).toBeUndefined();
  });

  it('prefers the character the operator is currently typing as', async () => {
    rosterPerCharacter({ 'char-charlie': SHARED, 'char-ariel': SHARED });

    const tools = await listTools({
      id: 'chat-1',
      participants: [
        participant('p-charlie', 'char-charlie', 'user'),
        participant('p-ariel', 'char-ariel', 'user'),
      ],
      activeTypingParticipantId: 'p-ariel',
    });

    expect(tools[0].asCharacterId).toBe('char-ariel');
    expect(tools[0].characterLabel).toBeUndefined();
  });

  it('ignores a removed user-controlled participant', async () => {
    rosterPerCharacter({ 'char-friday': SHARED, 'char-charlie': SHARED });

    const tools = await listTools({
      id: 'chat-1',
      participants: [
        participant('p-friday', 'char-friday', 'llm'),
        participant('p-charlie', 'char-charlie', 'user', 'removed'),
      ],
    });

    expect(tools[0].asCharacterId).toBe('char-friday');
    expect(tools[0].characterLabel).toBe('Friday');
  });

  it("labels the row when a gate withheld the tool from the operator's own character", async () => {
    // Gates are answered per perspective, before the dedup: Charlie simply has
    // no sighting. The row must not pretend the run is his.
    rosterPerCharacter({ 'char-friday': SHARED });

    const tools = await listTools({
      id: 'chat-1',
      participants: [
        participant('p-friday', 'char-friday', 'llm'),
        participant('p-charlie', 'char-charlie', 'user'),
      ],
    });

    expect(tools[0].asCharacterId).toBe('char-friday');
    expect(tools[0].characterLabel).toBe('Friday');
  });

  it('labels the row in an all-LLM room with more than one character', async () => {
    rosterPerCharacter({ 'char-friday': SHARED, 'char-ariel': SHARED });

    const tools = await listTools({
      id: 'chat-1',
      participants: [
        participant('p-friday', 'char-friday', 'llm'),
        participant('p-ariel', 'char-ariel', 'llm'),
      ],
    });

    expect(tools[0].asCharacterId).toBe('char-friday');
    expect(tools[0].characterLabel).toBe('Friday');
  });

  it('leaves a one-character room unlabelled — there is nothing to disambiguate', async () => {
    rosterPerCharacter({ 'char-friday': SHARED });

    const tools = await listTools({
      id: 'chat-1',
      participants: [participant('p-friday', 'char-friday', 'llm')],
    });

    expect(tools[0].asCharacterId).toBe('char-friday');
    expect(tools[0].characterLabel).toBeUndefined();
  });

  it('still lists one labelled row per variant when the name is shadowed', async () => {
    rosterPerCharacter({
      'char-friday': shadowed('char-friday'),
      'char-charlie': shadowed('char-charlie'),
    });

    const tools = await listTools({
      id: 'chat-1',
      participants: [
        participant('p-friday', 'char-friday', 'llm'),
        participant('p-charlie', 'char-charlie', 'user'),
      ],
    });

    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.asCharacterId).sort()).toEqual(['char-charlie', 'char-friday']);
    expect(tools.every((t) => t.characterLabel !== undefined)).toBe(true);
    // Each row keeps the file its own character resolved — the operator's
    // preference must not reach in and rewrite a variant.
    for (const tool of tools) {
      expect(tool.definitionPath).toBe(`vault/${tool.asCharacterId}.tool.json`);
    }
  });
});

// ---------------------------------------------------------------------------
// POST ?action=run — the deal
// ---------------------------------------------------------------------------

describe('POST custom-tools ?action=run — whose sheet is tested', () => {
  const chat = {
    id: 'chat-1',
    participants: [
      participant('p-friday', 'char-friday', 'llm'),
      participant('p-charlie', 'char-charlie', 'user'),
    ],
  };

  function run(body: unknown) {
    return (POST as unknown as (r: unknown, c: unknown, p: unknown) => Promise<Response>)(
      req('run', body),
      makeCtx(chat),
      { id: 'chat-1' },
    );
  }

  beforeEach(() => {
    rosterPerCharacter({ 'char-friday': SHARED, 'char-charlie': SHARED });
    jest.mocked(executeCustomTool).mockResolvedValue({
      tool: 'lambda',
      params: {},
      rollForm: 'uniform',
      raw: 1,
      value: 1.9958,
      state: 'success',
      outcomeIndex: 0,
      message: 'done',
    } as never);
  });

  it("tests the named character's sheet, and scopes $state to their groups", async () => {
    await run({ tool: 'lambda', asCharacterId: 'char-charlie' });

    expect(jest.mocked(executeCustomTool).mock.calls[0][2]).toMatchObject({
      metadata: { toolAbilities: 'programmable' },
    });
    expect(jest.mocked(resolveStateCascade).mock.calls[0][0]).toMatchObject({
      groupScope: { kind: 'character', characterId: 'char-charlie' },
    });
  });

  it('rolls against an empty sheet when the run names nobody', async () => {
    await run({ tool: 'lambda' });

    expect(jest.mocked(executeCustomTool).mock.calls[0][2]).toMatchObject({ metadata: {} });
    expect(jest.mocked(resolveStateCascade).mock.calls[0][0]).toMatchObject({
      groupScope: { kind: 'none' },
    });
    // …but the roster it resolves through follows the same preference as GET,
    // so a shadowed name deals the operator's own definition.
    expect(jest.mocked(resolveCustomToolRoster).mock.calls[0][0]).toMatchObject({
      characterId: 'char-charlie',
    });
  });

  it('refuses a character who is not in the chat', async () => {
    const res = await run({ tool: 'lambda', asCharacterId: 'char-nobody' });
    expect(res.status).toBe(400);
  });
});
