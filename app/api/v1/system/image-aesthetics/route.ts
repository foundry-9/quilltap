/**
 * System API v1 - Default Image Aesthetics
 *
 * GET /api/v1/system/image-aesthetics?kind=lantern|aurora
 *   - Read the Quilltap General store's aesthetic file (single tier; no fallback).
 * PUT /api/v1/system/image-aesthetics?kind=lantern|aurora
 *   - Write (or, when the body is empty, delete) that file.
 *
 * These back the two "Default Aesthetic" editors on the Images settings tab.
 * `kind=lantern` → `lantern-aesthetics.md` (general/scene look);
 * `kind=aurora`  → `aurora-aesthetics.md` (how people and outfits are depicted).
 * The doc-store file is the source of truth; the editors are views over it.
 */

import { NextRequest } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { successResponse, badRequest, serverError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import {
  parseAestheticKind,
  aestheticContentSchema,
  readAesthetic,
  writeAesthetic,
} from '@/lib/image-gen/aesthetic';

export const GET = createContextHandler(async (req: NextRequest) => {
  const kind = parseAestheticKind(req);
  if (!kind) {
    return badRequest('Query param "kind" must be "lantern" or "aurora"');
  }
  const mountId = await getGeneralMountPointId();
  if (!mountId) {
    // Quilltap General store not provisioned yet — nothing to show.
    return successResponse({ content: '' });
  }
  const content = await readAesthetic(mountId, kind);
  return successResponse({ content });
});

export const PUT = createContextHandler(async (req: NextRequest, { user }) => {
  const kind = parseAestheticKind(req);
  if (!kind) {
    return badRequest('Query param "kind" must be "lantern" or "aurora"');
  }
  const mountId = await getGeneralMountPointId();
  if (!mountId) {
    return serverError('Quilltap General document store is not available');
  }
  const body = await req.json().catch(() => ({}));
  const content = aestheticContentSchema.safeParse(body).data?.content ?? '';
  await writeAesthetic(mountId, kind, content);
  logger.info('[System v1] Default image aesthetic updated', {
    kind,
    mountPointId: mountId,
    length: content.trim().length,
    deleted: content.trim().length === 0,
    userId: user.id,
  });
  return successResponse({ success: true });
});
