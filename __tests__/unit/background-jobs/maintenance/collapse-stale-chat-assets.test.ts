import { collapseStaleChatAssets } from '@/lib/background-jobs/maintenance/collapse-stale-chat-assets';
import { getRepositories } from '@/lib/repositories/factory';
import { resolveCharacterAvatar } from '@/lib/photos/resolve-character-avatar';
import { getPhotoLinkSummaryBySha256 } from '@/lib/photos/photo-link-summary';
import { deleteFileCompletely } from '@/lib/cascade-delete';

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
jest.mock('@/lib/photos/resolve-character-avatar', () => ({ resolveCharacterAvatar: jest.fn() }));
jest.mock('@/lib/photos/photo-link-summary', () => ({ getPhotoLinkSummaryBySha256: jest.fn() }));
jest.mock('@/lib/cascade-delete', () => ({ deleteFileCompletely: jest.fn() }));

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockResolveAvatar = resolveCharacterAvatar as jest.MockedFunction<typeof resolveCharacterAvatar>;
const mockLinkSummary = getPhotoLinkSummaryBySha256 as jest.MockedFunction<typeof getPhotoLinkSummaryBySha256>;
const mockDeleteFile = deleteFileCompletely as jest.MockedFunction<typeof deleteFileCompletely>;

