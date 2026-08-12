/**
 * Tests for the merge-conversation action
 * (POST /api/v1/chats/[id]?action=merge-conversation).
 *
 * `applyChatMerge` does the folding and is mocked; this covers the route's
 * guards (self-merge, empty allowlist, missing source, nothing-merged) and the
 * shape it hands back. The REAL request schema runs, so id validation is live.
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

jest.mock('@/lib/chat/apply-chat-merge', () => ({
  applyChatMerge: jest.fn(),
}));

import { handleMergeConversation } from '@/app/api/v1/chats/[id]/actions/merge';
import { applyChatMerge } from '@/lib/chat/apply-chat-merge';

const applyMerge = applyChatMerge as jest.MockedFunction<typeof applyChatMerge>;

const TARGET_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const CHAR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const TARGET_CHAT = { id: TARGET_ID, title: 'Target' } as never;

function makeCtx(options: { sourceChat?: unknown; refreshed?: unknown } = {}) {
  const { sourceChat = { id: SOURCE_ID, title: 'Source' }, refreshed = { id: TARGET_ID, title: 'Target', merged: true } } =
    options;

  const findById = jest.fn(async (id: string) => (id === SOURCE_ID ? sourceChat : refreshed));

  const ctx = {
    user: { id: 'user-1' },
    repos: { chats: { findById } },
  } as never;

  return { ctx, findById };
}

function req(body: unknown) {
  return { json: async () => body } as never;
}

function mergeResult(overrides: Partial<{ mergedCharacterIds: string[]; skippedAlreadyPresentCharacterIds: string[] }> = {}) {
  return {
    mergedCharacterIds: [CHAR_A],
    skippedAlreadyPresentCharacterIds: [],
    ...overrides,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  applyMerge.mockResolvedValue(mergeResult());
});

describe('handleMergeConversation', () => {
  it('folds the source chat in and returns the refreshed target', async () => {
    const { ctx } = makeCtx();

    const res = await handleMergeConversation(
      req({ sourceChatId: SOURCE_ID }),
      TARGET_ID,
      TARGET_CHAT,
      ctx
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.merge.mergedCharacterIds).toEqual([CHAR_A]);
    expect(body.chat).toEqual({ id: TARGET_ID, title: 'Target', merged: true });
  });

  it('passes the allowlist and outfit selections through to applyChatMerge', async () => {
    const { ctx } = makeCtx();
    const outfitSelections = [{ characterId: CHAR_A, mode: 'previous_chat' as const }];

    await handleMergeConversation(
      req({ sourceChatId: SOURCE_ID, characterIds: [CHAR_A, CHAR_B], outfitSelections }),
      TARGET_ID,
      TARGET_CHAT,
      ctx
    );

    expect(applyMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        targetChatId: TARGET_ID,
        sourceChatId: SOURCE_ID,
        userId: 'user-1',
        includeCharacterIds: [CHAR_A, CHAR_B],
        outfitSelections,
      })
    );
  });

  it('leaves the allowlist undefined when the body omits it', async () => {
    const { ctx } = makeCtx();

    await handleMergeConversation(req({ sourceChatId: SOURCE_ID }), TARGET_ID, TARGET_CHAT, ctx);

    expect(applyMerge.mock.calls[0][0].includeCharacterIds).toBeUndefined();
  });

  it('400s on a self-merge before touching the repositories', async () => {
    const { ctx, findById } = makeCtx();

    const res = await handleMergeConversation(
      req({ sourceChatId: TARGET_ID }),
      TARGET_ID,
      TARGET_CHAT,
      ctx
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Cannot merge a conversation into itself',
    });
    expect(findById).not.toHaveBeenCalled();
    expect(applyMerge).not.toHaveBeenCalled();
  });

  it('400s when the operator gated everyone out with an empty allowlist', async () => {
    const { ctx } = makeCtx();

    const res = await handleMergeConversation(
      req({ sourceChatId: SOURCE_ID, characterIds: [] }),
      TARGET_ID,
      TARGET_CHAT,
      ctx
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Select at least one character to merge in.',
    });
    expect(applyMerge).not.toHaveBeenCalled();
  });

  it('404s when the source chat is gone', async () => {
    const { ctx } = makeCtx({ sourceChat: null });

    const res = await handleMergeConversation(
      req({ sourceChatId: SOURCE_ID }),
      TARGET_ID,
      TARGET_CHAT,
      ctx
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Source chat not found' });
    expect(applyMerge).not.toHaveBeenCalled();
  });

  it('400s as a no-op when every chosen character was already present', async () => {
    applyMerge.mockResolvedValue(
      mergeResult({ mergedCharacterIds: [], skippedAlreadyPresentCharacterIds: [CHAR_A] })
    );
    const { ctx } = makeCtx();

    const res = await handleMergeConversation(
      req({ sourceChatId: SOURCE_ID }),
      TARGET_ID,
      TARGET_CHAT,
      ctx
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'None of the chosen characters could be merged in (already present).',
    });
  });

  it('falls back to the passed-in chat when the refresh read comes back empty', async () => {
    const { ctx } = makeCtx({ refreshed: null });

    const res = await handleMergeConversation(
      req({ sourceChatId: SOURCE_ID }),
      TARGET_ID,
      TARGET_CHAT,
      ctx
    );

    const body = await res.json();
    expect(body.chat).toEqual({ id: TARGET_ID, title: 'Target' });
  });

  it('500s when the merge itself throws', async () => {
    applyMerge.mockRejectedValue(new Error('participant write failed'));
    const { ctx } = makeCtx();

    const res = await handleMergeConversation(
      req({ sourceChatId: SOURCE_ID }),
      TARGET_ID,
      TARGET_CHAT,
      ctx
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to merge conversation' });
  });

  it('500s when the merge rejects with a non-Error', async () => {
    applyMerge.mockRejectedValue('participant write failed');
    const { ctx } = makeCtx();

    const res = await handleMergeConversation(
      req({ sourceChatId: SOURCE_ID }),
      TARGET_ID,
      TARGET_CHAT,
      ctx
    );

    expect(res.status).toBe(500);
  });

  it.each([
    ['a non-uuid source id', { sourceChatId: 'not-a-uuid' }],
    ['a missing source id', {}],
    ['a non-uuid in the allowlist', { sourceChatId: SOURCE_ID, characterIds: ['nope'] }],
  ])('rejects %s via the request schema', async (_label, body) => {
    const { ctx } = makeCtx();

    await expect(
      handleMergeConversation(req(body), TARGET_ID, TARGET_CHAT, ctx)
    ).rejects.toThrow();
    expect(applyMerge).not.toHaveBeenCalled();
  });
});
