/**
 * Projects API v1 - Default Aesthetic Actions
 *
 * GET /api/v1/projects/[id]?action=aesthetic&kind=lantern|aurora
 *   - Read this project's official-store aesthetic file (single tier; no fallback).
 * PUT /api/v1/projects/[id]?action=aesthetic&kind=lantern|aurora
 *   - Write (or, when the body is empty, delete) that file. Deleting restores the
 *     Quilltap General fallback for image generation.
 *
 * These are doc-store files (`lantern-aesthetics.md` / `aurora-aesthetics.md`) in
 * the project's OFFICIAL document store — not project properties.
 */

import { NextRequest, NextResponse } from 'next/server';
import { exists } from '@/lib/api/middleware';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import type { RequestContext } from '@/lib/api/middleware';
import {
  parseAestheticKind,
  aestheticContentSchema,
  readAesthetic,
  writeAesthetic,
} from '@/lib/image-gen/aesthetic';

export async function handleGetAesthetic(
  req: NextRequest,
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!exists(project)) {
    return notFound('Project');
  }
  const kind = parseAestheticKind(req);
  if (!kind) {
    return badRequest('Query param "kind" must be "lantern" or "aurora"');
  }
  if (!project.officialMountPointId) {
    return successResponse({ content: '' });
  }
  const content = await readAesthetic(project.officialMountPointId, kind);
  return successResponse({ content });
}

export async function handlePutAesthetic(
  req: NextRequest,
  projectId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const project = await repos.projects.findById(projectId);
  if (!exists(project)) {
    return notFound('Project');
  }
  const kind = parseAestheticKind(req);
  if (!kind) {
    return badRequest('Query param "kind" must be "lantern" or "aurora"');
  }
  if (!project.officialMountPointId) {
    return serverError('Project has no official document store to write the aesthetic into');
  }
  const body = await req.json().catch(() => ({}));
  const content = aestheticContentSchema.safeParse(body).data?.content ?? '';
  await writeAesthetic(project.officialMountPointId, kind, content);
  logger.info('[Projects v1] Project aesthetic updated', {
    projectId,
    kind,
    length: content.trim().length,
    deleted: content.trim().length === 0,
    userId: user.id,
  });
  return successResponse({ success: true });
}
