/**
 * User Photo Gallery API v1 - Collection Endpoint
 *
 * GET  /api/v1/photos          List the user's gallery (with optional query/tags/pagination)
 * POST /api/v1/photos          Save an image (image-v2 FileEntry id) to the gallery
 *
 * Backed by `lib/photos/user-gallery-service.ts`. The gallery lives at
 * `<userUploadsMountPointId>/photos/` and dedupes by sha256, so saving the
 * same image twice is rejected with a clear error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createContextHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { successResponse, created, badRequest, serverError } from '@/lib/api/responses';
import {
  saveToUserGallery,
  listUserGallery,
} from '@/lib/photos/user-gallery-service';

const saveSchema = z.object({
  fileId: z.string().min(1, 'fileId is required'),
  caption: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  chatId: z.string().nullable().optional(),
});

const listQuerySchema = z.object({
  q: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export const GET = createContextHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const url = new URL(req.url);
    const rawTags = url.searchParams.getAll('tag');
    const parsed = listQuerySchema.safeParse({
      q: url.searchParams.get('q') ?? undefined,
      tags: rawTags.length > 0 ? rawTags : undefined,
      limit: url.searchParams.has('limit')
        ? Number(url.searchParams.get('limit'))
        : undefined,
      offset: url.searchParams.has('offset')
        ? Number(url.searchParams.get('offset'))
        : undefined,
    });
    if (!parsed.success) {
      return badRequest(parsed.error.issues.map(i => i.message).join('; '));
    }

    const result = await listUserGallery({
      query: parsed.data.q,
      tags: parsed.data.tags,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      userId: user.id,
      repos,
    });

    return successResponse(result);
  } catch (error) {
    logger.error('[Photos v1] Error listing user gallery', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to list gallery');
  }
});

export const POST = createContextHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const body = await req.json();
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.issues.map(i => i.message).join('; '));
    }

    const result = await saveToUserGallery({
      fileId: parsed.data.fileId,
      caption: parsed.data.caption ?? null,
      tags: parsed.data.tags,
      chatId: parsed.data.chatId ?? null,
      userId: user.id,
      repos,
    });

    return created(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save image';
    // Save guard collisions, "not owned", "not an image" etc. surface as
    // user-correctable 400s so the UI can show a friendly inline error.
    if (
      message.includes('already saved') ||
      message.includes('not an image') ||
      message.includes('not owned') ||
      message.includes('Image not found') ||
      message.includes('Quilltap Uploads mount has not been provisioned')
    ) {
      return badRequest(message);
    }
    logger.error('[Photos v1] Error saving to gallery', { userId: user.id }, error instanceof Error ? error : undefined);
    return serverError(message);
  }
});
