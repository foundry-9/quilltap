/**
 * Tests for the recall-replay developer action
 * (POST /api/v1/chats/[id]?action=recall-replay).
 *
 * The replay engine and cheap-LLM resolver are mocked; this covers the route's
 * own work — tolerant body parsing, the sanitising of turnIndex/characterId/
 * limit, and the connection-profile anchor it picks for the cheap-LLM resolver.
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

jest.mock('@/lib/memory/recall-replay', () => ({
  runRecallReplay: jest.fn(),
}));

jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
}));

import { handleRecallReplay } from '@/app/api/v1/chats/[id]/actions/recall-replay';
import { runRecallReplay } from '@/lib/memory/recall-replay';
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm';

const runReplay = runRecallReplay as jest.MockedFunction<typeof runRecallReplay>;
const resolveCheapLLM = getCheapLLMProvider as jest.MockedFunction<typeof getCheapLLMProvider>;

const CHEAP_SETTINGS = {
  strategy: 'default',
  userDefinedProfileId: null,
  defaultCheapProfileId: null,
  fallbackToLocal: true,
};

const PROFILE_A = { id: 'profile-a', name: 'Anchor' };
const PROFILE_B = { id: 'profile-b', name: 'Other' };

const REPLAY_RESULT = { turnIndex: 4, inert: [], live: [] } as never;

function makeCtx(options: {
  chatSettings?: unknown;
  profiles?: Array<{ id: string; name: string }>;
} = {}) {
  const {
    chatSettings = { cheapLLMSettings: CHEAP_SETTINGS },
    profiles = [PROFILE_A, PROFILE_B],
  } = options;

  return {
    user: { id: 'user-1' },
    repos: {
      chatSettings: { findByUserId: jest.fn(async () => chatSettings) },
      connections: { findByUserId: jest.fn(async () => profiles) },
    },
  } as never;
}

function chat(participants: Array<{ connectionProfileId?: string | null }> = []) {
  return { id: 'chat-1', participants } as never;
}

/** The route reads the body with `req.text()` so an empty body is legal. */
function req(raw: string) {
  return { text: async () => raw } as never;
}

function jsonReq(body: unknown) {
  return req(JSON.stringify(body));
}

beforeEach(() => {
  jest.clearAllMocks();
  resolveCheapLLM.mockReturnValue({ id: 'cheap' } as never);
  runReplay.mockResolvedValue(REPLAY_RESULT);
});

