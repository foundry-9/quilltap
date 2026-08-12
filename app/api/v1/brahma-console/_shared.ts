/**
 * Brahma Console API v1 - Shared Helpers
 *
 * Shared logic for the Brahma Console routes ([id] item endpoint and its
 * messages sub-endpoint).
 */

import { NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';
import { notFound } from '@/lib/api/responses';

/**
 * Verify the chat exists, belongs to the user, and is a Brahma Console chat.
 * Returns the typed chat on success, or a 404 NextResponse otherwise.
 */
export async function verifyBrahmaChat(
  id: string,
  context: RequestContext
): Promise<{ chat: ChatMetadata } | NextResponse> {
  const { user, repos } = context;
  const chat = await repos.chats.findById(id);

  if (!chat || chat.userId !== user.id || chat.chatType !== 'brahma') {
    return notFound('Brahma Console chat');
  }

  return { chat };
}
