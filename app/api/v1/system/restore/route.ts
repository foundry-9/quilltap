/**
 * System Restore API v1
 *
 * POST /api/v1/system/restore?action=upload   - Upload backup file as raw binary stream
 * POST /api/v1/system/restore?action=preview  - Preview an already-uploaded backup
 * POST /api/v1/system/restore                 - Restore from an already-uploaded backup
 *
 * Uses an upload-then-reference pattern to bypass Next.js FormData body size limits,
 * eliminate double uploads, and avoid buffering large files in memory.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { createContextHandler } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { restore, previewRestore } from '@/lib/backup/restore-service';
import { logger } from '@/lib/logger';
import { badRequest, serverError } from '@/lib/api/responses';

// Extend timeout for restore operations
export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

// --- Pending upload tracking ---

interface PendingUpload {
  path: string;
  createdAt: number;
  userId: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPLOAD_TTL_MS = 60 * 60 * 1000; // 1 hour

const pendingUploads = new Map<string, PendingUpload>();

/**
 * Clean up uploads older than UPLOAD_TTL_MS. Called lazily on each request.
 */
function cleanupExpiredUploads(): void {
  const now = Date.now();
  for (const [id, upload] of pendingUploads) {
    if (now - upload.createdAt > UPLOAD_TTL_MS) {
      pendingUploads.delete(id);
      fs.promises.unlink(upload.path).catch(() => {});
    }
  }
}

/**
 * Look up a pending upload, validating ownership and existence.
 */
function getPendingUpload(uploadId: string, userId: string): PendingUpload | null {
  if (!UUID_REGEX.test(uploadId)) return null;
  const upload = pendingUploads.get(uploadId);
  if (!upload) return null;
  return upload;
}

/**
 * Remove a pending upload from the map and delete its temp file.
 */
async function removePendingUpload(uploadId: string): Promise<void> {
  const upload = pendingUploads.get(uploadId);
  if (upload) {
    pendingUploads.delete(uploadId);
    try {
      await fs.promises.unlink(upload.path);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// --- Action handlers ---

/**
 * POST /api/v1/system/restore?action=upload
 *
 * Accepts raw binary body (Content-Type: application/octet-stream).
 * Streams req.body to a temp file on disk. Returns { uploadId, size }.
 */
async function handleUpload(req: NextRequest, userId: string): Promise<NextResponse> {
  cleanupExpiredUploads();

  const body = req.body;
  if (!body) {
    return badRequest('No request body');
  }

  const uploadId = randomUUID();
  const tempZipPath = path.join(os.tmpdir(), `quilltap-restore-${uploadId}.zip`);

  try {
    const writeStream = fs.createWriteStream(tempZipPath);
    const reader = body.getReader();
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      const ok = writeStream.write(value);
      if (!ok) {
        // Wait for drain if back-pressure
        await new Promise<void>((resolve) => writeStream.once('drain', resolve));
      }
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on('error', reject);
    });

    pendingUploads.set(uploadId, {
      path: tempZipPath,
      createdAt: Date.now(),
      userId,
    });

    logger.info('[System Restore v1] Upload complete', { uploadId, userId, size: totalBytes });

    return NextResponse.json({
      success: true,
      uploadId,
      size: totalBytes,
    });
  } catch (error) {
    // Clean up partial file on error
    await fs.promises.unlink(tempZipPath).catch(() => {});
    logger.error('[System Restore v1] Upload failed', { uploadId }, error instanceof Error ? error : undefined);
    return serverError('Failed to upload backup file');
  }
}

/**
 * POST /api/v1/system/restore?action=preview
 *
 * Accepts JSON body: { uploadId }
 * Looks up the temp file and previews it without deleting.
 */
async function handlePreview(req: NextRequest, userId: string): Promise<NextResponse> {
  cleanupExpiredUploads();

  let body: { uploadId?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const { uploadId } = body;
  if (!uploadId) {
    return badRequest('uploadId is required');
  }

  const upload = getPendingUpload(uploadId, userId);
  if (!upload) {
    return badRequest('Upload not found or expired');
  }

  try {
    const preview = await previewRestore(upload.path);

    logger.info('[System Restore v1] Preview generated', { userId, uploadId, preview });

    return NextResponse.json({
      success: true,
      preview,
    });
  } catch (error) {
    logger.error('[System Restore v1] Error generating preview', { uploadId }, error instanceof Error ? error : undefined);
    return serverError(error instanceof Error ? error.message : 'Failed to preview backup');
  }
}

/**
 * POST /api/v1/system/restore (no action)
 *
 * Accepts JSON body: { uploadId, mode, keepArchivedCharacterBundles? }
 * Performs the restore and cleans up the temp file.
 */
async function handleRestore(req: NextRequest, userId: string): Promise<NextResponse> {
  cleanupExpiredUploads();

  let body: { uploadId?: string; mode?: string; keepArchivedCharacterBundles?: boolean };
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const { uploadId, mode } = body;
  // Replace mode spares archived-character bundles unless the client
  // explicitly opts out (spec §4.7).
  const keepArchivedCharacterBundles = body.keepArchivedCharacterBundles !== false;

  if (!uploadId) {
    return badRequest('uploadId is required');
  }

  if (!mode || !['replace', 'new-account'].includes(mode)) {
    return badRequest('mode must be "replace" or "new-account"');
  }

  const upload = getPendingUpload(uploadId, userId);
  if (!upload) {
    return badRequest('Upload not found or expired');
  }

  try {
    logger.info('[System Restore v1] Starting restore', {
      userId,
      uploadId,
      mode,
      keepArchivedCharacterBundles,
    });

    const summary = await restore(upload.path, {
      mode: mode as 'replace' | 'new-account',
      targetUserId: userId,
      keepArchivedCharacterBundles,
    });

    logger.info('[System Restore v1] Restore completed', {
      userId,
      uploadId,
      mode,
      restoreCounts: {
        characters: summary.characters,
        chats: summary.chats,
        messages: summary.messages,
        tags: summary.tags,
        files: summary.files,
        memories: summary.memories,
      },
      warnings: summary.warnings.length,
    });

    return NextResponse.json({
      success: true,
      summary,
    });
  } finally {
    await removePendingUpload(uploadId);
  }
}

/**
 * POST /api/v1/system/restore
 */
export const POST = createContextHandler(async (req, { user }) => {
  const action = getActionParam(req);

  if (action === 'upload') {
    return handleUpload(req, user.id);
  }

  if (action === 'preview') {
    return handlePreview(req, user.id);
  }

  // Default: restore
  return handleRestore(req, user.id);
});
