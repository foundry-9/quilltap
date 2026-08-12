/**
 * Tests for ConversationChunksRepository.upsert — the embedding-preservation
 * rule and its Bug 17 exception: when a chunk's content changes but no new
 * embedding is supplied, the stale vector is NULLed so the render handler
 * re-embeds. Load-bearing for interchange sub-chunking, where a formerly
 * oversize interchange splits and downstream chunks shift to new content at
 * existing indices.
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
import type { ConversationChunk } from '@/lib/schemas/types';

function existingChunk(overrides: Partial<ConversationChunk> = {}): ConversationChunk {
  return {
    id: 'chunk-1',
    chatId: 'chat-1',
    interchangeIndex: 5,
    content: 'old content',
    participantNames: ['Rosalind'],
    messageIds: ['m-9'],
    embedding: new Float32Array([0.1, 0.2, 0.3]),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ConversationChunksRepository.upsert — embedding preservation', () => {
  let repo: ConversationChunksRepository;
  let updateSpy: jest.SpiedFunction<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new ConversationChunksRepository();
    updateSpy = jest.spyOn(repo as any, '_update').mockImplementation(
      async (_id: unknown, data: unknown) => ({ ...existingChunk(), ...(data as object) }),
    );
  });

  it('preserves the embedding when content is unchanged', async () => {
    const existing = existingChunk();
    jest.spyOn(repo as any, 'findOneByFilter').mockResolvedValue(existing);

    await repo.upsert({
      chatId: 'chat-1',
      interchangeIndex: 5,
      content: 'old content', // identical
      participantNames: ['Rosalind'],
      messageIds: ['m-9'],
    });

    const [, patch] = updateSpy.mock.calls[0] as [string, Partial<ConversationChunk>];
    // No embedding key at all → the stored vector is left untouched.
    expect('embedding' in patch).toBe(false);
  });

  it('NULLs the embedding when content changes and no new embedding is supplied (Bug 17)', async () => {
    const existing = existingChunk();
    jest.spyOn(repo as any, 'findOneByFilter').mockResolvedValue(existing);

    await repo.upsert({
      chatId: 'chat-1',
      interchangeIndex: 5,
      content: 'a sub-chunk that shifted into this index', // changed
      participantNames: ['Rosalind'],
      messageIds: ['m-9'],
    });

    const [, patch] = updateSpy.mock.calls[0] as [string, Partial<ConversationChunk>];
    expect(patch.embedding).toBeNull();
  });

  it('uses the supplied embedding over the content-change NULL when both apply', async () => {
    const existing = existingChunk();
    jest.spyOn(repo as any, 'findOneByFilter').mockResolvedValue(existing);
    const fresh = new Float32Array([0.9, 0.8, 0.7]);

    await repo.upsert({
      chatId: 'chat-1',
      interchangeIndex: 5,
      content: 'new content',
      participantNames: ['Rosalind'],
      messageIds: ['m-9'],
      embedding: fresh,
    });

    const [, patch] = updateSpy.mock.calls[0] as [string, Partial<ConversationChunk>];
    expect(patch.embedding).toBe(fresh);
  });
});