describe('handleRecallReplay', () => {
  it('runs the replay and returns its result', async () => {
    const res = await handleRecallReplay(jsonReq({}), 'chat-1', chat(), makeCtx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(REPLAY_RESULT);
  });

  it('accepts an entirely empty body', async () => {
    const res = await handleRecallReplay(req('   '), 'chat-1', chat(), makeCtx());

    expect(res.status).toBe(200);
    expect(runReplay).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1', userId: 'user-1' })
    );
  });

  it('400s on a body that is not JSON', async () => {
    const res = await handleRecallReplay(req('{not json'), 'chat-1', chat(), makeCtx());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Body must be JSON' });
    expect(runReplay).not.toHaveBeenCalled();
  });

  describe('parameter sanitising', () => {
    it('passes through a valid turnIndex, characterId, and limit', async () => {
      await handleRecallReplay(
        jsonReq({ turnIndex: 4, characterId: 'char-a', limit: 25 }),
        'chat-1',
        chat(),
        makeCtx()
      );

      expect(runReplay).toHaveBeenCalledWith(
        expect.objectContaining({ turnIndex: 4, characterId: 'char-a', limit: 25 })
      );
    });

    it.each([
      ['zero', 0],
      ['negative', -3],
      ['fractional', 2.5],
      ['a string', '4'],
    ])('drops a turnIndex that is %s', async (_label, turnIndex) => {
      await handleRecallReplay(jsonReq({ turnIndex }), 'chat-1', chat(), makeCtx());

      expect(runReplay.mock.calls[0][0].turnIndex).toBeUndefined();
    });

    it.each([
      ['zero', 0],
      ['fractional', 10.5],
      ['a string', '25'],
    ])('drops a limit that is %s', async (_label, limit) => {
      await handleRecallReplay(jsonReq({ limit }), 'chat-1', chat(), makeCtx());

      expect(runReplay.mock.calls[0][0].limit).toBeUndefined();
    });

    it('clamps an oversized limit to 100', async () => {
      await handleRecallReplay(jsonReq({ limit: 5000 }), 'chat-1', chat(), makeCtx());

      expect(runReplay.mock.calls[0][0].limit).toBe(100);
    });

    it('drops a non-string characterId', async () => {
      await handleRecallReplay(jsonReq({ characterId: 42 }), 'chat-1', chat(), makeCtx());

      expect(runReplay.mock.calls[0][0].characterId).toBeUndefined();
    });
  });

  describe('cheap-LLM anchor profile', () => {
    it("anchors on the first participant's connection profile when it resolves", async () => {
      await handleRecallReplay(
        jsonReq({}),
        'chat-1',
        chat([{ connectionProfileId: null }, { connectionProfileId: 'profile-b' }]),
        makeCtx()
      );

      expect(resolveCheapLLM).toHaveBeenCalledWith(PROFILE_B, expect.anything(), [
        PROFILE_A,
        PROFILE_B,
      ]);
    });

    it('falls back to the first available profile when no participant has one', async () => {
      await handleRecallReplay(jsonReq({}), 'chat-1', chat([{}]), makeCtx());

      expect(resolveCheapLLM).toHaveBeenCalledWith(PROFILE_A, expect.anything(), expect.anything());
    });

    it("falls back to the first available profile when the participant's profile is gone", async () => {
      await handleRecallReplay(
        jsonReq({}),
        'chat-1',
        chat([{ connectionProfileId: 'profile-deleted' }]),
        makeCtx()
      );

      expect(resolveCheapLLM).toHaveBeenCalledWith(PROFILE_A, expect.anything(), expect.anything());
    });

    it('forwards the cheap-LLM settings from chat settings', async () => {
      await handleRecallReplay(jsonReq({}), 'chat-1', chat(), makeCtx());

      expect(resolveCheapLLM).toHaveBeenCalledWith(
        expect.anything(),
        {
          strategy: 'default',
          userDefinedProfileId: undefined,
          defaultCheapProfileId: undefined,
          fallbackToLocal: true,
        },
        expect.anything()
      );
    });
  });

  describe('preconditions', () => {
    it('400s when chat settings are missing', async () => {
      const res = await handleRecallReplay(
        jsonReq({}),
        'chat-1',
        chat(),
        makeCtx({ chatSettings: null })
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'Chat settings not found.' });
      expect(runReplay).not.toHaveBeenCalled();
    });

    it('400s when no connection profiles are configured', async () => {
      const res = await handleRecallReplay(jsonReq({}), 'chat-1', chat(), makeCtx({ profiles: [] }));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'No connection profiles configured.' });
      expect(runReplay).not.toHaveBeenCalled();
    });

    it('400s when no cheap LLM provider can be resolved', async () => {
      resolveCheapLLM.mockReturnValue(null as never);

      const res = await handleRecallReplay(jsonReq({}), 'chat-1', chat(), makeCtx());

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'No cheap LLM provider available.' });
      expect(runReplay).not.toHaveBeenCalled();
    });
  });

  it('surfaces a replay failure as a 400 carrying the underlying message', async () => {
    runReplay.mockRejectedValue(new Error('turn 99 is past the end of the chat'));

    const res = await handleRecallReplay(jsonReq({ turnIndex: 99 }), 'chat-1', chat(), makeCtx());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'turn 99 is past the end of the chat',
    });
  });

  it('uses a generic message when the replay rejects with a non-Error', async () => {
    runReplay.mockRejectedValue('kaboom');

    const res = await handleRecallReplay(jsonReq({}), 'chat-1', chat(), makeCtx());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Recall replay failed' });
  });
});
