/**
 * Unit tests for the mailbox-list action handler (The Post Office).
 *
 * GET /api/v1/chats/[id]?action=mailbox&characterId=…
 *
 * Covers the authorization guard (only a user-controlled participant of THIS
 * chat), the happy path (newest-first letters mapped to {path,from,sentAt}), and
 * a missing characterId.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockListMailbox = jest.fn();
jest.mock('@/lib/post-office/mailbox', () => ({
  listMailbox: (...args: unknown[]) => mockListMailbox(...args),
}));

const mockEnsureCharacterVault = jest.fn();
jest.mock('@/lib/mount-index/character-vault', () => ({
  ensureCharacterVault: (...args: unknown[]) => mockEnsureCharacterVault(...args),
}));

import { handleGetMailbox } from '@/app/api/v1/chats/[id]/actions/mailbox';
import type { RequestContext } from '@/lib/api/middleware';

const PLAYER = 'char-player';
const NPC = 'char-npc';

const CHAT = {
  id: 'chat-1',
  participants: [
    { id: 'p-1', type: 'CHARACTER', characterId: PLAYER, controlledBy: 'user', removedAt: null },
    { id: 'p-2', type: 'CHARACTER', characterId: NPC, controlledBy: 'llm', removedAt: null },
  ],
};

function createRequest(characterId?: string): NextRequest {
  const qs = characterId === undefined ? '' : `&characterId=${encodeURIComponent(characterId)}`;
  return new NextRequest(`http://localhost:3000/api/v1/chats/chat-1?action=mailbox${qs}`);
}

function ctx(): RequestContext {
  return {
    user: { id: 'user-1' },
    repos: {
      chats: { findById: jest.fn().mockResolvedValue(CHAT) },
      characters: {
        findByIdRaw: jest.fn((id: string) =>
          Promise.resolve(id === PLAYER ? { id: PLAYER, name: 'Bertie' } : id === NPC ? { id: NPC, name: 'Jeeves' } : null),
        ),
      },
    },
  } as unknown as RequestContext;
}

describe('handleGetMailbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnsureCharacterVault.mockResolvedValue({ mountPointId: 'vault-1', created: false });
  });

  it('returns the player-character mailbox letters (newest-first, mapped)', async () => {
    mockListMailbox.mockResolvedValue([
      { path: 'Mail/2.md', from: 'Aunt Agatha', sentAt: '2026-06-14T10:00:00.000Z', body: 'b', alerted: false, inReplyTo: null },
      { path: 'Mail/1.md', from: 'Jeeves', sentAt: '2026-06-13T10:00:00.000Z', body: 'a', alerted: true, inReplyTo: null },
    ]);

    const res = await handleGetMailbox(createRequest(PLAYER), 'chat-1', ctx());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockListMailbox).toHaveBeenCalledWith('vault-1');
    // Order preserved from listMailbox (which sorts newest-first); body/alerted dropped.
    expect(data.letters).toEqual([
      { path: 'Mail/2.md', from: 'Aunt Agatha', sentAt: '2026-06-14T10:00:00.000Z' },
      { path: 'Mail/1.md', from: 'Jeeves', sentAt: '2026-06-13T10:00:00.000Z' },
    ]);
  });

  it('refuses a character that is not a user-controlled participant of this chat', async () => {
    const res = await handleGetMailbox(createRequest(NPC), 'chat-1', ctx());

    expect(res.status).toBe(403);
    expect(mockListMailbox).not.toHaveBeenCalled();
  });

  it('returns 400 when characterId is missing', async () => {
    const res = await handleGetMailbox(createRequest(undefined), 'chat-1', ctx());

    expect(res.status).toBe(400);
    expect(mockListMailbox).not.toHaveBeenCalled();
  });
});
