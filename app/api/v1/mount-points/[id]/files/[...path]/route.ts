/**
 * Mount Points API v1 — Canonical per-file item endpoint.
 *
 * GET    /api/v1/mount-points/[id]/files/<path>  — Read file content
 * PUT    /api/v1/mount-points/[id]/files/<path>  — Write/overwrite file content
 * DELETE /api/v1/mount-points/[id]/files/<path>  — Delete the file
 * PATCH  /api/v1/mount-points/[id]/files/<path>  — Rename and/or set description
 *
 * This is the one file-CRUD surface for both the `quilltap docs` CLI and the
 * Scriptorium file browser/editor. Content round-trips as UTF-8 **or** base64
 * (so any file — text or binary — can be read and written), with mtime-based
 * optimistic concurrency for conflict detection.
 *
 * GET shapes:
 *   - default / `?encoding=utf-8` → JSON envelope (text, with optional
 *     `?offset`/`?limit` line window).
 *   - `?encoding=base64` → JSON envelope with base64 content (any file).
 *   - `?raw=1` or `Accept: application/octet-stream` → raw byte stream.
 *
 * Cross-mount move/copy/link and folder operations are NOT here — they live on
 * the action-dispatch route (`POST /api/v1/mount-points/[id]?action=...`)
 * because they involve a destination mount or are mount-scoped.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import { storeMountFile } from '@/lib/mount-index/store-file';
import { readMountFile, readMountFileBytes } from '@/lib/mount-index/read-file';
import { moveFile, deleteFile } from '@/lib/mount-index/file-ops';
import { FileOpError } from '@/lib/mount-index/file-op-error';
import { DatabaseStoreError } from '@/lib/mount-index/database-store';
import { fileOpStatus } from '@/lib/mount-index/file-op-status';

type Params = { id: string; path: string[] };

function joinPath(parts: string[]): string {
  try {
    return parts.map(p => decodeURIComponent(p)).join('/');
  } catch {
    // Malformed percent-encoding (e.g. a stray "%") — surface as a 400 rather
    // than letting decodeURIComponent's URIError become a generic 500.
    throw new FileOpError('Malformed percent-encoding in path', 'INVALID_PATH');
  }
}

function handleFileOpError(error: unknown, action: string, ctx: Record<string, unknown>): NextResponse {
  if (error instanceof FileOpError || error instanceof DatabaseStoreError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: fileOpStatus(error) });
  }
  logger.error(`[Mount Points v1] Error ${action}`, ctx, error instanceof Error ? error : undefined);
  return serverError(`Failed to ${action}`);
}

// ============================================================================
// GET — read file content
// ============================================================================

const readQuerySchema = z.object({
  encoding: z.enum(['utf-8', 'base64']).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100_000).optional(),
  raw: z.coerce.boolean().optional(),
});

export const GET = createContextParamsHandler<Params>(
  async (req: NextRequest, _ctx: RequestContext, { id, path }) => {
    // Raw (still-encoded) join for error-logging context until we can safely
    // decode; joinPath() may throw FileOpError on malformed encoding.
    let relativePath = path.join('/');
    try {
      relativePath = joinPath(path);
      const url = new URL(req.url);
      const parsed = readQuerySchema.safeParse({
        encoding: url.searchParams.get('encoding') ?? undefined,
        offset: url.searchParams.get('offset') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
        raw: url.searchParams.get('raw') ?? undefined,
      });
      if (!parsed.success) {
        return badRequest(`Invalid query: ${parsed.error.issues.map(i => i.message).join(', ')}`);
      }

      const accept = req.headers.get('accept') ?? '';
      const wantsRaw = parsed.data.raw === true || accept.includes('application/octet-stream');

      if (wantsRaw) {
        const { bytes, mimeType, sha256, sizeBytes } = await readMountFileBytes(id, relativePath);
        // Buffer is already a Uint8Array; hand back a bounds-respecting view
        // (no copy). The Response honours byteOffset/byteLength, so a pooled
        // Buffer can't bleed neighbouring bytes. The cast satisfies the DOM
        // BodyInit type, which wants Uint8Array<ArrayBuffer> rather than the
        // ArrayBufferLike-generic view.
        const body = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return new NextResponse(body as unknown as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Content-Length': String(sizeBytes),
            'Cache-Control': 'private, max-age=3600',
            'X-File-Sha256': sha256,
          },
        });
      }

      const result = await readMountFile(id, relativePath, {
        encoding: parsed.data.encoding,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
      return successResponse(result);
    } catch (error) {
      return handleFileOpError(error, 'read file', { mountPointId: id, relativePath });
    }
  }
);

// ============================================================================
// PUT — write/overwrite file content (JSON or multipart)
// ============================================================================

const writeBodySchema = z.object({
  content: z.string(),
  encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
  expected_mtime: z.number().int().nonnegative().optional(),
  force: z.boolean().optional(),
});

export const PUT = createContextParamsHandler<Params>(
  async (req: NextRequest, { user }: RequestContext, { id, path }) => {
    // Raw (still-encoded) join for error-logging context until we can safely
    // decode; joinPath() may throw FileOpError on malformed encoding.
    let relativePath = path.join('/');
    try {
      relativePath = joinPath(path);
      const contentType = req.headers.get('content-type') || '';
      let data: Buffer;
      let expectedMtime: number | undefined;
      let force: boolean | undefined;
      let originalMimeType: string | undefined;
      let originalFileName: string | undefined;

      if (contentType.includes('multipart/form-data')) {
        const form = await req.formData();
        const file = form.get('file');
        if (!(file instanceof File)) {
          return badRequest('Missing "file" field in multipart body');
        }
        data = Buffer.from(await file.arrayBuffer());
        originalMimeType = file.type || undefined;
        originalFileName = file.name || undefined;
        const mtimeRaw = form.get('expected_mtime');
        if (mtimeRaw != null && String(mtimeRaw) !== '') {
          const parsedMtime = Number(mtimeRaw);
          if (!Number.isInteger(parsedMtime) || parsedMtime < 0) {
            return badRequest('expected_mtime must be a non-negative integer');
          }
          expectedMtime = parsedMtime;
        }
        force = String(form.get('force') ?? '').toLowerCase() === 'true';
      } else {
        const body = await req.json().catch(() => null);
        const parsed = writeBodySchema.safeParse(body);
        if (!parsed.success) {
          return badRequest(`Invalid body: ${parsed.error.issues.map(i => i.message).join(', ')}`);
        }
        data = Buffer.from(parsed.data.content, parsed.data.encoding === 'base64' ? 'base64' : 'utf-8');
        expectedMtime = parsed.data.expected_mtime;
        force = parsed.data.force;
      }

      const result = await storeMountFile({
        mountPointId: id,
        relativePath,
        data,
        originalMimeType,
        originalFileName,
        expectedMtime,
        force,
        collisionStrategy: 'overwrite',
      });

      logger.info('[Mount Points v1] Wrote file (item route)', {
        mountPointId: id,
        relativePath: result.relativePath,
        kind: result.kind,
        sizeBytes: result.sizeBytes,
        userId: user.id,
      });

      return successResponse({
        mountPointId: result.mountPointId,
        relativePath: result.relativePath,
        kind: result.kind,
        fileType: result.fileType,
        sha256: result.sha256,
        sizeBytes: result.sizeBytes,
        mimeType: result.storedMimeType,
        mtime: result.mtime,
      });
    } catch (error) {
      return handleFileOpError(error, 'write file', { mountPointId: id, relativePath });
    }
  }
);

// ============================================================================
// DELETE
// ============================================================================

export const DELETE = createContextParamsHandler<Params>(
  async (_req: NextRequest, { user }: RequestContext, { id, path }) => {
    // Raw (still-encoded) join for error-logging context until we can safely
    // decode; joinPath() may throw FileOpError on malformed encoding.
    let relativePath = path.join('/');
    try {
      relativePath = joinPath(path);
      const result = await deleteFile({ mountPointId: id, relativePath });
      logger.info('[Mount Points v1] Deleted file (item route)', {
        mountPointId: id,
        relativePath,
        deleted: result.deleted,
        userId: user.id,
      });
      if (!result.deleted) return notFound('File');
      return successResponse(result);
    } catch (error) {
      return handleFileOpError(error, 'delete file', { mountPointId: id, relativePath });
    }
  }
);

// ============================================================================
// PATCH — rename and/or update description
// ============================================================================

const patchBodySchema = z
  .object({
    description: z.string().max(10_000).optional(),
    rename: z.string().min(1).optional(),
  })
  .refine(v => v.description !== undefined || v.rename !== undefined, {
    message: 'PATCH requires "description" or "rename"',
  });

export const PATCH = createContextParamsHandler<Params>(
  async (req: NextRequest, { user, repos }: RequestContext, { id, path }) => {
    // Raw (still-encoded) join for error-logging context until we can safely
    // decode; joinPath() may throw FileOpError on malformed encoding.
    let relativePath = path.join('/');
    try {
      relativePath = joinPath(path);
      const body = await req.json().catch(() => null);
      const parsed = patchBodySchema.safeParse(body);
      if (!parsed.success) {
        return badRequest(parsed.error.issues.map(i => i.message).join(', '));
      }

      let currentPath = relativePath;

      // Rename first (so a description update lands on the new path).
      if (parsed.data.rename) {
        const moved = await moveFile({
          sourceMountPointId: id,
          sourcePath: currentPath,
          destMountPointId: id,
          destPath: parsed.data.rename,
        });
        currentPath = moved.destPath;
        logger.info('[Mount Points v1] Renamed file (item route)', {
          mountPointId: id,
          from: relativePath,
          to: currentPath,
          userId: user.id,
        });
      }

      if (parsed.data.description !== undefined) {
        const meta = await repos.docMountBlobs.findByMountPointAndPath(id, currentPath);
        if (!meta) {
          return badRequest('Descriptions are only supported for binary (blob) files');
        }
        await repos.docMountBlobs.updateDescription(meta.id, parsed.data.description, meta.linkId);
      }

      const updated = await readMountFile(id, currentPath, { encoding: 'base64', limit: 1 }).catch(() => null);
      return successResponse({
        mountPointId: id,
        relativePath: currentPath,
        renamed: !!parsed.data.rename,
        descriptionUpdated: parsed.data.description !== undefined,
        fileType: updated?.fileType,
      });
    } catch (error) {
      return handleFileOpError(error, 'update file', { mountPointId: id, relativePath });
    }
  }
);
