import {
  maybeEnqueueColdChunkReembed,
  _resetColdChunkReembedDebounceForTesting,
} from '@/lib/scriptorium/cold-chunk-reembed';
import { getRepositories } from '@/lib/repositories/factory';
import { enqueueEmbeddingGenerate } from '@/lib/background-jobs/queue-service';

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }));
jest.mock('@/lib/background-jobs/queue-service', () => ({ enqueueEmbeddingGenerate: jest.fn() }));

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockEnqueue = enqueueEmbeddingGenerate as jest.MockedFunction<typeof enqueueEmbeddingGenerate>;

const CHAT_ID = 'chat-1';
const USER_ID = 'user-1';

const coldChunks = [
  { id: 'chunk-1', chatId: CHAT_ID, interchangeIndex: 0, content: 'first interchange', embedding: undefined },
  { id: 'chunk-2', chatId: CHAT_ID, interchangeIndex: 1, content: 'second interchange', embedding: undefined },
  // Already-warm chunk: must not be re-enqueued.
  { id: 'chunk-3', chatId: CHAT_ID, interchangeIndex: 2, content: 'third', embedding: new Float32Array([0.1, 0.2]) },
  // Empty content: deterministically unembeddable, must be skipped.
  { id: 'chunk-4', chatId: CHAT_ID, interchangeIndex: 3, content: '   ', embedding: undefined },
];

let conversationChunks: { countByChatIds: jest.Mock; findByChatId: jest.Mock };
let embeddingProfiles: { findAll: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  _resetColdChunkReembedDebounceForTesting();

  conversationChunks = {
    countByChatIds: jest.fn(async () => new Map([[CHAT_ID, { total: 4, embedded: 1 }]])),
    findByChatId: jest.fn(async () => coldChunks),
  };
  embeddingProfiles = {
    findAll: jest.fn(async () => [
      { id: 'profile-other', isDefault: false },
      { id: 'profile-default', isDefault: true },
    ]),
  };

  mockGetRepositories.mockReturnValue({ conversationChunks, embeddingProfiles } as any);
  mockEnqueue.mockResolvedValue({ jobId: 'job-1', isNew: true });
});

describe('maybeEnqueueColdChunkReembed', () => {
  it('enqueues one re-embed job per cold chunk with content, via the default profile', async () => {
    const enqueued = await maybeEnqueueColdChunkReembed(USER_ID, CHAT_ID);

    expect(enqueued).toBe(2);
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    expect(mockEnqueue).toHaveBeenCalledWith(USER_ID, {
      entityType: 'CONVERSATION_CHUNK',
      entityId: 'chunk-1',
      chatId: CHAT_ID,
      profileId: 'profile-default',
    });
    expect(mockEnqueue).toHaveBeenCalledWith(USER_ID, {
      entityType: 'CONVERSATION_CHUNK',
      entityId: 'chunk-2',
      chatId: CHAT_ID,
      profileId: 'profile-default',
    });
    const enqueuedIds = mockEnqueue.mock.calls.map((c) => (c[1] as { entityId: string }).entityId);
    expect(enqueuedIds).not.toContain('chunk-3'); // already embedded
    expect(enqueuedIds).not.toContain('chunk-4'); // empty content
  });

  it('debounces: a double-open only scans and enqueues once', async () => {
    const first = await maybeEnqueueColdChunkReembed(USER_ID, CHAT_ID);
    const second = await maybeEnqueueColdChunkReembed(USER_ID, CHAT_ID);

    expect(first).toBe(2);
    expect(second).toBe(0);
    expect(conversationChunks.countByChatIds).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(2); // from the first open only
  });

  it('is a cheap no-op on a warm chat (all chunks embedded)', async () => {
    conversationChunks.countByChatIds.mockResolvedValue(
      new Map([[CHAT_ID, { total: 4, embedded: 4 }]]),
    );

    const enqueued = await maybeEnqueueColdChunkReembed(USER_ID, CHAT_ID);
    expect(enqueued).toBe(0);
    expect(conversationChunks.findByChatId).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('is a no-op on a chat with no chunks at all', async () => {
    conversationChunks.countByChatIds.mockResolvedValue(new Map());

    const enqueued = await maybeEnqueueColdChunkReembed(USER_ID, CHAT_ID);
    expect(enqueued).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('skips quietly when no embedding profile is configured', async () => {
    embeddingProfiles.findAll.mockResolvedValue([]);

    const enqueued = await maybeEnqueueColdChunkReembed(USER_ID, CHAT_ID);
    expect(enqueued).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('does not count queue-level duplicates as newly enqueued', async () => {
    mockEnqueue.mockResolvedValue({ jobId: 'job-existing', isNew: false });

    const enqueued = await maybeEnqueueColdChunkReembed(USER_ID, CHAT_ID);
    expect(enqueued).toBe(0);
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
  });
});
