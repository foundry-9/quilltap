/**
 * File Serving API Route
 *
 * Serves files from the centralized file storage (local filesystem or S3).
 * GET /api/files/:id - Retrieve a file by ID
 * DELETE /api/files/:id - Delete a file by ID
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { isS3Enabled } from '@/lib/s3/config';
import { downloadFile as downloadS3File, getPresignedUrl, deleteFile as deleteS3File } from '@/lib/s3/operations';
import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';

const LOCAL_STORAGE_DIR = 'public/data/files/storage';

/**
 * Read a file from local storage
 */
async function readLocalFile(fileId: string, originalFilename: string): Promise<Buffer> {
  const ext = extname(originalFilename) || '';
  const localPath = join(LOCAL_STORAGE_DIR, `${fileId}${ext}`);
  return await fs.readFile(localPath);
}

/**
 * GET /api/files/:id
 * Retrieve a file by its ID
 * Supports both local filesystem and S3 storage
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: fileId } = await params;

    // Get file metadata from repository (supports MongoDB and JSON backends)
    const repos = getRepositories();
    const fileEntry = await repos.files.findById(fileId);
    if (!fileEntry) {
      logger.debug('File not found', { context: 'GET /api/files/[id]', fileId });
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    logger.debug('Serving file', { context: 'GET /api/files/[id]', fileId, hasS3Key: !!fileEntry.s3Key });

    // Check if file should be served from S3
    const s3Enabled = isS3Enabled();
    if (s3Enabled && fileEntry.s3Key) {
      logger.debug('S3 enabled and file has s3Key, attempting S3 serving', {
        context: 'GET /api/files/[id]',
        fileId,
        s3Key: fileEntry.s3Key,
        fileSize: fileEntry.size,
      });

      try {
        // Check if we should use presigned URL redirect or proxy through API
        // For HTTP endpoints (e.g., local MinIO), we must proxy to avoid mixed content issues
        // when the app is served over HTTPS
        const s3Endpoint = process.env.S3_ENDPOINT || '';
        const isHttpEndpoint = s3Endpoint.startsWith('http://');
        const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB

        // Use presigned URL redirect for large files ONLY if endpoint is HTTPS or AWS S3 (no custom endpoint)
        if (fileEntry.size > LARGE_FILE_THRESHOLD && !isHttpEndpoint) {
          logger.debug('File size exceeds threshold, generating presigned URL redirect', {
            context: 'GET /api/files/[id]',
            fileId,
            fileSize: fileEntry.size,
            threshold: LARGE_FILE_THRESHOLD,
          });

          const presignedUrl = await getPresignedUrl(fileEntry.s3Key);
          logger.debug('Presigned URL generated successfully', {
            context: 'GET /api/files/[id]',
            fileId,
            hasUrl: !!presignedUrl,
          });

          return NextResponse.redirect(presignedUrl);
        }

        // Download files and serve through API (required for HTTP endpoints to avoid mixed content)
        if (isHttpEndpoint && fileEntry.size > LARGE_FILE_THRESHOLD) {
          logger.debug('Proxying large file through API due to HTTP S3 endpoint', {
            context: 'GET /api/files/[id]',
            fileId,
            fileSize: fileEntry.size,
            endpoint: s3Endpoint,
          });
        }

        // Download files and return directly
        logger.debug('File size is small, downloading from S3', {
          context: 'GET /api/files/[id]',
          fileId,
          fileSize: fileEntry.size,
        });

        const buffer = await downloadS3File(fileEntry.s3Key);

        logger.debug('File downloaded from S3', {
          context: 'GET /api/files/[id]',
          fileId,
          downloadedSize: buffer.length,
        });

        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type': fileEntry.mimeType,
            'Content-Length': buffer.length.toString(),
            'Content-Disposition': `inline; filename="${fileEntry.originalFilename}"`,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      } catch (s3Error) {
        logger.warn('S3 serving failed, falling back to local filesystem', {
          context: 'GET /api/files/[id]',
          fileId,
          s3Key: fileEntry.s3Key,
          error: s3Error instanceof Error ? s3Error.message : 'Unknown error',
        });

        // Fall through to local filesystem serving
      }
    }

    // Serve from local filesystem (default or fallback)
    logger.debug('Serving file from local filesystem', {
      context: 'GET /api/files/[id]',
      fileId,
      s3Enabled,
    });

    const buffer = await readLocalFile(fileId, fileEntry.originalFilename);

    logger.debug('File read from local storage', {
      context: 'GET /api/files/[id]',
      fileId,
      size: buffer.length,
    });

    // Return file with appropriate headers
    return new NextResponse(Buffer.from(buffer), {
      headers: {
        'Content-Type': fileEntry.mimeType,
        'Content-Length': fileEntry.size.toString(),
        'Content-Disposition': `inline; filename="${fileEntry.originalFilename}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    logger.error('Error serving file', { context: 'GET /api/files/[id]' }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      { error: 'Failed to serve file' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/files/:id
 * Delete a file by its ID
 * Handles deletion from both local filesystem and S3 storage
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: fileId } = await params;

    // Get file metadata from repository (supports MongoDB and JSON backends)
    const repos = getRepositories();
    const fileEntry = await repos.files.findById(fileId);
    if (!fileEntry) {
      logger.debug('File not found', { context: 'DELETE /api/files/[id]', fileId });
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    logger.debug('Deleting file', { context: 'DELETE /api/files/[id]', fileId, hasS3Key: !!fileEntry.s3Key });

    // Check if file is still linked to any entities
    if (fileEntry.linkedTo.length > 0) {
      logger.debug('Cannot delete file still in use', {
        context: 'DELETE /api/files/[id]',
        fileId,
        linkedToCount: fileEntry.linkedTo.length,
      });

      return NextResponse.json(
        {
          error: 'Cannot delete file that is still in use',
          linkedTo: fileEntry.linkedTo,
        },
        { status: 400 }
      );
    }

    // Delete from S3 if applicable
    const s3Enabled = isS3Enabled();
    if (s3Enabled && fileEntry.s3Key) {
      logger.debug('S3 enabled and file has s3Key, deleting from S3', {
        context: 'DELETE /api/files/[id]',
        fileId,
        s3Key: fileEntry.s3Key,
      });

      try {
        await deleteS3File(fileEntry.s3Key);
        logger.debug('File deleted from S3', {
          context: 'DELETE /api/files/[id]',
          fileId,
          s3Key: fileEntry.s3Key,
        });
      } catch (s3Error) {
        logger.warn('Failed to delete file from S3', {
          context: 'DELETE /api/files/[id]',
          fileId,
          s3Key: fileEntry.s3Key,
          error: s3Error instanceof Error ? s3Error.message : 'Unknown error',
        });

        // Continue with metadata deletion even if S3 deletion fails
      }
    }

    // Delete the file metadata from repository
    logger.debug('Deleting file metadata from repository', {
      context: 'DELETE /api/files/[id]',
      fileId,
    });

    const deleted = await repos.files.delete(fileId);

    if (!deleted) {
      logger.warn('File metadata not found when attempting deletion', {
        context: 'DELETE /api/files/[id]',
        fileId,
      });

      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    logger.info('File deleted successfully', {
      context: 'DELETE /api/files/[id]',
      fileId,
      hadS3Key: !!fileEntry.s3Key,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error deleting file', { context: 'DELETE /api/files/[id]' }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      { error: 'Failed to delete file' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/files/:id/unlink
 * Remove a link from a file
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: fileId } = await params;
    const { entityId } = await request.json();

    if (!entityId) {
      return NextResponse.json(
        { error: 'entityId is required' },
        { status: 400 }
      );
    }

    // Get file metadata from repository (supports MongoDB and JSON backends)
    const repos = getRepositories();
    const fileEntry = await repos.files.findById(fileId);
    if (!fileEntry) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Remove the link using repository
    const updated = await repos.files.removeLink(fileId, entityId);
    if (!updated) {
      return NextResponse.json({ error: 'Failed to update file' }, { status: 500 });
    }

    // If no more links, consider auto-deleting the file
    if (updated.linkedTo.length === 0) {
      // Optionally delete the file automatically
      // await deleteFile(fileId);
      // return NextResponse.json({ success: true, deleted: true });
    }

    return NextResponse.json({ success: true, file: updated });
  } catch (error) {
    logger.error('Error unlinking file', { context: 'PATCH /api/files/[id]' }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      { error: 'Failed to unlink file' },
      { status: 500 }
    );
  }
}