const NOW = new Date('2024-06-01T00:00:00.000Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const isoDaysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

// A generated IMAGE files row. Only the fields the sweep reads.
function genFile(id: string, sha256: string) {
  return { id, source: 'GENERATED', category: 'IMAGE', sha256, size: 100, linkedTo: ['chat-stale'] };
}

let files: { findByLinkedTo: jest.Mock };
let characters: { findByDefaultImageId: jest.Mock; findByAvatarOverrideImageId: jest.Mock };
let chats: { findAll: jest.Mock; getLastPlayedMessageAt: jest.Mock };

const staleChat = {
  id: 'chat-stale',
  lastMessageAt: isoDaysAgo(40),
  updatedAt: isoDaysAgo(40),
  storyBackgroundImageId: 'bg-current',
  characterAvatars: { 'char-1': { imageId: 'av-current' } },
};

const activeChat = {
  id: 'chat-active',
  lastMessageAt: isoDaysAgo(1),
  updatedAt: isoDaysAgo(1),
  storyBackgroundImageId: 'bg-active',
  characterAvatars: {},
};

// Staleness is keyed off the last *played* (participant/user) message, not the
// chat's lastMessageAt/updatedAt (which Staff announcements also bump). Reset in
// beforeEach because individual tests mutate it.
let lastPlayedByChat: Record<string, string | null>;

beforeEach(() => {
  jest.clearAllMocks();

  lastPlayedByChat = {
    'chat-stale': isoDaysAgo(40),
    'chat-active': isoDaysAgo(1),
  };

  files = {
    findByLinkedTo: jest.fn(async (id: string) => {
      if (id !== 'chat-stale') return [];
      return [
        genFile('bg-current', 'sha-current'),
        genFile('bg-old1', 'sha-old1'),
        genFile('bg-old2', 'sha-old2'),
        genFile('av-current', 'sha-avc'),
        genFile('av-old', 'sha-avold'),
        genFile('album-saved', 'sha-album'), // kept to a vault album — must survive
        genFile('char-default', 'sha-cd'), // promoted to a character default — must survive
        genFile('bg-dup', 'sha-current'), // dedup copy of the current bg — must survive
        // not GENERATED → never a candidate
        { id: 'plain-upload', source: 'UPLOAD', category: 'IMAGE', sha256: 'sha-up', size: 100, linkedTo: ['chat-stale'] },
      ];
    }),
  };

  characters = {
    findByDefaultImageId: jest.fn(async (id: string) => (id === 'char-default' ? [{ id: 'char-x' }] : [])),
    findByAvatarOverrideImageId: jest.fn(async () => []),
  };

  chats = {
    findAll: jest.fn(async () => [staleChat, activeChat]),
    getLastPlayedMessageAt: jest.fn(async (id: string) =>
      id in lastPlayedByChat ? lastPlayedByChat[id] : null,
    ),
  };

  mockGetRepositories.mockReturnValue({ files, characters, chats } as any);

  // Keep-set ids resolve to their content hashes (legacy files.id shape here).
  const shaById: Record<string, string> = { 'bg-current': 'sha-current', 'av-current': 'sha-avc' };
  mockResolveAvatar.mockImplementation(async (id) =>
    id && shaById[id] ? ({ id, kind: 'legacy-file', sha256: shaById[id] } as any) : null,
  );

  // Only the album-saved bytes surface a keep-worthy link.
  mockLinkSummary.mockImplementation(async (sha) =>
    sha === 'sha-album'
      ? ({ count: 1, linkers: [{ isPhotoAlbum: true, mountStoreType: 'character' }] } as any)
      : { count: 0, linkers: [] },
  );

  mockDeleteFile.mockResolvedValue(true);
});

describe('collapseStaleChatAssets', () => {
  it('collapses a stale chat to only its current background + avatar', async () => {
    const summary = await collapseStaleChatAssets(NOW);

    // Three superseded generated assets reaped; everything else preserved.
    expect(mockDeleteFile).toHaveBeenCalledTimes(3);
    const deletedIds = mockDeleteFile.mock.calls.map((c) => c[0]).sort();
    expect(deletedIds).toEqual(['av-old', 'bg-old1', 'bg-old2']);

    expect(summary.chatsScanned).toBe(2);
    expect(summary.staleChats).toBe(1);
    expect(summary.chatsCollapsed).toBe(1);
    expect(summary.filesDeleted).toBe(3);
  });

  it('never touches the current background or avatar (in the keep-set)', async () => {
    await collapseStaleChatAssets(NOW);
    const deletedIds = mockDeleteFile.mock.calls.map((c) => c[0]);
    expect(deletedIds).not.toContain('bg-current');
    expect(deletedIds).not.toContain('av-current');
  });

  it('preserves a dedup copy that shares the current asset sha256', async () => {
    await collapseStaleChatAssets(NOW);
    const deletedIds = mockDeleteFile.mock.calls.map((c) => c[0]);
    expect(deletedIds).not.toContain('bg-dup');
  });

  it('never deletes an image saved to an album / vault', async () => {
    await collapseStaleChatAssets(NOW);
    const deletedIds = mockDeleteFile.mock.calls.map((c) => c[0]);
    expect(deletedIds).not.toContain('album-saved');
  });

  it('never deletes an image promoted to a character default/override', async () => {
    await collapseStaleChatAssets(NOW);
    const deletedIds = mockDeleteFile.mock.calls.map((c) => c[0]);
    expect(deletedIds).not.toContain('char-default');
  });

  it('never touches an active (non-stale) chat', async () => {
    await collapseStaleChatAssets(NOW);
    expect(files.findByLinkedTo).toHaveBeenCalledWith('chat-stale');
    expect(files.findByLinkedTo).not.toHaveBeenCalledWith('chat-active');
  });

  it('aborts a chat collapse (deletes nothing) when a keep-id fails to resolve', async () => {
    // A transient resolve failure must not leave the current asset unprotected:
    // skip the whole chat rather than risk deleting it.
    mockResolveAvatar.mockRejectedValue(new Error('transient repo error'));

    const summary = await collapseStaleChatAssets(NOW);

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(summary.staleChats).toBe(1);
    expect(summary.chatsCollapsed).toBe(0);
    expect(summary.filesDeleted).toBe(0);
  });

  it('treats a chat as stale by last PLAYED message, ignoring a recent Staff announcement', async () => {
    // The chat's lastMessageAt/updatedAt look recent (a feature whisper bumped
    // them), but no participant/user has spoken in 40 days. It must still be
    // stale and get collapsed.
    const freshlyWhisperedChat = {
      ...staleChat,
      lastMessageAt: isoDaysAgo(1),
      updatedAt: isoDaysAgo(1),
    };
    chats.findAll.mockResolvedValue([freshlyWhisperedChat, activeChat]);
    // getLastPlayedMessageAt still reports the real 40-day-old activity.

    const summary = await collapseStaleChatAssets(NOW);

    expect(summary.staleChats).toBe(1);
    expect(summary.chatsCollapsed).toBe(1);
    expect(mockDeleteFile).toHaveBeenCalled();
  });

  it('is NOT stale when a participant/user spoke recently, even if long-lived', async () => {
    lastPlayedByChat['chat-stale'] = isoDaysAgo(2);
    const summary = await collapseStaleChatAssets(NOW);
    expect(summary.staleChats).toBe(0);
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('falls back to updatedAt when the chat has no played messages at all', async () => {
    // No participant/user message ever (null) → use updatedAt (40 days) → stale.
    lastPlayedByChat['chat-stale'] = null;
    const summary = await collapseStaleChatAssets(NOW);
    expect(summary.staleChats).toBe(1);
    expect(summary.chatsCollapsed).toBe(1);
  });

  it('is idempotent — a chat with only its current assets is a no-op', async () => {
    files.findByLinkedTo.mockImplementation(async (id: string) =>
      id === 'chat-stale'
        ? [genFile('bg-current', 'sha-current'), genFile('av-current', 'sha-avc')]
        : [],
    );
    const summary = await collapseStaleChatAssets(NOW);
    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(summary.chatsCollapsed).toBe(0);
  });
});
