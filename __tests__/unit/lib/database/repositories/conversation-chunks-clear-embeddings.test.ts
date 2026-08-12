/**
 * Tests for ConversationChunksRepository.clearEmbeddingsForChat — specifically
 * the optional `olderThan` age guard the stale-chat sweep passes so that
 * embeddings minted by the reopen path (cold-chunk-reembed) survive for a full
 * retention window instead of being cleared by the next sweep.
 */

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { ConversationChunksRepository } from '@/lib/database/repositories/conversation-chunks.repository';

const { rawQuery } = jest.requireMock('@/lib/database/manager') as {
  rawQuery: jest.Mock;
};

describe('ConversationChunksRepository.clearEmbeddingsForChat', () => {
  let repo: ConversationChunksRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    rawQuery.mockResolvedValue({ changes: 3 });
    repo = new ConversationChunksRepository();
  });

  it('clears every non-null embedding when no age cutoff is given', async () => {
    const cleared = await repo.clearEmbeddingsForChat('chat-1');

    expect(cleared).toBe(3);
    expect(rawQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = rawQuery.mock.calls[0] as [string, string[]];
    expect(sql).toContain('embedding = NULL');
    expect(sql).toContain('embedding IS NOT NULL');
    expect(sql).not.toContain('updatedAt <');
    expect(params).toHaveLength(2);
    expect(params[1]).toBe('chat-1');
  });

  it('only clears embeddings older than the cutoff when one is given', async () => {
    const cutoff = '2026-06-28T00:00:00.000Z';
    const cleared = await repo.clearEmbeddingsForChat('chat-1', cutoff);

    expect(cleared).toBe(3);
    const [sql, params] = rawQuery.mock.calls[0] as [string, string[]];
    expect(sql).toContain('embedding IS NOT NULL');
    expect(sql).toContain('AND updatedAt < ?');
    expect(params).toHaveLength(3);
    expect(params[1]).toBe('chat-1');
    expect(params[2]).toBe(cutoff);
  });

  it('returns 0 when nothing matches (idempotent second pass / all-recent embeddings)', async () => {
    rawQuery.mockResolvedValue({ changes: 0 });
    const cleared = await repo.clearEmbeddingsForChat('chat-1', '2026-06-28T00:00:00.000Z');
    expect(cleared).toBe(0);
  });

  it('returns the fallback 0 when the update throws', async () => {
    rawQuery.mockRejectedValue(new Error('locked'));
    const cleared = await repo.clearEmbeddingsForChat('chat-1');
    expect(cleared).toBe(0);
  });
});
