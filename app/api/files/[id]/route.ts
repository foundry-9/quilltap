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
import { downloadFile as downloadS3File, getPresignedUrl, deleteFile as deleteS3File } from '@/lib/s3/operations';

/**
 * GET /api/files/:id
 * Retrieve a file by its ID from S3 storage
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

    // Get file metadata from repository
    const repos = getRepositories();
    const fileEntry = await repos.files.findById(fileId);
    if (!fileEntry) {
      logger.debug('File not found', { context: 'GET /api/files/[id]', fileId });
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    if (!fileEntry.s3Key) {
      logger.error('File has no S3 key - may need migration', { context: 'GET /api/files/[id]', fileId });
      return NextResponse.json({ error: 'File not available - migration required' }, { status: 500 });
    }

    logger.debug('Serving file from S3', { context: 'GET /api/files/[id]', fileId, s3Key: fileEntry.s3Key });

    // Check if we should use presigned URL redirect or proxy through API
    // For HTTP endpoints (e.g., local MinIO), we must proxy to avoid mixed content issues
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

    // Download file and serve through API
    logger.debug('Downloading file from S3', {
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
 * Delete a file by its ID from S3 storage
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

    // Get file metadata from repository
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

    // Delete from S3 if file has s3Key
    if (fileEntry.s3Key) {
      logger.debug('Deleting file from S3', {
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
