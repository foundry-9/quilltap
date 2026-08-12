/**
 * Chats API v1 - Tag Actions
 *
 * Handles add-tag and remove-tag actions
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound } from '@/lib/api/responses';
import { addTagSchema, removeTagSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Add a tag to a chat
 */
export async function handleAddTag(
  req: NextRequest,
  chatId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const validatedData = addTagSchema.parse(body);

  const tag = await repos.tags.findById(validatedData.tagId);
  if (!tag) {
    return notFound('Tag');
  }

  await repos.chats.addTag(chatId, validatedData.tagId);

  logger.info('[Chats v1] Tag added', { chatId, tagId: validatedData.tagId });

  return NextResponse.json({ success: true, tag }, { status: 201 });
}

/**
 * Remove a tag from a chat
 */
export async function handleRemoveTag(
  req: NextRequest,
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const validatedData = removeTagSchema.parse(body);

  await repos.chats.removeTag(chatId, validatedData.tagId);

  logger.info('[Chats v1] Tag removed', { chatId, tagId: validatedData.tagId });

  return NextResponse.json({ success: true });
}
