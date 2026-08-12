/**
 * Mount Points API v1 — Blob Collection Endpoint
 *
 * GET  /api/v1/mount-points/[id]/blobs          — List blob metadata
 * POST /api/v1/mount-points/[id]/blobs          — Upload a blob (multipart/form-data)
 *
 * Both the upload here and the canonical per-file `PUT .../files/[...path]`
 * funnel through the single `storeMountFile` ingest pipeline
 * (`lib/mount-index/store-file.ts`): bitmap images are transcoded to WebP,
 * WebP/SVG/binaries are stored as-is, and PDF/DOCX uploads have their text
 * extracted and chunked for embedding. Native-text uploads to database-backed
 * stores route into `doc_mount_documents`; everything else into
 * `doc_mount_blobs`. `assetStorage: 'database'` keeps blob bytes in the
 * mount-index DB even for filesystem mounts so persisted
 * `<img src=".../blobs/<path>">` URLs stay resolvable.
 */

import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { badRequest, created, notFound, serverError } from '@/lib/api/responses';
import { storeMountFile } from '@/lib/mount-index/store-file';
import { FileOpError } from '@/lib/mount-index/file-op-error';
import { DatabaseStoreError } from '@/lib/mount-index/database-store';
import { fileOpStatus } from '@/lib/mount-index/file-op-status';

export const GET = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      const mountPoint = await repos.docMountPoints.findById(id);
      if (!mountPoint) return notFound('Mount point');

      const url = new URL(req.url);
      const folder = url.searchParams.get('folder') ?? undefined;
      const blobs = await repos.docMountBlobs.listByMountPoint(id, folder ? { folder } : {});
      return NextResponse.json({ blobs });
    } catch (error) {
      logger.error(
        '[Mount Points v1] Error listing blobs',
        { mountPointId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to list blobs');
    }
  }
);

export const POST = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      const mountPoint = await repos.docMountPoints.findById(id);
      if (!mountPoint) return notFound('Mount point');

      const contentType = req.headers.get('content-type') || '';
      if (!contentType.includes('multipart/form-data')) {
        return badRequest('Expected multipart/form-data');
      }

      const form = await req.formData();
      const file = form.get('file');
      const relativePath = String(form.get('path') ?? '').trim();
      const description = String(form.get('description') ?? '');

      if (!(file instanceof File)) {
        return badRequest('Missing "file" field in multipart body');
      }
      if (!relativePath) {
        return badRequest('Missing "path" field');
      }

      const rawBytes = Buffer.from(await file.arrayBuffer());
      if (rawBytes.length === 0) {
        return badRequest('Empty file payload');
      }
      const originalMimeType = file.type || 'application/octet-stream';
      const originalFileName = file.name || relativePath.split('/').pop() || 'blob';

      // Single ingest pipeline. `database` keeps blob bytes in the mount-index
      // DB even on filesystem mounts (preserving the legacy /blobs behaviour);
      // `overwrite` matches the prior upsert-in-place semantics.
      const result = await storeMountFile({
        mountPointId: id,
        relativePath,
        data: rawBytes,
        originalMimeType,
        originalFileName,
        description,
        assetStorage: 'database',
        collisionStrategy: 'overwrite',
      });

      if (result.kind === 'document') {
        logger.info('[Mount Points v1] Uploaded native-text document', {
          mountPointId: id,
          relativePath: result.relativePath,
          fileType: result.fileType,
          sizeBytes: result.sizeBytes,
          userId: user.id,
        });
        return created({
          document: {
            id: result.fileId ?? null,
            mountPointId: id,
            relativePath: result.relativePath,
            fileName: path.basename(result.relativePath),
            fileType: result.fileType,
            sizeBytes: result.sizeBytes,
            lastModified: new Date(result.mtime).toISOString(),
          },
        });
      }

      // Blob path — return the joined blob+link view the previous handler did.
      const blob = await repos.docMountBlobs.findByMountPointAndPath(id, result.relativePath);
      logger.info('[Mount Points v1] Uploaded blob', {
        mountPointId: id,
        relativePath: result.relativePath,
        storedMimeType: result.storedMimeType,
        sizeBytes: result.sizeBytes,
        fileType: result.fileType,
        userId: user.id,
      });
      return created({ blob });
    } catch (error) {
      if (error instanceof FileOpError || error instanceof DatabaseStoreError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: fileOpStatus(error) }
        );
      }
      logger.error(
        '[Mount Points v1] Error uploading blob',
        { mountPointId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to upload blob');
    }
  }
);
