/**
 * Mount Points API v1 — Blob Item Endpoint
 *
 * GET    /api/v1/mount-points/[id]/blobs/*  — Stream blob bytes
 * DELETE /api/v1/mount-points/[id]/blobs/*  — Remove a blob
 * PATCH  /api/v1/mount-points/[id]/blobs/*  — Update the blob's description
 *
 * The [...path] catch-all carries the blob's relativePath within the mount
 * point (e.g. "images/avatar.webp"). This keeps Markdown references like
 * `![alt](images/avatar.webp)` resolvable against `/api/v1/mount-points/:id/blobs/`.
 *
 * Text documents (Markdown/txt/JSON/JSONL) live in `doc_mount_documents`, not
 * `doc_mount_blobs`, so GET and DELETE fall back to the documents table when
 * no blob matches — callers hit a single URL scheme regardless of where the
 * bytes actually live.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { notFound, serverError, successResponse } from '@/lib/api/responses';
import { buildContentDisposition } from '@/lib/api/content-disposition';
import { deleteDatabaseDocument } from '@/lib/mount-index/database-store';
import type { DocMountDocument } from '@/lib/schemas/mount-index.types';

type Params = { id: string; path: string[] };

function joinPath(parts: string[]): string {
  return parts.map(p => decodeURIComponent(p)).join('/');
}

function mimeForDocument(doc: { fileType?: string }): string {
  switch (doc.fileType) {
    case 'markdown': return 'text/markdown; charset=utf-8';
    case 'txt': return 'text/plain; charset=utf-8';
    case 'json': return 'application/json; charset=utf-8';
    case 'jsonl': return 'application/jsonl; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

export const GET = createContextParamsHandler<Params>(
  async (_req: NextRequest, { repos }: RequestContext, { id, path }) => {
    try {
      const relativePath = joinPath(path);
      const meta = await repos.docMountBlobs.findByMountPointAndPath(id, relativePath);
      if (meta) {
        const data = await repos.docMountBlobs.readData(meta.id);
        if (!data) return notFound('Blob data');

        // Copy into a fresh Uint8Array — Next.js' NextResponse body expects a
        // BlobPart / Uint8Array, and a Buffer's backing pool may otherwise
        // bleed unrelated bytes.
        const body = new Uint8Array(data.length);
        data.copy(body);

        return new NextResponse(body, {
          status: 200,
          headers: {
            'Content-Type': meta.storedMimeType,
            'Content-Length': String(meta.sizeBytes),
            // The stored basename, not originalFileName — images are transcoded
            // to WebP on upload, so the original name's extension can mismatch
            // the bytes actually served here.
            'Content-Disposition': buildContentDisposition(
              relativePath.split('/').pop() || meta.originalFileName || 'file',
              'inline'
            ),
            'Cache-Control': 'private, max-age=3600',
            'X-Blob-Sha256': meta.sha256,
          },
        });
      }

      const doc = await repos.docMountDocuments.findByMountPointAndPath(id, relativePath);
      if (!doc) return notFound('Blob');

      const bytes = Buffer.from(doc.content, 'utf-8');
      const body = new Uint8Array(bytes.length);
      bytes.copy(body);

      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': mimeForDocument(doc),
          'Content-Length': String(bytes.length),
          'Content-Disposition': buildContentDisposition(
            relativePath.split('/').pop() || 'document',
            'inline'
          ),
          'Cache-Control': 'private, max-age=3600',
          'X-Blob-Sha256': doc.contentSha256,
        },
      });
    } catch (error) {
      logger.error(
        '[Mount Points v1] Error serving blob',
        { mountPointId: id, path },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to serve blob');
    }
  }
);

export const DELETE = createContextParamsHandler<Params>(
  async (_req: NextRequest, { user, repos }: RequestContext, { id, path }) => {
    try {
      const relativePath = joinPath(path);
      const deleted = await repos.docMountBlobs.deleteByMountPointAndPath(id, relativePath);
      if (deleted) {
        logger.info('[Mount Points v1] Deleted blob', {
          mountPointId: id,
          relativePath,
          userId: user.id,
        });
        return successResponse({ success: true });
      }

      // Text documents live in doc_mount_documents with a matching
      // doc_mount_files index row and chunks; deleteDatabaseDocument cleans
      // all three up and emits the store event.
      const docDeleted = await deleteDatabaseDocument(id, relativePath);
      if (!docDeleted) return notFound('Blob');
      logger.info('[Mount Points v1] Deleted document', {
        mountPointId: id,
        relativePath,
        userId: user.id,
      });
      return successResponse({ success: true });
    } catch (error) {
      logger.error(
        '[Mount Points v1] Error deleting blob',
        { mountPointId: id, path },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to delete blob');
    }
  }
);

export const PATCH = createContextParamsHandler<Params>(
  async (req: NextRequest, { user, repos }: RequestContext, { id, path }) => {
    try {
      const relativePath = joinPath(path);
      const meta = await repos.docMountBlobs.findByMountPointAndPath(id, relativePath);
      if (!meta) return notFound('Blob');
      const body = await req.json();
      const description = typeof body?.description === 'string' ? body.description : '';
      const updated = await repos.docMountBlobs.updateDescription(meta.id, description);
      logger.info('[Mount Points v1] Updated blob description', {
        mountPointId: id,
        relativePath,
        userId: user.id,
      });
      return successResponse({ blob: updated });
    } catch (error) {
      logger.error(
        '[Mount Points v1] Error updating blob description',
        { mountPointId: id, path },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to update blob description');
    }
  }
);
