/**
 * Unit tests for the Compose Mail action handler (The Post Office).
 *
 * POST /api/v1/chats/[id]?action=send-mail
 *
 * Covers the authorization guard (from-character must be a user-controlled
 * participant of THIS chat), the happy path (delivers via the shared service),
 * the reply-not-found surface, and a missing recipient.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockComposeAndDeliverLetter = jest.fn();
jest.mock('@/lib/post-office/deliver', () => ({
  composeAndDeliverLetter: (...args: unknown[]) => mockComposeAndDeliverLetter(...args),
}));

import { handleSendMail } from '@/app/api/v1/chats/[id]/actions/send-mail';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';

const PLAYER = 'a0000000-0000-4000-8000-000000000001';
const NPC = 'a0000000-0000-4000-8000-000000000002';

const CHAT = {
  id: 'chat-1',
  participants: [
    { id: 'p-1', type: 'CHARACTER', characterId: PLAYER, controlledBy: 'user', removedAt: null },
    { id: 'p-2', type: 'CHARACTER', characterId: NPC, controlledBy: 'llm', removedAt: null },
  ],
} as unknown as ChatMetadata;

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/chats/chat-1?action=send-mail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function ctxWith(chars: Record<string, { id: string; name: string } | undefined>): RequestContext {
  return {
    user: { id: 'user-1', name: 'Operator' },
    repos: {
      characters: {
        findByIdRaw: jest.fn((id: string) => Promise.resolve(chars[id] ?? null)),
      },
    },
  } as unknown as RequestContext;
}

describe('handleSendMail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockComposeAndDeliverLetter.mockResolvedValue({ ok: true, path: 'Mail/123-from-bertie.md' });
  });

  it('rejects a from-character that is not a user-controlled participant of the chat', async () => {
    // NPC is controlledBy 'llm' — the operator can't sign as it.
    const req = createRequest({ fromCharacterId: NPC, toCharacterId: PLAYER, bodyMarkdown: 'Dear sir' });
    const ctx = ctxWith({ [PLAYER]: { id: PLAYER, name: 'Bertie' }, [NPC]: { id: NPC, name: 'Jeeves' } });

    const res = await handleSendMail(req, 'chat-1', CHAT, ctx);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/character you are playing/i);
    expect(mockComposeAndDeliverLetter).not.toHaveBeenCalled();
  });

  it('delivers via the shared service for a valid player-character and returns the path', async () => {
    const chars = { [PLAYER]: { id: PLAYER, name: 'Bertie' }, [NPC]: { id: NPC, name: 'Jeeves' } };
    const req = createRequest({ fromCharacterId: PLAYER, toCharacterId: NPC, bodyMarkdown: 'Dear Jeeves' });

    const res = await handleSendMail(req, 'chat-1', CHAT, ctxWith(chars));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.path).toBe('Mail/123-from-bertie.md');
    expect(mockComposeAndDeliverLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: chars[PLAYER],
        recipient: chars[NPC],
        message: 'Dear Jeeves',
        inReplyTo: null,
      }),
    );
  });

  it('forwards inReplyToPath and surfaces a 400 when the reply target is gone', async () => {
    mockComposeAndDeliverLetter.mockResolvedValue({ ok: false, reason: 'reply-not-found' });
    const chars = { [PLAYER]: { id: PLAYER, name: 'Bertie' }, [NPC]: { id: NPC, name: 'Jeeves' } };
    const req = createRequest({
      fromCharacterId: PLAYER,
      toCharacterId: NPC,
      bodyMarkdown: 'A reply',
      inReplyToPath: 'Mail/999-from-aunt.md',
    });

    const res = await handleSendMail(req, 'chat-1', CHAT, ctxWith(chars));
    const data = await res.json();

    expect(mockComposeAndDeliverLetter).toHaveBeenCalledWith(
      expect.objectContaining({ inReplyTo: 'Mail/999-from-aunt.md' }),
    );
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/reply/i);
  });

  it('returns 404 when the recipient character no longer exists', async () => {
    // Only the sender resolves; the recipient is missing.
    const chars = { [PLAYER]: { id: PLAYER, name: 'Bertie' } };
    const req = createRequest({ fromCharacterId: PLAYER, toCharacterId: NPC, bodyMarkdown: 'Hello?' });

    const res = await handleSendMail(req, 'chat-1', CHAT, ctxWith(chars));

    expect(res.status).toBe(404);
    expect(mockComposeAndDeliverLetter).not.toHaveBeenCalled();
  });
});
