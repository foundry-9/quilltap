import { collapseStaleChatCaches } from '@/lib/background-jobs/maintenance/collapse-stale-chat-caches';
import { getRepositories } from '@/lib/repositories/factory';
import { rawQuery } from '@/lib/database/manager';
import { dropInMemoryCompressionCache } from '@/lib/services/chat-message/compression-cache.service';
import { getDataRetentionSettings } from '@/lib/instance-settings';

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
jest.mock('@/lib/database/manager', () => ({ rawQuery: jest.fn() }));
jest.mock('@/lib/services/chat-message/compression-cache.service', () => ({
  dropInMemoryCompressionCache: jest.fn(),
}));
jest.mock('@/lib/instance-settings', () => ({ getDataRetentionSettings: jest.fn() }));
// Transitive imports of the shared isStale gate (collapse-stale-chat-assets);
// mocked so this unit test never touches photo/link/cascade machinery.
jest.mock('@/lib/photos/resolve-character-avatar', () => ({ resolveCharacterAvatar: jest.fn() }));
jest.mock('@/lib/photos/photo-link-summary', () => ({ getPhotoLinkSummaryBySha256: jest.fn() }));
jest.mock('@/lib/cascade-delete', () => ({ deleteFileCompletely: jest.fn() }));

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockRawQuery = rawQuery as jest.MockedFunction<typeof rawQuery>;
const mockDropInMemory = dropInMemoryCompressionCache as jest.MockedFunction<typeof dropInMemoryCompressionCache>;
const mockGetRetention = getDataRetentionSettings as jest.MockedFunction<typeof getDataRetentionSettings>;

const NOW = new Date('2024-06-01T00:00:00.000Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const isoDaysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

const staleChat = { id: 'chat-stale', lastMessageAt: isoDaysAgo(40), updatedAt: isoDaysAgo(40) };
const activeChat = { id: 'chat-active', lastMessageAt: isoDaysAgo(1), updatedAt: isoDaysAgo(1) };

let lastPlayedByChat: Record<string, string | null>;
let chats: { findAll: jest.Mock; getLastPlayedMessageAt: jest.Mock };
let conversationChunks: { clearEmbeddingsForChat: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();

  lastPlayedByChat = {
    'chat-stale': isoDaysAgo(40),
    'chat-active': isoDaysAgo(1),
  };

  chats = {
    findAll: jest.fn(async () => [staleChat, activeChat]),
    getLastPlayedMessageAt: jest.fn(async (id: string) =>
      id in lastPlayedByChat ? lastPlayedByChat[id] : null,
    ),
  };
  conversationChunks = {
    clearEmbeddingsForChat: jest.fn(async () => 4),
  };

  mockGetRepositories.mockReturnValue({ chats, conversationChunks } as any);
  mockGetRetention.mockResolvedValue({ staleChatDays: 30 });
  // Default: every guarded UPDATE reports it cleared something.
  mockRawQuery.mockResolvedValue({ changes: 2 } as any);
});

/** All chat ids that were passed to a raw UPDATE. */
function updatedChatIds(): string[] {
  return mockRawQuery.mock.calls.map((c) => (c[1] as unknown[])[0] as string);
}

describe('collapseStaleChatCaches', () => {
  it('collapses a stale chat: chats columns, message columns, chunk embeddings', async () => {
    const summary = await collapseStaleChatCaches(NOW);

    // Two raw UPDATEs (chats + chat_messages), both scoped to the stale chat.
    expect(mockRawQuery).toHaveBeenCalledTimes(2);
    expect(updatedChatIds()).toEqual(['chat-stale', 'chat-stale']);
    const [chatsSql] = mockRawQuery.mock.calls[0];
    const [messagesSql] = mockRawQuery.mock.calls[1];
    expect(chatsSql).toContain('compressionCache = NULL');
    expect(chatsSql).toContain('renderedMarkdown = NULL');
    expect(messagesSql).toContain('rawResponse = NULL');
    expect(messagesSql).toContain('reasoningContent = NULL');
    expect(messagesSql).toContain('reasoningSegments = NULL');
    expect(messagesSql).toContain('renderedHtml = NULL');
    expect(messagesSql).toContain('debugMemoryLogs = NULL');

    // Never the sacred columns.
    expect(messagesSql).not.toMatch(/\bcontent = NULL/);
    expect(messagesSql).not.toContain('opaqueContent');
    expect(messagesSql).not.toContain('thoughtSignature');

    // The staleness cutoff rides along so embeddings minted by a reopen
    // re-embed inside the window survive the sweep (read-only warmth).
    expect(conversationChunks.clearEmbeddingsForChat).toHaveBeenCalledWith(
      'chat-stale',
      isoDaysAgo(30),
    );
    expect(mockDropInMemory).toHaveBeenCalledWith('chat-stale');

    expect(summary.chatsScanned).toBe(2);
    expect(summary.staleChats).toBe(1);
    expect(summary.chatsCollapsed).toBe(1);
    expect(summary.chatRowsCleared).toBe(2);
    expect(summary.messageRowsCleared).toBe(2);
    expect(summary.chunkEmbeddingsCleared).toBe(4);
  });

  it('never touches an active (non-stale) chat', async () => {
    await collapseStaleChatCaches(NOW);
    expect(updatedChatIds()).not.toContain('chat-active');
    expect(conversationChunks.clearEmbeddingsForChat).not.toHaveBeenCalledWith('chat-active');
  });

  it('collapses a chat kept "fresh" only by a feature whisper (played-message staleness)', async () => {
    const freshlyWhispered = { ...staleChat, lastMessageAt: isoDaysAgo(1), updatedAt: isoDaysAgo(1) };
    chats.findAll.mockResolvedValue([freshlyWhispered, activeChat]);
    // getLastPlayedMessageAt still reports the real 40-day-old activity.

    const summary = await collapseStaleChatCaches(NOW);
    expect(summary.staleChats).toBe(1);
    expect(summary.chatsCollapsed).toBe(1);
  });

  it('is idempotent — a second pass over an already-collapsed chat clears nothing', async () => {
    mockRawQuery.mockResolvedValue({ changes: 0 } as any);
    conversationChunks.clearEmbeddingsForChat.mockResolvedValue(0);

    const summary = await collapseStaleChatCaches(NOW);
    expect(summary.staleChats).toBe(1);
    expect(summary.chatsCollapsed).toBe(0);
    expect(summary.chatRowsCleared).toBe(0);
    expect(summary.messageRowsCleared).toBe(0);
    expect(summary.chunkEmbeddingsCleared).toBe(0);
  });

  it('honors a shortened retention window from the instance setting', async () => {
    mockGetRetention.mockResolvedValue({ staleChatDays: 5 });
    lastPlayedByChat['chat-stale'] = isoDaysAgo(10); // stale under 5d, fresh under 30d

    const summary = await collapseStaleChatCaches(NOW);
    expect(summary.staleChats).toBe(1);
    expect(summary.chatsCollapsed).toBe(1);
  });

  it('honors a lengthened retention window from the instance setting', async () => {
    mockGetRetention.mockResolvedValue({ staleChatDays: 60 });

    const summary = await collapseStaleChatCaches(NOW); // stale chat is 40 days quiet
    expect(summary.staleChats).toBe(0);
    expect(mockRawQuery).not.toHaveBeenCalled();
  });

  it('falls back to the 30-day default when the setting is unreadable', async () => {
    mockGetRetention.mockRejectedValue(new Error('db unavailable'));

    const summary = await collapseStaleChatCaches(NOW);
    expect(summary.staleChats).toBe(1); // 40 days quiet > 30-day fallback
  });

  it('continues past a chat whose collapse throws', async () => {
    chats.findAll.mockResolvedValue([staleChat, { ...staleChat, id: 'chat-stale-2' }]);
    lastPlayedByChat['chat-stale-2'] = isoDaysAgo(40);
    mockRawQuery
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValue({ changes: 1 } as any);

    const summary = await collapseStaleChatCaches(NOW);
    expect(summary.staleChats).toBe(2);
    expect(summary.chatsCollapsed).toBe(1); // second chat still collapsed
  });
});
